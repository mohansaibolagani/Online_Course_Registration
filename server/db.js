// Database layer: uses Node's built-in node:sqlite (no native dependency).
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export const dbFile =
  process.env.DB_FILE || path.join(DATA_DIR, 'registration.db');

if (dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
}

export const db = new DatabaseSync(dbFile);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    instructor  TEXT    NOT NULL DEFAULT '',
    credits     INTEGER NOT NULL DEFAULT 3 CHECK (credits > 0),
    capacity    INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
    schedule    TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    course_id  INTEGER NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    status     TEXT    NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','waitlisted')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, course_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL DEFAULT 'default',
    key_hash     TEXT    NOT NULL UNIQUE,
    prefix       TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
  );
`);

// ---- Seed data (only on a fresh database) --------------------------------
const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
if (n === 0) {
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)'
  );
  const seedUser = (name, email, password, role) => {
    const { salt, hash } = hashPassword(password);
    insertUser.run(name, email, hash, salt, role);
  };

  seedUser('Administrator', 'admin@school.edu', 'admin123', 'admin');
  seedUser('Alice Johnson', 'alice@school.edu', 'student123', 'student');
  seedUser('Bob Smith', 'bob@school.edu', 'student123', 'student');

  const insertCourse = db.prepare(
    `INSERT INTO courses (code, title, description, instructor, credits, capacity, schedule)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const courses = [
    ['CS101', 'Introduction to Computer Science',
     'Fundamentals of programming, problem solving, and computational thinking using Python.',
     'Dr. Ada Lovelace', 3, 40, 'Mon/Wed 09:00-10:30'],
    ['CS201', 'Data Structures and Algorithms',
     'Arrays, linked lists, trees, graphs, sorting, and algorithm complexity analysis.',
     'Dr. Alan Turing', 4, 35, 'Tue/Thu 11:00-12:30'],
    ['CS310', 'Database Systems',
     'Relational modeling, SQL, normalization, transactions, and database application design.',
     'Dr. Edgar Codd', 3, 30, 'Mon/Wed 14:00-15:30'],
    ['MATH205', 'Linear Algebra',
     'Vectors, matrices, eigenvalues, and applications in computer graphics and machine learning.',
     'Dr. Emmy Noether', 3, 45, 'Tue/Thu 09:00-10:30'],
    ['MATH310', 'Probability and Statistics',
     'Discrete and continuous distributions, estimation, hypothesis testing, and regression.',
     'Dr. Florence Nightingale', 3, 25, 'Fri 09:00-12:00'],
    ['ENG102', 'Academic Writing',
     'Essay structure, research methods, citation practice, and persuasive writing.',
     'Prof. Jane Austen', 2, 50, 'Wed 15:30-17:00'],
    ['PHYS201', 'Classical Mechanics',
     'Newtonian mechanics, energy, momentum, rotation, and oscillations with laboratory sessions.',
     'Dr. Marie Curie', 4, 20, 'Tue/Thu 13:00-15:00'],
    ['HIST110', 'World History',
     'Survey of major civilizations, revolutions, and global interactions from antiquity to the present.',
     'Prof. Howard Zinn', 2, 60, 'Fri 13:00-15:00'],
  ];
  for (const c of courses) insertCourse.run(...c);

  // A couple of starting registrations for the demo student.
  const aliceId = db.prepare("SELECT id FROM users WHERE email = 'alice@school.edu'").get().id;
  const cs101 = db.prepare("SELECT id FROM courses WHERE code = 'CS101'").get().id;
  const math205 = db.prepare("SELECT id FROM courses WHERE code = 'MATH205'").get().id;
  const insertReg = db.prepare(
    'INSERT INTO registrations (user_id, course_id) VALUES (?, ?)'
  );
  insertReg.run(aliceId, cs101);
  insertReg.run(aliceId, math205);
}

export { hashPassword };
