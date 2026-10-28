// Centralized input validation. Helpers throw HttpError(400), which the
// Express error handler turns into { error } JSON responses.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const notFound = (msg) => new HttpError(404, msg);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed string with length bounds. */
export function str(value, label, { min = 1, max = 200 } = {}) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') throw badRequest(`${label} must be text`);
  const v = value.trim();
  if (v.length < min) {
    throw badRequest(
      min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`
    );
  }
  if (v.length > max) throw badRequest(`${label} must be at most ${max} characters`);
  return v;
}

/** Optional trimmed string (empty allowed). */
export function optStr(value, label, { max = 200 } = {}) {
  if (value === null || value === undefined || value === '') return '';
  return str(value, label, { min: 0, max });
}

/** Validated, lowercased email. */
export function email(value, label = 'Email') {
  const v = str(value, label, { min: 3, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw badRequest(`Please provide a valid email address`);
  return v;
}

/** Password policy: 6-128 characters (not trimmed — spaces count). */
export function password(value) {
  if (typeof value !== 'string' || value.length < 6)
    throw badRequest('Password must be at least 6 characters');
  if (value.length > 128) throw badRequest('Password must be at most 128 characters');
  return value;
}

/** Integer within bounds. */
export function int(value, label, { min = 1, max = 1000000 } = {}) {
  const n = Number(value);
  if (typeof value === 'boolean' || value === '' || !Number.isFinite(n) || !Number.isInteger(n))
    throw badRequest(`${label} must be a whole number`);
  if (n < min) throw badRequest(`${label} must be at least ${min}`);
  if (n > max) throw badRequest(`${label} must be at most ${max}`);
  return n;
}

/** Positive integer path/id parameter. */
export function idParam(value, label = 'id') {
  if (!/^\d+$/.test(String(value))) throw badRequest(`Invalid ${label}`);
  return Number(value);
}

/** Course code: 2-20 chars, letters/digits/hyphen. Returns uppercased. */
export function courseCode(value) {
  const v = str(value, 'Course code', { min: 2, max: 20 }).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(v))
    throw badRequest('Course code may contain only letters, numbers, and hyphens');
  return v;
}
