// ─── Config ───────────────────────────────────────────────────────────────────

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzzHqthBGtaXFoDTEnF5kjBnO8HLV2BG3Y1FWRJcVOlaVx4ZWWjBXobZfFQItub1fW_/exec';
// Course display definitions (for locked card UI)
const ALL_COURSES = [
  {
    id: 'tgeo',
    badge: '🌍',
    title: 'TGeo Crash Course',
    desc: 'Full content summary + intensive problem solving for TGeo and medal-level competitions.',
    tapes: '51 Tapes',
    grad: 'linear-gradient(135deg,#ff8ade,#acfff3)',
  },
  {
    id: 'pastpaper',
    badge: '📄',
    title: 'Past Paper Collection',
    desc: 'Past exam papers grouped by difficulty and exam goal — with detailed answer keys.',
    tapes: '3 Sets',
    grad: 'linear-gradient(135deg,#acfff3,#fbffa4)',
  },
  {
    id: 'summary',
    badge: '📖',
    title: 'Summary Book Collection',
    desc: 'Concise summary books organized by topic — diagrams and tables for easy memorization.',
    tapes: '3 Books',
    grad: 'linear-gradient(135deg,#fbffa4,#ff8ade)',
  },
];

// Head → color mapping
const HEAD_COLORS = {
  'Physical': { bg: '#ff8ade22', border: '#ff8ade44', dot: '#ff8ade' },
  'Fieldwork': { bg: '#acfff322', border: '#acfff344', dot: '#00b4a0' },
  'Human':     { bg: '#fbffa422', border: '#fbffa444', dot: '#c9a700' },
  'Written':   { bg: '#e0e0ff22', border: '#aaaaee44', dot: '#7777cc' },
};

function getHeadColor(head) {
  for (const [key, val] of Object.entries(HEAD_COLORS)) {
    if (head && head.startsWith(key)) return val;
  }
  return { bg: '#f5f5f5', border: '#ddd', dot: '#bbb' };
}

// ─── State ────────────────────────────────────────────────────────────────────

let currentUser   = null;   // { email, name }
let studentData   = null;   // { email, courses[], expireDate }
let contentRows   = [];     // raw rows from Content sheet
let checkedTapes  = {};     // { tapeKey: true/false } — persisted in localStorage
let openHeads     = {};     // { headKey: bool }
let openSubheads  = {};     // { subKey: bool }
let videoModal    = null;   // tape object currently in modal

const STORAGE_KEY = 'geojourney_progress';

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseGSheetJSON(raw) {
  const json = JSON.parse(raw.replace(/.*?\(/, '').replace(/\);\s*$/, ''));
  const cols = json.table.cols.map(c => c.label);
  return json.table.rows
    .filter(row => row.c && row.c.some(c => c && c.v != null))
    .map(row => {
      const obj = {};
      row.c.forEach((cell, i) => { obj[cols[i]] = cell?.v ?? ''; });
      return obj;
    });
}

function getDaysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const exp = new Date(dateStr);
  const now = new Date();
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

function tapeKey(tape) {
  return `${tape.Course}_tape_${tape.TapeNo}`;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    checkedTapes = raw ? JSON.parse(raw) : {};
  } catch(e) {
    checkedTapes = {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedTapes));
  } catch(e) {}
}

function getYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchStudentData(email) {
  const res  = await fetch(`${APPS_SCRIPT_URL}?action=checkAccess&email=${encodeURIComponent(email)}`);
  const data = await res.json();
  if (!data.found) return null;
  return { Email: email, Courses: data.courses.join(','), ExpireDate: data.expireDate };
}

async function fetchContent(courses) {
  const res  = await fetch(`${APPS_SCRIPT_URL}?action=getContent&courses=${encodeURIComponent(courses.join(','))}`);
  const rows = await res.json();
  return rows;
}
// ─── Render helpers ───────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function showScreen(html) {
  document.getElementById('app').innerHTML = '';
  if (typeof html === 'string') {
    document.getElementById('app').innerHTML = html;
  } else {
    document.getElementById('app').appendChild(html);
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openModal(tape) {
  videoModal = tape;
  const ytId = getYouTubeId(tape.DriveLink);
  const backdrop = el('div', { className: 'modal-backdrop', onClick: (e) => {
    if (e.target === backdrop) closeModal();
  }});
  const box = el('div', { className: 'modal-box' });

  // Header
  const header = el('div', { className: 'modal-header' });
  const info   = el('div', {});
  info.appendChild(el('div', { className: 'modal-tape-meta' }, `Tape ${tape.TapeNo} · ${tape['Sub-Head']}`));
  info.appendChild(el('div', { className: 'modal-tape-title' }, tape.Title));
  const closeBtn = el('button', { className: 'modal-close', onClick: closeModal }, '✕');
  header.appendChild(info);
  header.appendChild(closeBtn);
  box.appendChild(header);

  // Video area
  const videoArea = el('div', { className: 'modal-video' });
  if (ytId) {
    const iframe = el('iframe', {
      src: `https://www.youtube.com/embed/${ytId}?autoplay=1`,
      allow: 'autoplay; encrypted-media',
      allowfullscreen: 'true',
    });
    videoArea.appendChild(iframe);
  } else if (tape.DriveLink) {
    const noVid = el('div', { className: 'modal-no-video' });
    noVid.innerHTML = `<div class="icon">▶</div><p>Opens in a new tab</p>
      <a class="modal-open-link" href="${tape.DriveLink}" target="_blank" rel="noopener noreferrer">Open Video →</a>`;
    videoArea.appendChild(noVid);
  } else {
    const noVid = el('div', { className: 'modal-no-video' });
    noVid.innerHTML = `<div class="icon">🎬</div><p style="color:#888">Video link not yet added</p>`;
    videoArea.appendChild(noVid);
  }
  box.appendChild(videoArea);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  // Escape key
  document.addEventListener('keydown', onEscKey);
}

function closeModal() {
  const backdrop = document.querySelector('.modal-backdrop');
  if (backdrop) backdrop.remove();
  document.removeEventListener('keydown', onEscKey);
  videoModal = null;
}

function onEscKey(e) {
  if (e.key === 'Escape') closeModal();
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function buildProgressBar(done, total) {
  const pct  = total > 0 ? Math.round((done / total) * 100) : 0;
  const card = el('div', { className: 'progress-card' });
  card.innerHTML = `
    <div class="progress-header">
      <div>
        <div class="progress-label">Overall Progress</div>
        <div class="progress-pct">${pct}% <span>complete</span></div>
      </div>
      <div class="progress-count"><strong>${done}</strong>/${total} tapes</div>
    </div>
    <div class="progress-track">
      <div class="progress-fill" id="progress-fill" style="width:${pct}%"></div>
    </div>
    ${pct === 100 ? '<div class="progress-complete">🎉 Course complete! Outstanding work!</div>' : ''}
  `;
  return card;
}

function updateProgressBar(done, total) {
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const fill  = document.getElementById('progress-fill');
  const pctEl = document.querySelector('.progress-pct');
  const cntEl = document.querySelector('.progress-count');
  if (fill)  fill.style.width = `${pct}%`;
  if (pctEl) pctEl.innerHTML  = `${pct}% <span>complete</span>`;
  if (cntEl) cntEl.innerHTML  = `<strong>${done}</strong>/${total} tapes`;
}

// ─── Build tape row ───────────────────────────────────────────────────────────

function buildTapeRow(tape, allTapes) {
  const key     = tapeKey(tape);
  const isDone  = !!checkedTapes[key];
  const row     = el('div', { className: `tape-row${isDone ? ' done' : ''}` });

  // Checkbox
  const cb = el('div', { className: `tape-checkbox${isDone ? ' checked' : ''}` }, isDone ? '✓' : '');
  cb.addEventListener('click', () => toggleTape(key, tape, allTapes));
  row.appendChild(cb);

  // Info
  const info = el('div', { className: 'tape-info' });
  info.appendChild(el('div', { className: 'tape-num' }, `Tape ${tape.TapeNo}`));
  info.appendChild(el('div', { className: 'tape-title' }, tape.Title || `Tape ${tape.TapeNo}`));
  row.appendChild(info);

  // Watch button
  const watchBtn = el('button', {
    className: 'btn-watch',
    onClick: (e) => { e.stopPropagation(); openModal(tape); }
  }, '▶ Watch');
  row.appendChild(watchBtn);

  // Click row to toggle
  row.addEventListener('click', () => toggleTape(key, tape, allTapes));

  return row;
}

function toggleTape(key, tape, allTapes) {
  checkedTapes[key] = !checkedTapes[key];
  saveProgress();

  // Update checkbox UI
  const rows = document.querySelectorAll('.tape-row');
  rows.forEach(row => {
    const cb    = row.querySelector('.tape-checkbox');
    const title = row.querySelector('.tape-title');
    const num   = row.querySelector('.tape-num');
    if (num && title && num.textContent === `Tape ${tape.TapeNo}` && title.textContent === (tape.Title || `Tape ${tape.TapeNo}`)) {
      const done = !!checkedTapes[key];
      row.classList.toggle('done', done);
      cb.classList.toggle('checked', done);
      cb.textContent = done ? '✓' : '';
    }
  });

  // Update progress bar
  const done  = allTapes.filter(t => checkedTapes[tapeKey(t)]).length;
  updateProgressBar(done, allTapes.length);
}

// ─── Build sub-head block ─────────────────────────────────────────────────────

function buildSubheadBlock(subHead, tapes, allTapes) {
  const key      = `subhead_${subHead}`;
  const isOpen   = !!openSubheads[key];
  const doneCount = tapes.filter(t => checkedTapes[tapeKey(t)]).length;

  const block  = el('div', { className: 'subhead-block' });
  const header = el('div', { className: 'subhead-header' });

  const left = el('div', { style: { display:'flex', alignItems:'center', gap:'8px', flex:'1', minWidth:'0' }});
  left.appendChild(el('span', { className: 'subhead-title' }, subHead));

  const right = el('div', { style: { display:'flex', alignItems:'center', gap:'6px', flexShrink:'0' }});

  // Done count badge
  if (doneCount > 0) {
    const doneBadge = el('span', {
      style: { fontSize:'11px', color:'#00b4a0', fontWeight:'700', background:'#acfff322', padding:'2px 8px', borderRadius:'100px' }
    }, `${doneCount}/${tapes.length} ✓`);
    right.appendChild(doneBadge);
  } else {
    const totalBadge = el('span', { className: 'subhead-range' }, `${tapes.length} tape${tapes.length > 1 ? 's' : ''}`);
    right.appendChild(totalBadge);
  }

  const chevron = el('span', { className: `subhead-chevron${isOpen ? ' open' : ''}` }, '⌄');
  right.appendChild(chevron);

  header.appendChild(left);
  header.appendChild(right);

  const body = el('div', { className: 'subhead-body', style: { display: isOpen ? 'flex' : 'none' }});
  tapes.forEach(tape => body.appendChild(buildTapeRow(tape, allTapes)));

  header.addEventListener('click', () => {
    openSubheads[key] = !openSubheads[key];
    body.style.display = openSubheads[key] ? 'flex' : 'none';
    chevron.classList.toggle('open', !!openSubheads[key]);
  });

  block.appendChild(header);
  block.appendChild(body);
  return block;
}

// ─── Build head block ─────────────────────────────────────────────────────────

function buildHeadBlock(head, tapes, allTapes) {
  const key      = `head_${head}`;
  const isOpen   = !!openHeads[key];
  const colors   = getHeadColor(head);
  const doneCount = tapes.filter(t => checkedTapes[tapeKey(t)]).length;

  const block  = el('div', { className: 'head-block' });
  const header = el('div', {
    className: 'head-header',
    style: { background: colors.bg, borderBottom: isOpen ? `1px solid ${colors.border}` : 'none' }
  });

  const titleWrap = el('div', { className: 'head-title' });
  const dot = el('span', { className: 'head-dot', style: { background: colors.dot }});
  titleWrap.appendChild(dot);
  titleWrap.appendChild(document.createTextNode(head));

  const meta    = el('div', { className: 'head-meta' });
  const countBadge = el('span', { className: 'head-count' }, `${doneCount}/${tapes.length}`);
  const chevron = el('span', { className: `head-chevron${isOpen ? ' open' : ''}` }, '⌄');
  meta.appendChild(countBadge);
  meta.appendChild(chevron);

  header.appendChild(titleWrap);
  header.appendChild(meta);

  const body = el('div', { className: 'head-body', style: { display: isOpen ? 'block' : 'none', paddingTop: '12px' }});

  // Group tapes by Sub-Head
  const subHeads = {};
  tapes.forEach(tape => {
    const sh = tape['Sub-Head'] || 'General';
    if (!subHeads[sh]) subHeads[sh] = [];
    subHeads[sh].push(tape);
  });

  // Sort sub-heads by first tape number
  Object.entries(subHeads)
    .sort(([,a],[,b]) => Number(a[0].TapeNo) - Number(b[0].TapeNo))
    .forEach(([sh, shTapes]) => {
      body.appendChild(buildSubheadBlock(sh, shTapes, allTapes));
    });

  header.addEventListener('click', () => {
    openHeads[key] = !openHeads[key];
    body.style.display = openHeads[key] ? 'block' : 'none';
    header.style.borderBottom = openHeads[key] ? `1px solid ${colors.border}` : 'none';
    chevron.classList.toggle('open', !!openHeads[key]);
  });

  block.appendChild(header);
  block.appendChild(body);
  return block;
}

// ─── Main dashboard render ────────────────────────────────────────────────────

function renderDashboard() {
  const purchasedIds  = studentData?.courses || [];
  const allTapes      = contentRows;
  const doneTapes     = allTapes.filter(t => checkedTapes[tapeKey(t)]).length;

  const page = el('div', { className: 'page fade-up' });

  // ── User header bar ──
  const userHeader = el('div', { className: 'user-header' });
  const userInfo   = el('div', { className: 'user-info' });
  userInfo.innerHTML = `
    <div class="user-avatar">😊</div>
    <div>
      <div class="user-name">${currentUser.name}</div>
      <div class="user-email">${currentUser.email}</div>
    </div>
  `;
  const actions = el('div', { className: 'user-actions' });
  purchasedIds.forEach(id => {
    actions.appendChild(el('span', { className: 'course-badge' }, `${id.toUpperCase()} ✓`));
  });
  const signOutBtn = el('button', { className: 'btn-ghost', onClick: handleSignOut }, 'Sign out');
  actions.appendChild(signOutBtn);
  userHeader.appendChild(userInfo);
  userHeader.appendChild(actions);
  page.appendChild(userHeader);

  // ── Expiry banner ──
  if (studentData?.expireDate) {
    const days   = getDaysUntilExpiry(studentData.expireDate);
    if (days !== null && days <= 30) {
      const danger  = days <= 7;
      const banner  = el('div', { className: `expiry-warning${danger ? ' expiry-danger' : ''}` });
      banner.innerHTML = `<span style="font-size:18px">${danger ? '🚨' : '⚠️'}</span>
        <span>${danger
          ? `Access expires in ${days} day${days !== 1 ? 's' : ''}! Please renew soon.`
          : `Access expires on ${studentData.expireDate} (${days} days remaining).`
        }</span>`;
      page.appendChild(banner);
    }
  }

  // ── Section heading ──
  const pillWrap = el('div', {});
  pillWrap.appendChild(el('span', { className: 'section-pill' }, 'My Courses'));
  const h1 = el('h1', { className: 'section-title' }, 'Your Learning Content');
  if (studentData?.expireDate) {
    const expLine = el('p', { style: { color:'#888', fontSize:'14px', marginTop:'4px', marginBottom:'20px' }});
    expLine.innerHTML = `Access expires: <strong style="color:#c44f9a">${studentData.expireDate}</strong>`;
    pillWrap.appendChild(h1);
    pillWrap.appendChild(expLine);
  } else {
    pillWrap.appendChild(h1);
  }
  page.appendChild(pillWrap);

  // ── Progress bar ──
  page.appendChild(buildProgressBar(doneTapes, allTapes.length));

  // ── Content accordion ──
  if (allTapes.length === 0) {
    const empty = el('div', { className: 'empty-state' });
    empty.innerHTML = `<div class="icon">📂</div><p>Content will appear here once uploaded. Check back soon!</p>`;
    page.appendChild(empty);
  } else {
    // Group by Head, preserve order by first TapeNo
    const heads = {};
    allTapes.forEach(tape => {
      const h = tape.Head || 'General';
      if (!heads[h]) heads[h] = [];
      heads[h].push(tape);
    });

    Object.entries(heads)
      .sort(([,a],[,b]) => Number(a[0].TapeNo) - Number(b[0].TapeNo))
      .forEach(([head, tapes]) => {
        page.appendChild(buildHeadBlock(head, tapes, allTapes));
      });
  }

  // ── Locked / upsell cards ──
  const lockedCourses = ALL_COURSES.filter(c => !purchasedIds.includes(c.id));
  if (lockedCourses.length > 0) {
    const divider = el('div', { style: { margin:'40px 0 20px' }});
    divider.appendChild(el('h2', { className: 'locked-section-title' }, '🔒 Other Courses'));
    divider.appendChild(el('p', { className: 'locked-section-sub' }, 'Unlock more content to accelerate your learning'));
    page.appendChild(divider);

    const grid = el('div', { className: 'locked-grid' });
    lockedCourses.forEach(course => {
      const card = el('div', { className: 'locked-card' });
      const bar  = el('div', { className: 'locked-card-bar', style: { background: course.grad }});
      const body = el('div', { className: 'locked-card-body' });
      body.innerHTML = `
        <div class="locked-icon-lock">🔒</div>
        <div class="locked-badge-icon">${course.badge}</div>
        <div class="locked-card-title">${course.title}</div>
        <p class="locked-card-desc">${course.desc}</p>
        <span class="locked-tapes-badge" style="background:${course.grad}">${course.tapes}</span>
      `;
      const buyBtn = el('button', {
        className: 'btn-purchase',
        onClick: () => { window.location.href = '/#contact'; }
      }, '🛒 Purchase to Unlock');
      body.appendChild(buyBtn);
      card.appendChild(bar);
      card.appendChild(body);
      grid.appendChild(card);
    });
    page.appendChild(grid);
  }

  showScreen(page);
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

function handleLogin() {
  if (!window.netlifyIdentity) return;
  window.netlifyIdentity.open('login');
}

function handleSignOut() {
  if (window.netlifyIdentity) window.netlifyIdentity.logout();
  currentUser  = null;
  studentData  = null;
  contentRows  = [];
  renderLoginScreen();
}

// ─── Screen builders ──────────────────────────────────────────────────────────

function renderLoginScreen() {
  const wrap = el('div', { className: 'login-screen' });
  const box  = el('div', { className: 'login-box fade-up' });
  box.innerHTML = `
    <div class="login-icon floating">🎓</div>
    <span class="section-pill">My Course</span>
    <h1>My Learning Space</h1>
    <p>Sign in to access your enrolled courses<br>and continue learning right away.</p>
  `;
  const loginBtn = el('button', { className: 'btn-primary', onClick: handleLogin }, '🔐 Sign In / Sign Up');
  const hint     = el('p', { className: 'login-hint' });
  hint.innerHTML = `Haven't purchased yet? <a href="/#courses">Browse courses →</a>`;
  box.appendChild(loginBtn);
  box.appendChild(hint);
  wrap.appendChild(box);
  showScreen(wrap);
}

function renderLoadingScreen() {
  const wrap = el('div', { className: 'loader-wrap' });
  wrap.innerHTML = `<div class="loader"></div><p style="color:#888;font-size:15px">Loading your courses...</p>`;
  showScreen(wrap);
}

function renderErrorScreen(msg) {
  const wrap = el('div', { className: 'error-screen fade-up' });
  wrap.innerHTML = `
    <div style="font-size:56px">📭</div>
    <h2>No Courses Found</h2>
    <p>${msg}</p>
    <div class="error-actions">
      <a href="/#contact" class="btn-primary" style="max-width:200px;text-decoration:none;display:inline-block;text-align:center;padding:12px 28px">✉️ Contact P' J'Ae</a>
      <button class="btn-ghost" id="signout-err-btn">← Sign Out</button>
    </div>
  `;
  showScreen(wrap);
  document.getElementById('signout-err-btn')?.addEventListener('click', handleSignOut);
}

// ─── Main load flow ───────────────────────────────────────────────────────────

async function loadUserData(email) {
  renderLoadingScreen();
  try {
    const student = await fetchStudentData(email);
    if (!student) {
      renderErrorScreen("No course found for this account. Please contact P' J'Ae to enroll.");
      return;
    }

    const courses = student.Courses
      ? student.Courses.split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
      : [];

    studentData = {
      email:      student.Email,
      courses,
      expireDate: student.ExpireDate || null,
    };

    if (courses.length > 0) {
      contentRows = await fetchContent(courses);
      // Sort by TapeNo numerically
      contentRows.sort((a, b) => Number(a.TapeNo) - Number(b.TapeNo));
    }

    loadProgress();

    // Auto-open first head
    if (contentRows.length > 0) {
      const firstHead = contentRows[0].Head || 'General';
      openHeads[`head_${firstHead}`] = true;
    }

    renderDashboard();

  } catch (err) {
    console.error(err);
    renderErrorScreen('Failed to load course data. Please try again later.');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (!window.netlifyIdentity) {
    renderErrorScreen('Authentication service not available. Please refresh the page.');
    return;
  }

  window.netlifyIdentity.on('init', (user) => {
    if (user) {
      currentUser = {
        email: user.email,
        name:  user.user_metadata?.full_name || user.email,
      };
      loadUserData(currentUser.email);
    } else {
      renderLoginScreen();
    }
  });

  window.netlifyIdentity.on('login', (user) => {
    currentUser = {
      email: user.email,
      name:  user.user_metadata?.full_name || user.email,
    };
    window.netlifyIdentity.close();
    loadUserData(currentUser.email);
  });

  window.netlifyIdentity.on('logout', () => {
    currentUser = null;
    studentData = null;
    contentRows = [];
    renderLoginScreen();
  });

  window.netlifyIdentity.init();
});
