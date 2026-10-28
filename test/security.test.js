// Security-focused tests: JWT tokens, API key validation, input validation,
// authorization, and security headers. Uses a separate in-memory DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomBytes, createHmac } from 'node:crypto';

process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'unit-test-secret-do-not-use-in-production';

const { createApp } = await import('../server/app.js');
const { signAccessToken, verifyAccessToken } = await import('../server/jwt.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

let seq = 0;
async function req(path, { method = 'GET', token, apiKey, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

function newStudent(prefix = 'sec') {
  seq += 1;
  return req('/api/auth/register', {
    method: 'POST',
    body: { name: `Sec ${seq}`, email: `${prefix}${seq}@test.edu`, password: 'secret123' },
  });
}

const adminLogin = () =>
  req('/api/auth/login', { method: 'POST', body: { email: 'admin@school.edu', password: 'admin123' } });

// ---------------- JWT ----------------
test('JWT: valid token verifies and decodes expected claims', async () => {
  const { token, user } = (await newStudent('jwt')).data;
  const payload = verifyAccessToken(token);
  assert.ok(payload, 'token should verify');
  assert.equal(payload.sub, user.id);
  assert.equal(payload.role, 'student');
  assert.ok(payload.jti, 'token must carry a session id (jti)');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));

  const me = await req('/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, user.id);
  assert.equal(me.data.auth_type, 'jwt');
});

test('JWT: tampered payload, wrong signature, bad alg, and expiry are rejected', () => {
  const token = signAccessToken({ sub: 1, jti: 'abc', role: 'student' });
  const [h, p] = token.split('.');

  // Tampered payload (role -> admin)
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), role: 'admin' })
  ).toString('base64url');
  assert.equal(verifyAccessToken(`${h}.${forged}.${token.split('.')[2]}`), null);

  // Wrong signature key
  const badSig = createHmac('sha256', 'another-secret').update(`${h}.${p}`).digest('base64url');
  assert.equal(verifyAccessToken(`${h}.${p}.${badSig}`), null);

  // alg=none style confusion
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verifyAccessToken(`${noneHeader}.${p}.`), null);

  // Expired
  const expired = signAccessToken({ sub: 1, jti: 'abc', iat: 2, exp: 3 });
  assert.equal(verifyAccessToken(expired), null);

  // Garbage
  assert.equal(verifyAccessToken('not-a-jwt'), null);
  assert.equal(verifyAccessToken(''), null);
  assert.equal(verifyAccessToken(null), null);
});

test('JWT: logout revokes the session — the token stops working', async () => {
  const { token } = (await newStudent('rev')).data;
  assert.equal((await req('/api/auth/me', { token })).status, 200);

  const out = await req('/api/auth/logout', { method: 'POST', token });
  assert.equal(out.status, 200);

  const after = await req('/api/auth/me', { token });
  assert.equal(after.status, 401);
  assert.match(after.data.error, /invalid or expired/i);
});

test('JWT: a token signed with a different secret is rejected', async () => {
  const forged = createHmac('sha256', 'wrong-secret')
    .update(
      `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${
        Buffer.from(JSON.stringify({ sub: 1, jti: 1, role: 'admin', exp: 9999999999 })).toString('base64url')}`
    )
    .digest('base64url');
  const parts = forged.split('.');
  const token = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const res = await req('/api/auth/me', { token });
  assert.equal(res.status, 401);
});

test('JWT: garbage and expired-looking tokens get 401, not 500', async () => {
  for (const token of ['abc', 'a.b.c', 'x'.repeat(500), 'null']) {
    const res = await req('/api/auth/me', { token });
    assert.equal(res.status, 401, `token ${JSON.stringify(token)} should be 401`);
  }
});

// ---------------- API keys ----------------
test('API key: issuance returns the key once, then authenticates API calls', async () => {
  const { token } = (await newStudent('key')).data;

  const issued = await req('/api/keys', { method: 'POST', token, body: { label: 'cli' } });
  assert.equal(issued.status, 201);
  assert.match(issued.data.key, /^crc_[0-9a-f]{40}$/);
  assert.ok(!JSON.stringify(issued.data).includes('key_hash'), 'must not leak the hash');
  const rawKey = issued.data.key;

  // Listing never returns the raw key
  const list = await req('/api/keys', { token });
  assert.equal(list.status, 200);
  assert.equal(list.data.api_keys.length, 1);
  assert.ok(!('key' in list.data.api_keys[0]));

  // The raw key authenticates as the issuing user
  const me = await req('/api/auth/me', { apiKey: rawKey });
  assert.equal(me.status, 200);
  assert.equal(me.data.auth_type, 'apikey');
  assert.equal(me.data.user.role, 'student');
  assert.equal(me.data.user.email, `key${seq}@test.edu`);

  // API key works for data endpoints too
  const courses = await req('/api/courses', { apiKey: rawKey });
  assert.equal(courses.status, 200);
});

test('API key: invalid, malformed, and revoked keys are rejected with 401', async () => {
  const { token } = (await newStudent('rev')).data;

  const forged = 'crc_' + 'a'.repeat(40);
  const bad = await req('/api/auth/me', { apiKey: forged });
  assert.equal(bad.status, 401);
  assert.match(bad.data.error, /api key/i);

  for (const key of ['not-a-key', 'crc_short', '', 'crc_' + 'z'.repeat(40)]) {
    const res = await req('/api/auth/me', { apiKey: key });
    assert.equal(res.status, 401, `malformed key ${JSON.stringify(key)} should be 401`);
  }

  const issued = await req('/api/keys', { method: 'POST', token, body: { label: 'revoke-me' } });
  const rawKey = issued.data.key;
  assert.equal((await req('/api/auth/me', { apiKey: rawKey })).status, 200);

  const del = await req(`/api/keys/${issued.data.api_key.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);
  const afterRevoke = await req('/api/auth/me', { apiKey: rawKey });
  assert.equal(afterRevoke.status, 401);
  assert.match(afterRevoke.data.error, /revoked/i);
});

test('API key: cannot revoke another user\'s key', async () => {
  const owner = (await newStudent('own')).data.token;
  const attacker = (await newStudent('atk')).data.token;
  const issued = await req('/api/keys', { method: 'POST', token: owner, body: { label: 'mine' } });

  const res = await req(`/api/keys/${issued.data.api_key.id}`, { method: 'DELETE', token: attacker });
  assert.equal(res.status, 404);
});

// ---------------- Input validation ----------------
test('Validation: registration rejects bad payloads with 400 and clear errors', async () => {
  const cases = [
    {},
    { name: '', email: 'a@b.com', password: 'secret123' },
    { name: 'A'.repeat(101), email: 'a@b.com', password: 'secret123' },
    { name: 'Test', email: 'not-an-email', password: 'secret123' },
    { name: 'Test', email: 'a@b.com', password: 'short' },
    { name: 12345, email: 'a@b.com', password: 'secret123' },
    { name: 'Test', email: { $ne: null }, password: 'secret123' },
    { name: 'Test', email: 'a@b.com', password: 123456 },
    { name: '   ', email: 'a@b.com', password: 'secret123' },
  ];
  for (const body of cases) {
    const res = await req('/api/auth/register', { method: 'POST', body });
    assert.equal(res.status, 400, `payload ${JSON.stringify(body)} should be 400`);
    assert.ok(res.data.error, '400 responses must carry an error message');
  }
});

test('Validation: login rejects malformed input', async () => {
  assert.equal((await req('/api/auth/login', { method: 'POST', body: {} })).status, 400);
  assert.equal(
    (await req('/api/auth/login', { method: 'POST', body: { email: 'x', password: 'y' } })).status,
    400
  );
  assert.equal(
    (await req('/api/auth/login', { method: 'POST', body: { email: 'a@b.com', password: 123 } })).status,
    400
  );
  assert.equal(
    (await req('/api/auth/login', { method: 'POST', body: { email: ['a'], password: '123456' } })).status,
    400
  );
});

test('Validation: course creation rejects bad codes, numbers, and sizes', async () => {
  const admin = (await adminLogin()).data.token;
  const cases = [
    { code: '', title: 'X' },
    { code: 'CS101!', title: 'X' },
    { code: 'CS101', title: '' },
    { code: 'CS101', title: 'X'.repeat(201) },
    { code: 'CS101', title: 'X', credits: 'three' },
    { code: 'CS101', title: 'X', credits: 0 },
    { code: 'CS101', title: 'X', credits: 1.5 },
    { code: 'CS101', title: 'X', capacity: -5 },
    { code: 'CS101', title: 'X', capacity: 1e9 },
  ];
  for (const body of cases) {
    const res = await req('/api/courses', { method: 'POST', token: admin, body });
    assert.equal(res.status, 400, `${JSON.stringify(body)} should be 400`);
  }
});

test('Validation: malformed JSON bodies return 400, not 500', async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": ',
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.match(data.error, /json/i);
});

test('Validation: bad query and path parameters return 400', async () => {
  assert.equal((await req('/api/courses?page=0')).status, 400);
  assert.equal((await req('/api/courses?limit=abc')).status, 400);
  assert.equal((await req('/api/courses?limit=9999')).status, 400);
  assert.equal((await req('/api/courses?q=' + 'x'.repeat(101))).status, 400);
  assert.equal((await req('/api/courses/abc')).status, 400);
  assert.equal((await req('/api/courses/0')).status, 400);

  const { token } = (await newStudent('path')).data;
  assert.equal((await req('/api/registrations/xyz', { method: 'DELETE', token })).status, 400);
  assert.equal(
    (await req('/api/registrations', { method: 'POST', token, body: { course_id: 'one' } })).status,
    400
  );
});

// ---------------- Authorization ----------------
test('Authorization: role enforcement and cross-user protections', async () => {
  const student = (await newStudent('auth')).data.token;
  const admin = (await adminLogin()).data.token;

  // Student cannot use admin endpoints
  assert.equal((await req('/api/courses', { method: 'POST', token: student, body: { code: 'X1', title: 'X' } })).status, 403);
  assert.equal((await req('/api/students', { token: student })).status, 403);
  assert.equal((await req('/api/students', { token: student })).data.error, 'Admin access required');

  // Anonymous cannot use protected endpoints
  assert.equal((await req('/api/courses', { method: 'POST', body: { code: 'X2', title: 'X' } })).status, 401);
  assert.equal((await req('/api/registrations')).status, 401);
  assert.equal((await req('/api/students')).status, 401);

  // Student cannot delete another student's registration
  const owner = (await newStudent('vic')).data.token;
  const course = (await req('/api/courses?q=CS310')).data.courses[0];
  const reg = await req('/api/registrations', { method: 'POST', token: owner, body: { course_id: course.id } });
  const res = await req(`/api/registrations/${reg.data.registration.id}`, { method: 'DELETE', token: student });
  assert.equal(res.status, 403);
});

// ---------------- Security headers ----------------
test('Security headers are set on responses', async () => {
  const res = await fetch(`${BASE}/api/courses`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('strict-transport-security').includes('max-age=31536000'));
  assert.ok(res.headers.get('content-security-policy').includes("default-src 'self'"));
  assert.equal(res.headers.get('x-powered-by'), null, 'x-powered-by must be disabled');
});
