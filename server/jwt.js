// JWT (HS256) access tokens implemented with node:crypto — no external deps.
// The signing secret comes from JWT_SECRET, or a generated per-install file.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

let cachedSecret = null;

function secret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.JWT_SECRET) {
    cachedSecret = Buffer.from(process.env.JWT_SECRET, 'utf8');
    return cachedSecret;
  }
  // Development fallback: generate once and persist so restarts keep sessions.
  const file = process.env.JWT_SECRET_FILE || path.join(DATA_DIR, 'jwt-secret.key');
  try {
    cachedSecret = fs.readFileSync(file);
  } catch {
    const b64 = randomBytes(48).toString('base64');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, b64, { mode: 0o600 });
    cachedSecret = Buffer.from(b64, 'base64');
  }
  return cachedSecret;
}

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function hmac(data) {
  return createHmac('sha256', secret()).update(data).digest();
}

/**
 * Sign an access token. Claims may override iat/exp (used by tests).
 * Typical claims: { sub, jti, role }
 */
export function signAccessToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ iat: now, exp: now + TOKEN_TTL_SECONDS, ...claims });
  const sig = hmac(`${head}.${body}`).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** Verify signature + expiry. Returns the payload or null. */
export function verifyAccessToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;

  let header;
  try {
    header = decode(head);
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null; // no alg confusion

  const expected = hmac(`${head}.${body}`);
  let given;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = decode(body);
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
