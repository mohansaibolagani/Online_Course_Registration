// Authentication: scrypt password hashing, JWT sessions (revocable), API keys, middleware.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, hashPassword } from './db.js';
import { signAccessToken, verifyAccessToken } from './jwt.js';

const SESSION_DAYS = 7;
const API_KEY_RE = /^crc_[0-9a-f]{40}$/;

export { hashPassword };

export function verifyPassword(password, salt, expectedHash) {
  const hash = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** Creates a revocable session record and returns a signed JWT (jti bound to it). */
export function createSession(userId) {
  const jti = randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`
  ).run(jti, userId);
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  return signAccessToken({ sub: user.id, jti, role: user.role });
}

export function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Verifies JWT signature/expiry, then checks the jti is a live, unexpired session. */
export function getUserFromJwt(token) {
  const payload = verifyAccessToken(token);
  if (!payload || typeof payload.sub !== 'number' || typeof payload.jti !== 'string') return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.user_id = ? AND s.expires_at > datetime('now')`
      )
      .get(payload.jti, payload.sub) || null
  );
}

// ---- API keys (stored as SHA-256 hashes; plaintext returned only once) ----
export function issueApiKey(userId, label) {
  const raw = 'crc_' + randomBytes(20).toString('hex');
  const keyHash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  const info = db
    .prepare('INSERT INTO api_keys (user_id, label, key_hash, prefix) VALUES (?, ?, ?, ?)')
    .run(userId, label, keyHash, prefix);
  return { id: Number(info.lastInsertRowid), label, prefix, key: raw };
}

export function resolveApiKey(rawKey) {
  if (typeof rawKey !== 'string' || !API_KEY_RE.test(rawKey)) return null;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const row = db
    .prepare('SELECT user_id FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(keyHash);
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE key_hash = ?").run(keyHash);
  return (
    db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(row.user_id) || null
  );
}

/**
 * Accepts either `Authorization: Bearer <JWT>` or `X-API-Key: crc_...`.
 * Sets req.user on success; req.authError explains a failed credential.
 */
export function authMiddleware(req, _res, next) {
  req.user = null;
  req.authError = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const user = getUserFromJwt(header.slice(7));
    if (user) {
      req.user = user;
      req.authType = 'jwt';
      req.token = header.slice(7);
    } else {
      req.authError = 'jwt';
    }
  } else if (req.headers['x-api-key']) {
    const user = resolveApiKey(String(req.headers['x-api-key']));
    if (user) {
      req.user = user;
      req.authType = 'apikey';
    } else {
      req.authError = 'api_key';
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.authError === 'jwt')
    return res.status(401).json({ error: 'Invalid or expired token' });
  if (req.authError === 'api_key')
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  return res.status(401).json({ error: 'Authentication required' });
}

export function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
