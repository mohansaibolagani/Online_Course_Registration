// Integration tests for the REST API (node:test, in-memory SQLite).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';
const { createApp } = await import('../server/app.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => server.close());

let seq = 0;
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function makeStudent(prefix = 'stu') {
  seq += 1;
  return api('/api/auth/register', {
    method: 'POST',
    body: {
      name: `Test ${prefix} ${seq}`,
      email: `${prefix}${seq}@test.edu`,
      password: 'secret123',
    },
  });
}

const adminCreds = { email: 'admin@school.edu', password: 'admin123' };

test('seed data exists: admin can log in and courses are seeded', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: adminCreds });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');

  const courses = await api('/api/courses');
  assert.equal(courses.status, 200);
  assert.ok(courses.data.courses.length >= 5, 'expected seeded courses');
  assert.ok(courses.data.courses[0].seats_left !== undefined);
});

test('student registration: creates account, rejects duplicates, rejects bad input', async () => {
  const first = await makeStudent('reg');
  assert.equal(first.status, 201);
  assert.equal(first.data.user.role, 'student');
  assert.ok(first.data.token);

  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Dup', email: 'reg1@test.edu', password: 'secret123' },
  });
  assert.equal(dup.status, 409);

  const bad = await api('/api/auth/register', {
    method: 'POST',
    body: { name: '', email: 'not-an-email', password: 'x' },
  });
  assert.equal(bad.status, 400);
});

test('login rejects wrong password and /auth/me requires a token', async () => {
  const wrong = await api('/api/auth/login', { method: 'POST', body: { email: adminCreds.email, password: 'wrong-password' } });
  assert.equal(wrong.status, 401);

  const noToken = await api('/api/auth/me');
  assert.equal(noToken.status, 401);

  const ok = await api('/api/auth/me', { token: (await makeStudent('me')).data.token });
  assert.equal(ok.status, 200);
  assert.match(ok.data.user.email, /me\d+@test\.edu/);
});

test('registering for a course works once and 409s on duplicates', async () => {
  const { token } = (await makeStudent('c1')).data;
  const course = (await api('/api/courses?q=CS101')).data.courses[0];

  const ok = await api('/api/registrations', { method: 'POST', token, body: { course_id: course.id } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.registration.status, 'registered');

  const dup = await api('/api/registrations', { method: 'POST', token, body: { course_id: course.id } });
  assert.equal(dup.status, 409);

  const mine = await api('/api/registrations', { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.registrations.length, 1);
  assert.equal(mine.data.registrations[0].code, 'CS101');

  const listed = await api('/api/courses?q=CS101', { token });
  assert.equal(listed.data.courses[0].registered, true);
});

test('full courses place students on the waitlist', async () => {
  const admin = (await api('/api/auth/login', { method: 'POST', body: adminCreds })).data.token;

  const created = await api('/api/courses', {
    method: 'POST',
    token: admin,
    body: { code: 'TINY1', title: 'Tiny Course', capacity: 1, credits: 1 },
  });
  assert.equal(created.status, 201);
  const courseId = created.data.course.id;

  const s1 = (await makeStudent('w1')).data.token;
  const s2 = (await makeStudent('w2')).data.token;

  const r1 = await api('/api/registrations', { method: 'POST', token: s1, body: { course_id: courseId } });
  assert.equal(r1.data.registration.status, 'registered');
  const r2 = await api('/api/registrations', { method: 'POST', token: s2, body: { course_id: courseId } });
  assert.equal(r2.data.registration.status, 'waitlisted');
  assert.match(r2.data.message, /waitlist/i);
});

test('students cannot manage courses; admins can update and delete', async () => {
  const student = (await makeStudent('perm')).data.token;
  const admin = (await api('/api/auth/login', { method: 'POST', body: adminCreds })).data.token;

  const forbidden = await api('/api/courses', {
    method: 'POST',
    token: student,
    body: { code: 'NOPE1', title: 'Nope' },
  });
  assert.equal(forbidden.status, 403);

  const anon = await api('/api/courses', { method: 'POST', body: { code: 'NOPE2', title: 'Nope' } });
  assert.equal(anon.status, 401);

  const course = (await api('/api/courses?q=ENG102')).data.courses[0];
  const updated = await api(`/api/courses/${course.id}`, {
    method: 'PUT',
    token: admin,
    body: { capacity: course.capacity + 5, instructor: 'Prof. New' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.course.capacity, course.capacity + 5);
  assert.equal(updated.data.course.instructor, 'Prof. New');

  const shrink = await api(`/api/courses/${course.id}`, {
    method: 'PUT',
    token: admin,
    body: { capacity: 0 },
  });
  assert.equal(shrink.status, 400);
});

test('dropping a registration frees the seat and allows re-registering', async () => {
  const { token } = (await makeStudent('drop')).data;
  const course = (await api('/api/courses?q=PHYS201')).data.courses[0];
  const before = course.seats_left;

  const reg = await api('/api/registrations', { method: 'POST', token, body: { course_id: course.id } });
  const after = await api('/api/courses?q=PHYS201');
  assert.equal(after.data.courses[0].seats_left, before - 1);

  const del = await api(`/api/registrations/${reg.data.registration.id}`, { method: 'DELETE', token });
  assert.equal(del.status, 200);

  const again = await api('/api/registrations', { method: 'POST', token, body: { course_id: course.id } });
  assert.equal(again.status, 201);
});

test('students cannot drop other students registrations', async () => {
  const owner = (await makeStudent('own')).data.token;
  const intruder = (await makeStudent('bad')).data.token;
  const course = (await api('/api/courses?q=HIST110')).data.courses[0];

  const reg = await api('/api/registrations', { method: 'POST', token: owner, body: { course_id: course.id } });
  const res = await api(`/api/registrations/${reg.data.registration.id}`, { method: 'DELETE', token: intruder });
  assert.equal(res.status, 403);
});

test('admins can list students and delete them (cascading registrations)', async () => {
  const admin = (await api('/api/auth/login', { method: 'POST', body: adminCreds })).data.token;
  const { token, user } = (await makeStudent('del')).data;

  const course = (await api('/api/courses?q=MATH310')).data.courses[0];
  await api('/api/registrations', { method: 'POST', token, body: { course_id: course.id } });

  const students = await api('/api/students', { token: admin });
  assert.equal(students.status, 200);
  assert.ok(students.data.students.some((s) => s.email === user.email));

  const forbidden = await api('/api/students', { token });
  assert.equal(forbidden.status, 403);

  const del = await api(`/api/students/${user.id}`, { method: 'DELETE', token: admin });
  assert.equal(del.status, 200);

  const regs = await api('/api/registrations', { token: admin });
  assert.ok(!regs.data.registrations.some((r) => r.user_id === user.id), 'registrations should cascade');
});

test('course search and pagination shape', async () => {
  const res = await api('/api/courses?q=math&page=1&limit=1');
  assert.equal(res.status, 200);
  assert.equal(res.data.limit, 1);
  assert.ok(res.data.total >= 2);
  assert.equal(res.data.courses.length, 1);
  assert.match(res.data.courses[0].code, /^MATH/);
});
