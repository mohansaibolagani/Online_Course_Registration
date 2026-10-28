# Online Course Registration System

A web-based application that automates the course registration process for educational
institutions. Students create accounts, browse available courses, register or join
waitlists, and track their registration status. Administrators manage courses, monitor
registrations, and maintain student records.

## Security features

| Requirement | Implementation |
| --- | --- |
| **Authentication** | Session login with scrypt password hashing (per-user 16-byte salt, 64-byte derived key, `timingSafeEqual` comparison) |
| **Authorization** | Role-based middleware — `requireAuth` for students, `requireAdmin` for admin routes; ownership checks on dropping registrations |
| **JWT tokens** | HS256 JWTs signed with `node:crypto` (`server/jwt.js`): `sub`, `jti`, `role`, `iat`, `exp` (7 days). Each JWT is bound to a DB session row, so logout revokes it immediately. Secret from `JWT_SECRET` env var, else a generated `data/jwt-secret.key` |
| **API key validation** | `X-API-Key: crc_…` keys (`POST /api/keys`), stored as SHA-256 hashes, plaintext returned once, revocable via `DELETE /api/keys/:id`, `last_used_at` tracked |
| **Password hashing** | scrypt (`node:crypto`), never stored or logged in plaintext |
| **REST API** | JSON API under `/api` for auth, courses, registrations, students, and API keys |
| **HTTPS/TLS** | Set `SSL_KEY_FILE` + `SSL_CERT_FILE` to serve HTTPS (`HTTPS_PORT`, default 3443) with HTTP→HTTPS 301 redirect; HSTS header always sent |
| **Input validation** | Centralized validators (`server/validate.js`) for every body/query/path parameter: type checks, length bounds, email format, integer ranges, course-code pattern; malformed JSON returns 400 |
| **Hardening** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS, `x-powered-by` disabled, 64 KB body limit, constant-ish error messages on failed login |

## Quick start

```bash
npm install
npm start          # http://localhost:3000
npm test           # 25 tests: API + security suite
```

HTTPS mode (self-signed dev certificate):

```bash
openssl req -x509 -newkey rsa:2048 -keyout .cert/key.pem -out .cert/cert.pem \
  -days 2 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"
SSL_KEY_FILE=.cert/key.pem SSL_CERT_FILE=.cert/cert.pem npm start
# https://localhost:3443  (HTTP on :3000 redirects there)
```

On first run the database is seeded with 8 courses, an admin, and two demo students.

| Role    | Email              | Password    |
| ------- | ------------------ | ----------- |
| Admin   | admin@school.edu   | admin123    |
| Student | alice@school.edu   | student123  |
| Student | bob@school.edu     | student123  |

Data lives in `data/registration.db` (delete it to reset and re-seed). Environment
variables: `PORT`, `HTTPS_PORT`, `SSL_KEY_FILE`, `SSL_CERT_FILE`, `JWT_SECRET`, `DB_FILE`.

## Testing results

```
npm test   →  25/25 pass  (test/api.test.js + test/security.test.js)
```

- **API suite (10):** seed data, registration + duplicate rejection (409), wrong password
  (401), course registration flow, waitlisting at capacity, role enforcement (401/403),
  drop/re-register, cross-user drop protection (403), student deletion cascade, search/pagination.
- **Security suite (15):** JWT verify + claim decode; tampered payload / wrong signature /
  `alg=none` / expired / garbage tokens rejected; logout revocation; foreign-secret JWT
  rejected; API key issuance (hash never leaked), authentication, invalid/malformed/revoked
  rejection (401), cross-user revoke protection; input-validation matrix on register/login/
  courses (400s), malformed JSON (400), bad query/path params (400), authorization matrix,
  security headers.
- **HTTPS smoke test (manual, curl):** `GET https://localhost:3443/api/courses → 200` over
  TLS; `http://:3000 → 301 https://`; HSTS/CSP/nosniff/X-Frame-Options present, no
  `x-powered-by`; admin login over TLS → JWT accepted (200); API key issued over TLS works
  on `/api/students` (200) while a forged key gets 401; certificate loaded (CN=localhost).

## REST API

All endpoints are under `/api`. Authenticate with `Authorization: Bearer <JWT>` (from
login/register) **or** `X-API-Key: crc_…`. Errors return `{ "error": "message" }`.

### Auth
| Method | Path                  | Access | Description |
| ------ | --------------------- | ------ | ----------- |
| POST   | /api/auth/register    | public | Create a student account → JWT |
| POST   | /api/auth/login       | public | Log in → JWT |
| POST   | /api/auth/logout      | auth   | Revoke the session behind the JWT |
| GET    | /api/auth/me          | auth   | Current user + auth method (`jwt`/`apikey`) |

### API keys
| Method | Path            | Access | Description |
| ------ | --------------- | ------ | ----------- |
| POST   | /api/keys       | auth   | Issue a key (raw value returned once) |
| GET    | /api/keys       | auth   | List own keys (prefix, timestamps, revoked) |
| DELETE | /api/keys/:id   | auth   | Revoke a key |

### Courses
| Method | Path                   | Access | Description |
| ------ | ---------------------- | ------ | ----------- |
| GET    | /api/courses           | public | List courses (`?q=`, `?page=`, `?limit=`); seats + `registered` flag |
| GET    | /api/courses/:id       | public | Course detail |
| POST   | /api/courses           | admin  | Create a course |
| PUT    | /api/courses/:id       | admin  | Update (capacity cannot drop below enrollment) |
| DELETE | /api/courses/:id       | admin  | Delete (cascades registrations) |

### Registrations
| Method | Path                      | Access | Description |
| ------ | ------------------------- | ------ | ----------- |
| POST   | /api/registrations        | auth   | Register — duplicates 409; full course → waitlist |
| GET    | /api/registrations        | auth   | Own list, or all for admin (`?course_id=`, `?student_id=`) |
| DELETE | /api/registrations/:id    | auth   | Drop (owner or admin) |

### Students (admin)
| Method | Path                    | Access | Description |
| ------ | ----------------------- | ------ | ----------- |
| GET    | /api/students           | admin  | List students + registration counts |
| PUT    | /api/students/:id       | admin  | Update name/email/password |
| DELETE | /api/students/:id       | admin  | Delete student (cascades registrations) |

## Project structure

```
server/
  index.js      # HTTP entry point + optional HTTPS/TLS mode
  app.js        # Express app, REST routes, security headers, error handling
  auth.js       # password hashing, JWT sessions, API keys, middleware
  jwt.js        # HS256 sign/verify (node:crypto)
  validate.js   # centralized input validation
  db.js         # SQLite connection, schema, seed data
public/
  index.html    # SPA shell
  app.js        # frontend (student + admin views)
  styles.css
test/
  api.test.js     # functional API tests
  security.test.js # JWT / API key / validation / authz / headers tests
```
