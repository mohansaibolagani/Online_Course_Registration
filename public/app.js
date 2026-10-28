/* Frontend SPA for the Online Course Registration System (vanilla JS).
   - Student portal: light theme at  #/        (login/register tabs)
   - Admin portal:   dark theme at   #/admin    (dedicated administrator sign-in)
   - Admin console:  dark sidebar app with dashboard/user data at #/admin/dashboard
*/
(() => {
  const topbar = document.getElementById('topbar');
  const main = document.getElementById('main');
  const toastEl = document.getElementById('toast');
  const modalRoot = document.getElementById('modal-root');

  let token = localStorage.getItem('token') || null;
  let user = null;
  let toastTimer = null;

  // ---------- helpers ----------
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const initials = (name) =>
    String(name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  const ICONS = {
    cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 6h18"/><path d="m7 22-4-4 4-4"/><path d="M21 18H3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15v-4M12 15V7M17 15v-7"/></svg>',
  };

  function toast(message, isError = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show${isError ? ' error' : ''}`;
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3300);
  }

  // Animated confirmation modal (replaces native confirm()).
  function confirmDialog(message, { danger = true, title = 'Are you sure?' } = {}) {
    return new Promise((resolve) => {
      modalRoot.innerHTML = `
        <div class="modal-backdrop" id="mb">
          <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="modal-icon">${danger ? '!' : '?'}</div>
            <div class="modal-msg">${esc(message)}</div>
            <div class="modal-actions">
              <button class="btn btn-ghost" id="m-cancel">Cancel</button>
              <button class="btn ${danger ? 'btn-solid-danger' : ''}" id="m-ok">Yes, continue</button>
            </div>
          </div>
        </div>`;
      const backdrop = document.getElementById('mb');
      requestAnimationFrame(() => backdrop.classList.add('open'));
      const done = (val) => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', onKey);
      document.getElementById('m-ok').onclick = () => done(true);
      document.getElementById('m-cancel').onclick = () => done(false);
      backdrop.onclick = (e) => { if (e.target === backdrop) done(false); };
      document.getElementById('m-ok').focus();
    });
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function setSession(newToken, newUser) {
    token = newToken;
    user = newUser;
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
    route();
  }

  // ---------- routing ----------
  function currentRoute() {
    const hash = location.hash.replace(/^#/, '');
    if (hash === '/admin') return 'admin-login';
    if (hash.startsWith('/admin/')) return hash.slice(7) || 'dashboard';
    if (hash === '/register') return 'register';
    if (hash === '/logout') return 'logout';
    return 'home';
  }

  function navigate(path) {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  }

  function setTheme(mode) {
    document.body.classList.toggle('theme-admin-auth', mode === 'admin-auth');
    document.body.classList.toggle('theme-admin', mode === 'admin');
  }

  // ---------- chrome (topbar / console shell) ----------
  function renderTopbar() {
    topbar.style.display = 'none';
    topbar.innerHTML = '';
    if (!user) return;
    topbar.style.display = '';
    const isAdminView = user.role === 'admin';
    topbar.innerHTML = `
      <div class="brand">${ICONS.cap}<span>Course Registration</span>
        <span class="portal-tag ${isAdminView ? 'tag-admin' : ''}">${isAdminView ? 'Admin preview' : 'Student portal'}</span>
      </div>
      <div class="user-area">
        <span class="user-name">${esc(user.name)}</span>
        <span class="role-tag ${isAdminView ? 'tag-admin' : ''}">${esc(user.role)}</span>
        <button class="btn btn-ghost btn-sm" id="logout-btn">${ICONS.logout} Log out</button>
      </div>`;
    document.getElementById('logout-btn').onclick = doLogout;
  }

  function consoleBanner() {
    return `
      <div class="console-banner">
        <span>🛡️ You are signed in as an <b>administrator</b> — this is the student-facing portal.</span>
        <button class="btn btn-sm" data-nav="/admin/dashboard">Open admin console</button>
        <button class="btn btn-sm btn-ghost" id="banner-logout">Log out</button>
      </div>`;
  }

  async function doLogout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* expired token */ }
    setSession(null, null);
    toast('Logged out — session revoked');
  }

  // ==========================================================================
  // AUTH PAGES
  // ==========================================================================
  function studentAuthView(mode = 'login') {
    setTheme('student-auth');
    topbar.style.display = '';
    topbar.innerHTML = `
      <div class="brand">${ICONS.cap}<span>Course Registration</span>
        <span class="portal-tag">Student portal</span></div>
      <div class="user-area"><a href="#/admin" style="font-size:13.5px;font-weight:600">Administrator? Sign in →</a></div>`;

    main.innerHTML = `
      <div class="auth-stage">
        <div class="orb orb-a"></div>
        <div class="orb orb-b"></div>
        <div class="card auth-card">
          <span class="portal-badge">${ICONS.cap} Student portal</span>
          <h1>Welcome back</h1>
          <p class="sub">Sign in to browse courses, register, and track your enrollment.</p>
          <div class="tabs">
            <button id="tab-login" class="${mode === 'login' ? 'active' : ''}">Log in</button>
            <button id="tab-register" class="${mode === 'register' ? 'active' : ''}">Create account</button>
          </div>
          <form id="auth-form" novalidate>
            <div id="reg-name" class="${mode === 'register' ? '' : 'hidden'}">
              <label for="name">Full name</label>
              <input id="name" autocomplete="name" placeholder="Jane Doe" />
            </div>
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" placeholder="you@school.edu" required />
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="••••••••" required />
            <button class="btn btn-block" type="submit" id="auth-submit">${mode === 'login' ? 'Log in' : 'Create account'}</button>
            <div class="error-text" id="auth-error"></div>
          </form>
          <p class="hint">Demo student — <code>alice@school.edu</code> / <code>student123</code></p>
          <div class="portal-switch">
            Administrator? Use the
            <a href="#/admin">admin console <span class="arrow">→</span></a>
          </div>
        </div>
      </div>`;

    const $ = (id) => document.getElementById(id);
    $('tab-login').onclick = () => studentAuthView('login');
    $('tab-register').onclick = () => studentAuthView('register');

    $('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      $('auth-error').textContent = '';
      const isRegister = !$('reg-name').classList.contains('hidden');
      try {
        const payload = { email: $('email').value.trim(), password: $('password').value };
        if (isRegister) payload.name = $('name').value.trim();
        const data = await api(`/auth/${isRegister ? 'register' : 'login'}`, { method: 'POST', body: payload });
        setSession(data.token, data.user);
        toast(isRegister ? 'Account created — welcome!' : `Welcome back, ${data.user.name}!`);
      } catch (err) {
        $('auth-error').textContent = err.message;
        $('auth-error').animate(
          [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: 260, easing: 'ease-in-out' }
        );
      }
    };
  }

  function adminLoginView() {
    setTheme('admin-auth');
    topbar.style.display = '';
    topbar.innerHTML = `
      <div class="brand">${ICONS.shield}<span>Course Registration</span>
        <span class="portal-tag tag-admin">Administrator console</span></div>
      <div class="user-area"><a href="#/" style="font-size:13.5px;font-weight:600">← Back to student portal</a></div>`;

    main.innerHTML = `
      <div class="auth-stage">
        <div class="orb orb-a"></div>
        <div class="orb orb-b"></div>
        <div class="card auth-card auth-card--admin">
          <div class="shield-orb">${ICONS.shield}</div>
          <span class="portal-badge admin">${ICONS.shield} Restricted access</span>
          <h1>Administrator Console</h1>
          <p class="sub">Staff sign-in. Sessions here grant course, registration, and student management powers.</p>
          <form id="admin-form" novalidate>
            <label for="a-email">Admin email</label>
            <input id="a-email" type="email" autocomplete="username" placeholder="admin@school.edu" required />
            <label for="a-password">Password</label>
            <input id="a-password" type="password" autocomplete="current-password" placeholder="••••••••" required />
            <button class="btn btn-block" type="submit" id="a-submit">Sign in to console</button>
            <div class="error-text" id="a-error"></div>
          </form>
          <p class="hint">Demo admin — <code>admin@school.edu</code> / <code>admin123</code></p>
          <div class="portal-switch">
            Looking for course registration?
            <a href="#/"><span class="arrow">←</span> Student portal</a>
          </div>
        </div>
      </div>`;

    const $ = (id) => document.getElementById(id);
    $('admin-form').onsubmit = async (e) => {
      e.preventDefault();
      $('a-error').textContent = '';
      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: { email: $('a-email').value.trim(), password: $('a-password').value },
        });
        if (data.user.role !== 'admin') {
          $('a-error').textContent = 'This account has no administrator privileges. Use the student portal instead.';
          return;
        }
        setSession(data.token, data.user);
        toast(`Welcome back, ${data.user.name} — admin session active`);
      } catch (err) {
        $('a-error').textContent = err.message;
        $('a-error').animate(
          [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: 260, easing: 'ease-in-out' }
        );
      }
    };
  }

  // ==========================================================================
  // STUDENT PORTAL
  // ==========================================================================
  function studentShell() {
    setTheme('student');
    renderTopbar();
    return `
      ${user.role === 'admin' ? consoleBanner() : ''}
      <div class="container view-enter" id="student-root"></div>`;
  }

  function bindBanner() {
    const b = document.querySelector('[data-nav]');
    if (b) b.onclick = () => navigate('/admin/dashboard');
    const l = document.getElementById('banner-logout');
    if (l) l.onclick = doLogout;
  }

  async function studentView(tab = 'courses') {
    main.innerHTML = `
      ${studentShell()}`;
    bindBanner();
    const root = document.getElementById('student-root');
    root.innerHTML = `
      <div class="tabs">
        <button id="s-tab-courses" class="${tab === 'courses' ? 'active' : ''}">Browse courses</button>
        <button id="s-tab-regs" class="${tab === 'regs' ? 'active' : ''}">My registrations</button>
      </div>
      <div id="s-content"><div class="empty">Loading…</div></div>`;
    document.getElementById('s-tab-courses').onclick = () => studentView('courses');
    document.getElementById('s-tab-regs').onclick = () => studentView('regs');
    if (tab === 'courses') await browseCourses();
    else await myRegistrations();
  }

  async function browseCourses() {
    const content = document.getElementById('s-content');
    content.innerHTML = `
      <div class="page-head">
        <div><h2>Available courses</h2><p class="subtle">Search, check seats, and register in one click.</p></div>
        <div class="toolbar">
          <input id="q" placeholder="Search code, title, instructor…" />
          <button class="btn" id="search-btn">Search</button>
        </div>
      </div>
      <div id="course-grid" class="grid"><div class="empty">Loading…</div></div>`;

    const load = async (q = '') => {
      const grid = document.getElementById('course-grid');
      try {
        const { courses } = await api(`/courses${q ? `?q=${encodeURIComponent(q)}` : ''}`);
        if (!courses.length) {
          grid.innerHTML = '<div class="empty">No courses match your search.</div>';
          return;
        }
        grid.classList.add('stagger');
        grid.innerHTML = courses
          .map((c, i) => {
            const full = c.seats_left <= 0;
            return `
            <div class="card course" style="--i:${i}">
              <span class="code">${esc(c.code)}</span>
              <h3>${esc(c.title)}</h3>
              <div class="desc">${esc(c.description)}</div>
              <div class="meta">
                <span>👤 ${esc(c.instructor || 'TBA')}</span>
                <span>🗓 ${esc(c.schedule || 'TBA')}</span>
                <span>🎓 ${c.credits} credit${c.credits === 1 ? '' : 's'}</span>
              </div>
              <div class="footer">
                ${c.registered
                  ? '<span class="badge ok">✓ Registered</span>'
                  : full
                    ? '<span class="badge warn">Full — waitlist</span>'
                    : `<span class="badge ${c.seats_left <= 5 ? 'warn' : 'ok'}">${c.seats_left}/${c.capacity} seats left</span>`}
                <button class="btn btn-sm" data-register="${c.id}" ${c.registered ? 'disabled' : ''}>
                  ${c.registered ? 'Registered' : full ? 'Waitlist' : 'Register'}
                </button>
              </div>
            </div>`;
          })
          .join('');

        grid.querySelectorAll('[data-register]').forEach((btn) => {
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const data = await api('/registrations', {
                method: 'POST',
                body: { course_id: Number(btn.dataset.register) },
              });
              toast(data.message);
              load(document.getElementById('q').value.trim());
            } catch (err) {
              toast(err.message, true);
              btn.disabled = false;
            }
          };
        });
      } catch (err) {
        grid.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
      }
    };

    document.getElementById('search-btn').onclick = () => load(document.getElementById('q').value.trim());
    document.getElementById('q').onkeydown = (e) => { if (e.key === 'Enter') load(e.target.value.trim()); };
    await load();
  }

  async function myRegistrations() {
    const content = document.getElementById('s-content');
    try {
      const { registrations } = await api('/registrations');
      if (!registrations.length) {
        content.innerHTML = '<div class="empty">You have not registered for any courses yet.</div>';
        return;
      }
      content.innerHTML = `
        <div class="page-head"><div><h2>My registrations (${registrations.length})</h2>
          <p class="subtle">Drop a course any time before the deadline.</p></div></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Code</th><th>Course</th><th>Credits</th><th>Status</th><th>Registered</th><th></th></tr></thead>
            <tbody class="stagger">
              ${registrations.map((r, i) => `
                <tr style="--i:${i}">
                  <td><strong>${esc(r.code)}</strong></td>
                  <td>${esc(r.title)}</td>
                  <td>${r.credits}</td>
                  <td><span class="badge ${r.status === 'registered' ? 'ok' : 'warn'}">${esc(r.status)}</span></td>
                  <td>${esc(String(r.created_at).slice(0, 10))}</td>
                  <td class="actions"><button class="btn btn-sm btn-danger" data-drop="${r.id}">Drop</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      content.querySelectorAll('[data-drop]').forEach((btn) => {
        btn.onclick = async () => {
          if (!(await confirmDialog('Drop this course? You can re-register later if seats remain.'))) return;
          try {
            await api(`/registrations/${btn.dataset.drop}`, { method: 'DELETE' });
            toast('Course dropped');
            myRegistrations();
          } catch (err) { toast(err.message, true); }
        };
      });
    } catch (err) {
      content.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  // ==========================================================================
  // ADMIN CONSOLE
  // ==========================================================================
  const ADMIN_NAV = [
    { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
    { key: 'courses', label: 'Courses', icon: 'book' },
    { key: 'registrations', label: 'Registrations', icon: 'clipboard' },
    { key: 'students', label: 'User data', icon: 'users' },
  ];

  function adminShell(active) {
    setTheme('admin');
    topbar.style.display = 'none';
    topbar.innerHTML = '';
    main.innerHTML = `
      <div class="admin-shell">
        <aside class="sidebar">
          <div class="side-brand">
            <div class="side-logo">${ICONS.shield}</div>
            <div>
              <div class="side-title">Admin Console</div>
              <div class="side-sub">Course Registration</div>
            </div>
          </div>
          <nav class="side-nav">
            ${ADMIN_NAV.map((n) => `
              <button class="nav-item ${n.key === active ? 'active' : ''}" data-admin-nav="${n.key}">
                ${ICONS[n.icon]} ${n.label}
              </button>`).join('')}
          </nav>
          <div class="side-foot">
            <button class="nav-item" data-admin-nav="students-portal">${ICONS.swap} Student portal</button>
            <button class="nav-item danger" id="admin-logout">${ICONS.logout} Log out</button>
          </div>
        </aside>
        <div class="admin-main view-enter">
          <header class="console-top">
            <div class="console-heading">
              <h1 id="console-title"></h1>
              <p id="console-sub"></p>
            </div>
            <div class="me-chip">
              <span class="avatar sm">${initials(user.name)}</span>
              <div class="me-meta">
                <span class="me-name">${esc(user.name)}</span>
                <span class="role-tag tag-admin">Administrator</span>
              </div>
            </div>
          </header>
          <div class="console-content" id="console-content"><div class="empty">Loading…</div></div>
        </div>
      </div>`;

    main.querySelectorAll('[data-admin-nav]').forEach((btn) => {
      btn.onclick = () => {
        const dest = btn.dataset.adminNav;
        if (dest === 'students-portal') navigate('/');
        else navigate(`/admin/${dest}`);
      };
    });
    document.getElementById('admin-logout').onclick = doLogout;
    return document.getElementById('console-content');
  }

  function setConsoleHeading(title, sub) {
    document.getElementById('console-title').textContent = title;
    document.getElementById('console-sub').textContent = sub;
    document.title = `${title} · Admin Console`;
  }

  async function adminDashboard() {
    const content = adminShell('dashboard');
    setConsoleHeading('Dashboard', 'Overview of students, courses, and registration activity.');
    try {
      const [{ students }, { courses }, { registrations }] = await Promise.all([
        api('/students'),
        api('/courses'),
        api('/registrations'),
      ]);
      const activeRegs = registrations.filter((r) => r.status === 'registered');
      const seats = courses.reduce((s, c) => s + c.capacity, 0);
      const fill = seats ? Math.round((activeRegs.length / seats) * 100) : 0;

      const byStudent = {};
      const byCourse = {};
      for (const r of registrations) {
        byStudent[r.student_name] = (byStudent[r.student_name] || 0) + 1;
        byCourse[`${r.code} — ${r.title}`] = (byCourse[`${r.code} — ${r.title}`] || 0) + 1;
      }
      const topStudents = Object.entries(byStudent).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const topCourses = Object.entries(byCourse).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const maxCourse = topCourses.length ? topCourses[0][1] : 1;
      const recent = [...registrations]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 7);

      content.innerHTML = `
        <section class="stats-grid stagger">
          <div class="stat-card" style="--i:0">
            <div class="stat-icon i-blue">${ICONS.users}</div>
            <div><span class="stat-num" data-count="${students.length}">0</span></div>
            <div class="stat-label">Registered students</div>
            <div class="stat-sub">Accounts with student role</div>
          </div>
          <div class="stat-card" style="--i:1">
            <div class="stat-icon i-violet">${ICONS.book}</div>
            <div><span class="stat-num" data-count="${courses.length}">0</span></div>
            <div class="stat-label">Active courses</div>
            <div class="stat-sub">${seats} total seats offered</div>
          </div>
          <div class="stat-card" style="--i:2">
            <div class="stat-icon i-amber">${ICONS.chart}</div>
            <div><span class="stat-num" data-count="${activeRegs.length}">0</span></div>
            <div class="stat-label">Active registrations</div>
            <div class="stat-sub">${registrations.length - activeRegs.length} waitlisted · ${fill}% seat fill</div>
          </div>
          <div class="stat-card" style="--i:3">
            <div class="stat-icon i-green">${ICONS.clipboard}</div>
            <div><span class="stat-num" data-count="${registrations.length}">0</span></div>
            <div class="stat-label">Registration records</div>
            <div class="stat-sub">All-time including waitlist</div>
          </div>
        </section>

        <section class="dash-grid">
          <div class="card panel">
            <div class="panel-head">
              <h3>Recent registration activity</h3>
              <button class="btn btn-sm btn-ghost" data-go="registrations">View all →</button>
            </div>
            ${recent.length ? `
              <ul class="activity-list stagger">
                ${recent.map((r, i) => `
                  <li style="--i:${i}">
                    <div>
                      <div class="act-who">${esc(r.student_name)}</div>
                      <div class="act-course">${esc(r.code)} — ${esc(r.title)}</div>
                    </div>
                    <div class="act-right">
                      <span class="badge ${r.status === 'registered' ? 'ok' : 'warn'}">${esc(r.status)}</span>
                      <span class="act-date">${esc(String(r.created_at).slice(0, 10))}</span>
                    </div>
                  </li>`).join('')}
              </ul>`
              : '<div class="empty">No registrations yet.</div>'}
          </div>

          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card panel">
              <div class="panel-head"><h3>Top courses by enrollment</h3></div>
              ${topCourses.length ? `
                <div class="bars stagger">
                  ${topCourses.map(([label, count], i) => `
                    <div style="--i:${i}">
                      <div class="bar-meta"><b>${esc(label)}</b><span>${count} student${count === 1 ? '' : 's'}</span></div>
                      <div class="bar-track"><div class="bar-fill" data-w="${Math.round((count / maxCourse) * 100)}"></div></div>
                    </div>`).join('')}
                </div>`
                : '<div class="empty">No data yet.</div>'}
            </div>

            <div class="card panel">
              <div class="panel-head"><h3>Quick actions</h3></div>
              <div class="quick-actions">
                <button class="btn btn-ghost" data-go="students">👥 View all user data</button>
                <button class="btn btn-ghost" data-go="courses">📚 Manage courses</button>
                <button class="btn btn-ghost" data-go="registrations">📋 Review registrations</button>
              </div>
              <div class="compare">
                <h4>You are here vs. students</h4>
                <div class="compare-grid">
                  <div class="compare-col">
                    <div class="compare-tag student">👤 Student login</div>
                    <ul>
                      <li>Light portal at <code>#/</code></li>
                      <li>Browse &amp; register for courses</li>
                      <li>Own registrations only</li>
                    </ul>
                  </div>
                  <div class="compare-col highlight">
                    <div class="compare-tag admin">🛡️ Admin login — you</div>
                    <ul>
                      <li>Dark console at <code>#/admin</code></li>
                      <li>All user data &amp; stats</li>
                      <li>Full course/registration control</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>`;

      // count-up + bar-fill animations
      content.querySelectorAll('[data-count]').forEach((el) => {
        const target = Number(el.dataset.count);
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / 900);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      requestAnimationFrame(() =>
        content.querySelectorAll('.bar-fill').forEach((b) => (b.style.width = `${b.dataset.w}%`))
      );
      content.querySelectorAll('[data-go]').forEach((b) => {
        b.onclick = () => navigate(`/admin/${b.dataset.go}`);
      });
    } catch (err) {
      content.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  function courseFormHtml(c = {}) {
    return `
      <form id="course-form" class="card" style="display:none">
        <h3 style="margin:0 0 6px">${c.id ? `Edit ${esc(c.code)}` : 'Add a new course'}</h3>
        <div class="form-row">
          <div><label>Code</label><input id="c-code" value="${esc(c.code || '')}" placeholder="CS101" /></div>
          <div><label>Title</label><input id="c-title" value="${esc(c.title || '')}" placeholder="Introduction to…" /></div>
        </div>
        <label>Description</label>
        <textarea id="c-desc" rows="2">${esc(c.description || '')}</textarea>
        <div class="form-row">
          <div><label>Instructor</label><input id="c-instructor" value="${esc(c.instructor || '')}" /></div>
          <div><label>Schedule</label><input id="c-schedule" value="${esc(c.schedule || '')}" placeholder="Mon/Wed 09:00-10:30" /></div>
        </div>
        <div class="form-row">
          <div><label>Credits</label><input id="c-credits" type="number" min="1" max="10" value="${c.credits ?? 3}" /></div>
          <div><label>Capacity</label><input id="c-capacity" type="number" min="1" max="1000" value="${c.capacity ?? 30}" /></div>
        </div>
        <div style="margin-top:14px; display:flex; gap:8px">
          <button class="btn" type="submit">${c.id ? 'Save changes' : 'Create course'}</button>
          <button class="btn btn-ghost" type="button" id="course-cancel">Cancel</button>
        </div>
        <div class="error-text" id="course-error"></div>
      </form>`;
  }

  async function adminCourses() {
    const content = adminShell('courses');
    setConsoleHeading('Course management', 'Create, edit, and retire courses; watch enrollment fill up.');
    content.innerHTML = `
      <div class="page-head">
        <div class="toolbar"><button class="btn" id="add-course-btn">+ Add course</button></div>
      </div>
      <div id="course-form-slot"></div>
      <div id="courses-table"><div class="empty">Loading…</div></div>`;

    const slot = document.getElementById('course-form-slot');
    let editingId = null;

    const openForm = (c = null) => {
      editingId = c?.id ?? null;
      slot.innerHTML = courseFormHtml(c || {});
      const form = document.getElementById('course-form');
      form.style.display = 'block';
      form.classList.add('view-enter');
      document.getElementById('course-cancel').onclick = () => { slot.innerHTML = ''; editingId = null; };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = {
          code: document.getElementById('c-code').value.trim(),
          title: document.getElementById('c-title').value.trim(),
          description: document.getElementById('c-desc').value.trim(),
          instructor: document.getElementById('c-instructor').value.trim(),
          schedule: document.getElementById('c-schedule').value.trim(),
          credits: Number(document.getElementById('c-credits').value),
          capacity: Number(document.getElementById('c-capacity').value),
        };
        try {
          if (editingId) await api(`/courses/${editingId}`, { method: 'PUT', body });
          else await api('/courses', { method: 'POST', body });
          toast(editingId ? 'Course updated' : 'Course created');
          adminCourses();
        } catch (err) {
          document.getElementById('course-error').textContent = err.message;
        }
      };
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    document.getElementById('add-course-btn').onclick = () => openForm();

    const table = document.getElementById('courses-table');
    try {
      const { courses } = await api('/courses');
      if (!courses.length) {
        table.innerHTML = '<div class="empty">No courses yet — add one to get started.</div>';
        return;
      }
      table.innerHTML = `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Code</th><th>Title</th><th>Instructor</th><th>Schedule</th><th>Credits</th><th>Enrolled</th><th>Actions</th></tr></thead>
            <tbody class="stagger">
              ${courses.map((c, i) => `
                <tr style="--i:${i}">
                  <td><strong>${esc(c.code)}</strong></td>
                  <td>${esc(c.title)}<div class="act-course">${esc(c.description).slice(0, 64)}${c.description.length > 64 ? '…' : ''}</div></td>
                  <td>${esc(c.instructor || '—')}</td>
                  <td>${esc(c.schedule || '—')}</td>
                  <td>${c.credits}</td>
                  <td><span class="badge ${c.seats_left > 0 ? 'ok' : 'warn'}">${c.seats_taken}/${c.capacity}</span></td>
                  <td class="actions">
                    <button class="btn btn-sm btn-ghost" data-edit="${c.id}">Edit</button>
                    <button class="btn btn-sm btn-danger" data-delete="${c.id}">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      table.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = () => openForm(courses.find((c) => c.id === Number(btn.dataset.edit)));
      });
      table.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.onclick = async () => {
          const course = courses.find((c) => c.id === Number(btn.dataset.delete));
          if (!(await confirmDialog(`Delete ${course.code} — ${course.title}? This removes its ${course.seats_taken} registration(s) too.`))) return;
          try {
            await api(`/courses/${course.id}`, { method: 'DELETE' });
            toast('Course deleted');
            adminCourses();
          } catch (err) { toast(err.message, true); }
        };
      });
    } catch (err) {
      table.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  async function adminRegistrations() {
    const content = adminShell('registrations');
    setConsoleHeading('Registrations', 'Every registration across all students and courses.');
    try {
      const [{ registrations }, { courses }] = await Promise.all([api('/registrations'), api('/courses')]);
      content.innerHTML = `
        <div class="page-head">
          <div class="toolbar">
            <select id="filter-course">
              <option value="">All courses</option>
              ${courses.map((c) => `<option value="${c.id}">${esc(c.code)} — ${esc(c.title)}</option>`).join('')}
            </select>
            <span class="badge ok" id="reg-count">${registrations.length} records</span>
          </div>
        </div>
        <div id="regs-table"></div>`;

      const renderTable = (rows) => {
        const el = document.getElementById('regs-table');
        document.getElementById('reg-count').textContent = `${rows.length} records`;
        if (!rows.length) { el.innerHTML = '<div class="empty">No registrations found.</div>'; return; }
        el.innerHTML = `
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Student</th><th>Email</th><th>Course</th><th>Credits</th><th>Status</th><th>Date</th><th></th></tr></thead>
              <tbody class="stagger">
                ${rows.map((r, i) => `
                  <tr style="--i:${i}">
                    <td><div class="person"><span class="avatar sm">${initials(r.student_name)}</span><span class="person-name">${esc(r.student_name)}</span></div></td>
                    <td>${esc(r.student_email)}</td>
                    <td><strong>${esc(r.code)}</strong> — ${esc(r.title)}</td>
                    <td>${r.credits}</td>
                    <td><span class="badge ${r.status === 'registered' ? 'ok' : 'warn'}">${esc(r.status)}</span></td>
                    <td>${esc(String(r.created_at).slice(0, 10))}</td>
                    <td class="actions"><button class="btn btn-sm btn-danger" data-remove="${r.id}">Remove</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
        el.querySelectorAll('[data-remove]').forEach((btn) => {
          btn.onclick = async () => {
            if (!(await confirmDialog('Remove this registration? The student will lose this seat.'))) return;
            try {
              await api(`/registrations/${btn.dataset.remove}`, { method: 'DELETE' });
              toast('Registration removed');
              adminRegistrations();
            } catch (err) { toast(err.message, true); }
          };
        });
      };
      renderTable(registrations);
      document.getElementById('filter-course').onchange = (e) => {
        const id = e.target.value;
        renderTable(id ? registrations.filter((r) => String(r.course_id) === id) : registrations);
      };
    } catch (err) {
      content.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  // ---- user data (students) ----
  async function adminStudents() {
    const content = adminShell('students');
    setConsoleHeading('User data', 'All student accounts, their contact details, and registration activity.');
    try {
      const { students } = await api('/students');
      const totalRegs = students.reduce((s, x) => s + x.registrations, 0);
      content.innerHTML = `
        <section class="stats-grid stagger">
          <div class="stat-card" style="--i:0">
            <div class="stat-icon i-blue">${ICONS.users}</div>
            <div><span class="stat-num" data-count="${students.length}">0</span></div>
            <div class="stat-label">Student accounts</div>
          </div>
          <div class="stat-card" style="--i:1">
            <div class="stat-icon i-green">${ICONS.clipboard}</div>
            <div><span class="stat-num" data-count="${totalRegs}">0</span></div>
            <div class="stat-label">Registrations by students</div>
          </div>
          <div class="stat-card" style="--i:2">
            <div class="stat-icon i-violet">${ICONS.chart}</div>
            <div><span class="stat-num" data-count="${students.filter((s) => s.registrations > 0).length}">0</span></div>
            <div class="stat-label">Active students</div>
            <div class="stat-sub">Have at least one registration</div>
          </div>
        </section>

        ${students.length ? `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Student</th><th>Email</th><th>Role</th><th>Registrations</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody class="stagger">
              ${students.map((s, i) => `
                <tr style="--i:${i}">
                  <td><div class="person"><span class="avatar">${initials(s.name)}</span><span class="person-name">${esc(s.name)}</span></div></td>
                  <td>${esc(s.email)}</td>
                  <td><span class="badge ${s.role === 'admin' ? 'warn' : 'ok'}">${esc(s.role)}</span></td>
                  <td><span class="badge ${s.registrations ? 'ok' : ''}">${s.registrations}</span></td>
                  <td>${esc(String(s.created_at).slice(0, 10))}</td>
                  <td class="actions"><button class="btn btn-sm btn-danger" data-del-student="${s.id}">Delete</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="empty">No student accounts yet.</div>'}`;

      content.querySelectorAll('[data-count]').forEach((el) => {
        const target = Number(el.dataset.count);
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / 900);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      content.querySelectorAll('[data-del-student]').forEach((btn) => {
        btn.onclick = async () => {
          if (!(await confirmDialog('Delete this student and ALL of their registrations? This cannot be undone.'))) return;
          try {
            await api(`/students/${btn.dataset.delStudent}`, { method: 'DELETE' });
            toast('Student deleted');
            adminStudents();
          } catch (err) { toast(err.message, true); }
        };
      });
    } catch (err) {
      content.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  }

  // ==========================================================================
  // ROUTER
  // ==========================================================================
  function route() {
    const r = currentRoute();

    if (r === 'logout') { navigate('/'); return; }

    if (r === 'admin-login') {
      if (user && user.role === 'admin') { navigate('/admin/dashboard'); return; }
      adminLoginView();
      document.title = 'Admin Console · Course Registration';
      return;
    }

    if (r.startsWith('admin') || ADMIN_NAV.some((n) => n.key === r)) {
      if (!user) { navigate('/admin'); return; }
      if (user.role !== 'admin') { toast('Administrator access required', true); navigate('/'); return; }
      switch (r) {
        case 'dashboard': adminDashboard(); return;
        case 'courses': adminCourses(); return;
        case 'registrations': adminRegistrations(); return;
        case 'students': adminStudents(); return;
        default: navigate('/admin/dashboard'); return;
      }
    }

    // student portal routes
    if (!user) {
      studentAuthView(r === 'register' ? 'register' : 'login');
      document.title = 'Student Portal · Course Registration';
      return;
    }
    studentView('courses');
    document.title = 'Online Course Registration System';
  }

  window.addEventListener('hashchange', route);

  // Boot: restore session from stored JWT.
  (async () => {
    if (token) {
      try {
        const { user: me } = await api('/auth/me');
        user = me;
      } catch {
        token = null;
        localStorage.removeItem('token');
      }
    }
    route();
  })();
})();
