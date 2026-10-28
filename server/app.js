// Express application: REST API + static frontend.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, hashPassword } from './db.js';
import {
  authMiddleware,
  requireAuth,
  requireAdmin,
  createSession,
  destroySession,
  verifyPassword,
  issueApiKey,
} from './auth.js';
import {
  str,
  optStr,
  email as vEmail,
  password as vPassword,
  int,
  idParam,
  courseCode,
  badRequest,
} from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COURSE_SQL = `
  SELECT c.*,
         (SELECT COUNT(*) FROM registrations r
           WHERE r.course_id = c.id AND r.status = 'registered') AS seats_taken,
         c.capacity - (SELECT COUNT(*) FROM registrations r
           WHERE r.course_id = c.id AND r.status = 'registered') AS seats_left
  FROM courses c`;

function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(String(err?.message || err));
}

function positiveIntParam(value, label) {
  return int(value, label, { min: 1, max: Number.MAX_SAFE_INTEGER });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // Security headers (TLS/HSTS, clickjacking, MIME sniffing, CSP, referrer).
  app.use((_req, res, next) => {
    res.set({
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(authMiddleware);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---------------- Auth ----------------
  app.post('/api/auth/register', (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Name', { max: 100 });
    const mail = vEmail(b.email);
    const pw = vPassword(b.password);

    const { salt, hash } = hashPassword(pw);
    let info;
    try {
      info = db
        .prepare("INSERT INTO users (name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, 'student')")
        .run(name, mail, hash, salt);
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ error: 'An account with this email already exists' });
      throw err;
    }
    const user = db
      .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    const token = createSession(user.id);
    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const b = req.body || {};
    const mail = vEmail(b.email);
    const pw = vPassword(b.password);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
    if (!user || !verifyPassword(pw, user.salt, user.password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = createSession(user.id);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    // Revoke the session backing this JWT (jti claim); API-key calls just no-op.
    if (req.authType === 'jwt') {
      const payload = req.token.split('.');
      const claims = JSON.parse(Buffer.from(payload[1], 'base64url').toString('utf8'));
      destroySession(claims.jti);
    }
    res.json({ message: 'Logged out' });
  });

  app.get('/api/auth/me', requireAuth, (req, res) =>
    res.json({ user: req.user, auth_type: req.authType })
  );

  // ---------------- API keys ----------------
  app.post('/api/keys', requireAuth, (req, res) => {
    const label = optStr((req.body || {}).label, 'Label', { max: 60 }) || 'default';
    const issued = issueApiKey(req.user.id, label);
    res.status(201).json({
      api_key: { id: issued.id, label: issued.label, prefix: issued.prefix },
      key: issued.key,
      warning: 'Store this key now — it cannot be retrieved again (only its hash is kept).',
    });
  });

  app.get('/api/keys', requireAuth, (req, res) => {
    const keys = db
      .prepare(
        `SELECT id, label, prefix, created_at, last_used_at, revoked
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(req.user.id);
    res.json({ api_keys: keys });
  });

  app.delete('/api/keys/:id', requireAuth, (req, res) => {
    const id = idParam(req.params.id, 'key id');
    const info = db
      .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?')
      .run(id, req.user.id);
    if (info.changes === 0) return res.status(404).json({ error: 'API key not found' });
    res.json({ message: 'API key revoked' });
  });

  // ---------------- Courses ----------------
  app.get('/api/courses', (req, res) => {
    let q = req.query.q;
    if (q !== undefined) {
      if (Array.isArray(q)) q = q[0];
      q = String(q).trim();
      if (q.length > 100) throw badRequest('Search term must be at most 100 characters');
      if (!q) q = undefined;
    }
    const page = req.query.page === undefined ? 1 : int(req.query.page, 'page', { min: 1, max: 100000 });
    const limit = req.query.limit === undefined ? 100 : int(req.query.limit, 'limit', { min: 1, max: 200 });

    const params = [];
    let sql = COURSE_SQL;
    if (q) {
      sql += ' WHERE c.code LIKE ? OR c.title LIKE ? OR c.instructor LIKE ?';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY c.code';
    const all = db.prepare(sql).all(...params);

    const start = (page - 1) * limit;
    const courses = all.slice(start, start + limit).map((c) => ({ ...c }));
    if (req.user) {
      const mine = db
        .prepare('SELECT course_id FROM registrations WHERE user_id = ?')
        .all(req.user.id)
        .map((r) => r.course_id);
      for (const c of courses) c.registered = mine.includes(c.id);
    }
    res.json({ total: all.length, page, limit, courses });
  });

  app.get('/api/courses/:id', (req, res) => {
    const id = positiveIntParam(req.params.id, 'course id');
    const course = db.prepare(`${COURSE_SQL} WHERE c.id = ?`).get(id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (req.user) {
      course.registered = !!db
        .prepare('SELECT 1 FROM registrations WHERE user_id = ? AND course_id = ?')
        .get(req.user.id, course.id);
    }
    res.json({ course });
  });

  app.post('/api/courses', requireAdmin, (req, res) => {
    const b = req.body || {};
    const code = courseCode(b.code);
    const title = str(b.title, 'Title', { max: 200 });
    const description = optStr(b.description, 'Description', { max: 2000 });
    const instructor = optStr(b.instructor, 'Instructor', { max: 100 });
    const schedule = optStr(b.schedule, 'Schedule', { max: 100 });
    const credits = int(b.credits ?? 3, 'Credits', { min: 1, max: 10 });
    const capacity = int(b.capacity ?? 30, 'Capacity', { min: 1, max: 1000 });

    let info;
    try {
      info = db
        .prepare(
          `INSERT INTO courses (code, title, description, instructor, credits, capacity, schedule)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(code, title, description, instructor, credits, capacity, schedule);
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ error: 'A course with this code already exists' });
      throw err;
    }
    const course = db.prepare(`${COURSE_SQL} WHERE c.id = ?`).get(Number(info.lastInsertRowid));
    res.status(201).json({ course });
  });

  app.put('/api/courses/:id', requireAdmin, (req, res) => {
    const id = positiveIntParam(req.params.id, 'course id');
    const existing = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Course not found' });

    const b = req.body || {};
    const code = b.code === undefined ? existing.code : courseCode(b.code);
    const title = b.title === undefined ? existing.title : str(b.title, 'Title', { max: 200 });
    const description = b.description === undefined ? existing.description : optStr(b.description, 'Description', { max: 2000 });
    const instructor = b.instructor === undefined ? existing.instructor : optStr(b.instructor, 'Instructor', { max: 100 });
    const schedule = b.schedule === undefined ? existing.schedule : optStr(b.schedule, 'Schedule', { max: 100 });
    const credits = b.credits === undefined ? existing.credits : int(b.credits, 'Credits', { min: 1, max: 10 });
    const capacity = b.capacity === undefined ? existing.capacity : int(b.capacity, 'Capacity', { min: 1, max: 1000 });

    const taken = db
      .prepare("SELECT COUNT(*) AS n FROM registrations WHERE course_id = ? AND status = 'registered'")
      .get(existing.id).n;
    if (capacity < taken)
      return res.status(400).json({ error: `Capacity cannot be below current enrollment (${taken})` });

    try {
      db.prepare(
        `UPDATE courses SET code=?, title=?, description=?, instructor=?, credits=?, capacity=?, schedule=?
         WHERE id = ?`
      ).run(code, title, description, instructor, credits, capacity, schedule, existing.id);
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ error: 'A course with this code already exists' });
      throw err;
    }
    res.json({ course: db.prepare(`${COURSE_SQL} WHERE c.id = ?`).get(existing.id) });
  });

  app.delete('/api/courses/:id', requireAdmin, (req, res) => {
    const id = positiveIntParam(req.params.id, 'course id');
    const info = db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'Course not found' });
    res.json({ message: 'Course deleted' });
  });

  // ---------------- Registrations ----------------
  app.post('/api/registrations', requireAuth, (req, res) => {
    const courseId = positiveIntParam((req.body || {}).course_id, 'course_id');
    const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const existing = db
      .prepare('SELECT * FROM registrations WHERE user_id = ? AND course_id = ?')
      .get(req.user.id, course.id);
    if (existing) return res.status(409).json({ error: 'You are already registered for this course' });

    const taken = db
      .prepare("SELECT COUNT(*) AS n FROM registrations WHERE course_id = ? AND status = 'registered'")
      .get(course.id).n;
    const status = taken >= course.capacity ? 'waitlisted' : 'registered';

    const info = db
      .prepare('INSERT INTO registrations (user_id, course_id, status) VALUES (?, ?, ?)')
      .run(req.user.id, course.id, status);
    const registration = db
      .prepare(
        `SELECT r.*, c.code, c.title FROM registrations r
         JOIN courses c ON c.id = r.course_id WHERE r.id = ?`
      )
      .get(Number(info.lastInsertRowid));
    res.status(201).json({
      registration,
      message:
        status === 'waitlisted'
          ? `Course is full — you have been placed on the waitlist for ${course.code}`
          : `Successfully registered for ${course.code}`,
    });
  });

  app.get('/api/registrations', requireAuth, (req, res) => {
    const base = `SELECT r.*, u.name AS student_name, u.email AS student_email,
                         c.code, c.title, c.credits
                  FROM registrations r
                  JOIN users u    ON u.id = r.user_id
                  JOIN courses c  ON c.id = r.course_id`;
    let rows;
    if (req.user.role === 'admin') {
      const { course_id: courseId, student_id: studentId } = req.query;
      let sql = base;
      const params = [];
      if (courseId !== undefined) {
        sql += ' WHERE r.course_id = ?';
        params.push(positiveIntParam(courseId, 'course_id'));
      }
      if (studentId !== undefined) {
        sql += params.length ? ' AND' : ' WHERE';
        sql += ' r.user_id = ?';
        params.push(positiveIntParam(studentId, 'student_id'));
      }
      sql += ' ORDER BY r.created_at DESC';
      rows = db.prepare(sql).all(...params);
    } else {
      rows = db
        .prepare(`${base} WHERE r.user_id = ? ORDER BY r.created_at DESC`)
        .all(req.user.id);
    }
    res.json({ registrations: rows });
  });

  app.delete('/api/registrations/:id', requireAuth, (req, res) => {
    const id = idParam(req.params.id, 'registration id');
    const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (reg.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'You may only drop your own registrations' });
    db.prepare('DELETE FROM registrations WHERE id = ?').run(reg.id);
    res.json({ message: 'Registration removed' });
  });

  // ---------------- Admin: students ----------------
  app.get('/api/students', requireAdmin, (req, res) => {
    const students = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.created_at,
                (SELECT COUNT(*) FROM registrations r WHERE r.user_id = u.id) AS registrations
         FROM users u WHERE u.role = 'student' ORDER BY u.name`
      )
      .all();
    res.json({ students });
  });

  app.put('/api/students/:id', requireAdmin, (req, res) => {
    const id = positiveIntParam(req.params.id, 'student id');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Student not found' });
    if (user.role !== 'student')
      return res.status(400).json({ error: 'This endpoint manages student accounts' });

    const b = req.body || {};
    const name = b.name === undefined ? user.name : str(b.name, 'Name', { max: 100 });
    const mail = b.email === undefined ? user.email : vEmail(b.email);
    try {
      if (b.password !== undefined && b.password !== '') {
        const pw = vPassword(b.password);
        const { salt, hash } = hashPassword(pw);
        db.prepare('UPDATE users SET name=?, email=?, password_hash=?, salt=? WHERE id = ?')
          .run(name, mail, hash, salt, user.id);
      } else {
        db.prepare('UPDATE users SET name=?, email=? WHERE id = ?').run(name, mail, user.id);
      }
    } catch (err) {
      if (isUniqueViolation(err)) return res.status(409).json({ error: 'An account with this email already exists' });
      throw err;
    }
    res.json({ student: db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(user.id) });
  });

  app.delete('/api/students/:id', requireAdmin, (req, res) => {
    const id = positiveIntParam(req.params.id, 'student id');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Student not found' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Administrators cannot be deleted' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    res.json({ message: 'Student deleted' });
  });

  // ---------------- Errors ----------------
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    let message = err.message;
    if (err.type === 'entity.parse.failed') message = 'Invalid JSON in request body';
    else if (err.type === 'entity.too.large') message = 'Request body too large';
    else if (status >= 500) {
      console.error(err);
      message = 'Internal server error';
    } else if (status === 400 && !err.expose) message = 'Invalid request';
    res.status(status).json({ error: message });
  });

  return app;
}
