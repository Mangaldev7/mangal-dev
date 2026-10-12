'use strict';
/* ===== Editable defaults. Everything here can also be changed in the browser via Edit > Edit site settings. ===== */
const DEFAULTS = {
  name: '[YOUR NAME]',
  title: '[YOUR PROFESSIONAL TITLE]',
  roles: '[Role one], [Role two], [An interest]',
  intro: '[YOUR SHORT INTRODUCTION]',
  about: '[Write your biography here.]',
  location: '[Your location]',
  email: '',
  phone: '',
  footer: '[YOUR NAME]',
  social: { // single place for social links
    instagram: 'https://www.instagram.com/',  // [YOUR INSTAGRAM URL]
    facebook: 'https://www.facebook.com/',    // [YOUR FACEBOOK URL]
    tiktok: 'https://www.tiktok.com/'         // [YOUR TIKTOK URL]
  }
};
const ICONS = {
  instagram: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6"/></svg>',
  facebook: '<svg viewBox="0 0 24 24"><path d="M14 8.5V7c0-.8.4-1.2 1.3-1.2H17V3h-2.4C12 3 10.5 4.5 10.5 7v1.5H8V11.5h2.5V21h3.5v-9.5h2.6l.4-3z"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M15 3v11.2a4.2 4.2 0 1 1-4.2-4.2M15 3c.3 2.6 1.9 4.4 4.7 4.7"/></svg>'
};
const TYPES = {
  cert: { one: 'certificate', many: 'certificates', fields: ['Issuing organization', 'Issue date'], fileReq: true },
  project: { one: 'project', many: 'projects', fields: ['Tools and technologies', 'Completion date'], fileReq: false }
};
const MAX_MB = 10, OK_FILES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

const $ = (s, e = document) => e.querySelector(s), $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';

/* ===== IndexedDB: 'kv' (settings, photo, CV) and 'items' (certificates, projects incl. file Blobs) ===== */
const dbp = new Promise((res, rej) => {
  const q = indexedDB.open('portfolio-db', 1);
  q.onupgradeneeded = () => { q.result.createObjectStore('kv'); q.result.createObjectStore('items', { keyPath: 'id' }); };
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
});
const tx = async (store, mode, fn) => {
  const d = await dbp;
  return new Promise((res, rej) => { const t = d.transaction(store, mode), r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
};
const kvGet = k => tx('kv', 'readonly', s => s.get(k)), kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
const allItems = () => tx('items', 'readonly', s => s.getAll()), putItem = i => tx('items', 'readwrite', s => s.put(i)), delItem = id => tx('items', 'readwrite', s => s.delete(id));

let S = structuredClone(DEFAULTS), items = [], urls = [], visible = [], curId = null, blobUrls = {};

/* ===== Theme ===== */
const setTheme = t => { document.documentElement.dataset.theme = t; localStorage.setItem('theme', t); };
setTheme(localStorage.getItem('theme') || 'dark');
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ===== Apply settings to the page ===== */
let roleTimer;
function applySettings() {
  $$('[data-s]').forEach(el => { const v = S[el.dataset.s]; el.textContent = v || (el.dataset.s === 'phone' ? '' : DEFAULTS[el.dataset.s]); });
  $$('dt').forEach(dt => { if (dt.textContent === 'Phone') { dt.hidden = dt.nextElementSibling.hidden = !S.phone; } });
  document.title = `${S.name} | Portfolio`;
  $$('[data-socials]').forEach(box => {
    box.innerHTML = Object.entries(S.social).filter(([, u]) => u).map(([k, u]) =>
      `<a href="${esc(safeUrl(u) || '#')}" target="_blank" rel="noopener noreferrer" aria-label="${k}">${ICONS[k] || esc(k)}</a>`).join('');
  });
  typewriter(S.roles.split(',').map(s => s.trim()).filter(Boolean));
}
function typewriter(words) {
  clearTimeout(roleTimer);
  const el = $('#typed'); if (!words.length) { el.textContent = ''; return; }
  if (reduced) { el.textContent = words[0]; return; }
  let w = 0, c = 0, del = false;
  (function tick() {
    const word = words[w % words.length];
    el.textContent = word.slice(0, c);
    if (!del && c === word.length) { del = true; return roleTimer = setTimeout(tick, 1400); }
    if (del && c === 0) { del = false; w++; }
    c += del ? -1 : 1;
    roleTimer = setTimeout(tick, del ? 35 : 80);
  })();
}

/* ===== Collections (certificates, projects) ===== */
function buildToolbar(type) {
  const root = $(`.coll[data-type=${type}]`), t = TYPES[type];
  root.innerHTML = `
    <div class="toolbar rv">
      <input class="q" type="search" placeholder="Search ${t.many} by title" aria-label="Search ${t.many}">
      <select class="cat" aria-label="Category"></select><select class="yr" aria-label="Year"></select>
      <select class="sort" aria-label="Sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="title">Title</option></select>
      <button class="btn primary edit-only" data-add>Add ${t.one}</button>
    </div><div class="grid"></div>`;
  $$('input,select', root).forEach(e => e.oninput = () => render(type));
  $('[data-add]', root).onclick = () => openForm(type);
}
function render(type) {
  const root = $(`.coll[data-type=${type}]`), t = TYPES[type];
  const all = items.filter(i => i.type === type);
  const fill = (sel, label, vals) => { const cur = sel.value; sel.innerHTML = `<option value="">${label}</option>` + vals.map(v => `<option>${esc(v)}</option>`).join(''); sel.value = vals.includes(cur) ? cur : ''; };
  fill($('.cat', root), 'All categories', [...new Set(all.map(i => i.category).filter(Boolean))].sort());
  fill($('.yr', root), 'All years', [...new Set(all.map(i => (i.date || '').slice(0, 4)).filter(Boolean))].sort().reverse());
  const q = $('.q', root).value.trim().toLowerCase(), cat = $('.cat', root).value, yr = $('.yr', root).value, so = $('.sort', root).value;
  const list = all.filter(i => (!q || i.title.toLowerCase().includes(q)) && (!cat || i.category === cat) && (!yr || (i.date || '').startsWith(yr)))
    .sort((a, b) => so === 'title' ? a.title.localeCompare(b.title) : so === 'old' ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || ''));
  const grid = $('.grid', root);
  grid.innerHTML = list.length ? list.map((i, n) => {
    const img = i.file && i.file.type.startsWith('image/') ? `<img loading="lazy" alt="${esc(i.title)}" src="${urlFor(i)}">` : i.file ? 'PDF' : esc(i.title[0] || '?').toUpperCase();
    return `<article class="card glass rv" style="--d:${Math.min(n, 8) * .06}s" tabindex="0" role="button" data-id="${i.id}"><div class="thumb">${img}</div><div class="cb">${i.category ? `<span class="tag">${esc(i.category)}</span>` : ''}<h3>${esc(i.title)}</h3><p>${esc([i.org, i.date].filter(Boolean).join(', '))}</p></div></article>`;
  }).join('') : `<div class="empty"><b>No ${t.many} ${all.length ? 'match your filters' : 'yet'}</b>${all.length ? 'Try a different search or filter.' : 'Turn on Edit in the menu bar, then choose Add ' + t.one + '.'}</div>`;
  $$('.card', grid).forEach(c => { c.onclick = () => openDetail(c.dataset.id, list.map(x => x.id)); c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } }; reveal.observe(c); });
  $$('[data-count]').forEach(el => el.dataset.target = items.filter(i => i.type === el.dataset.count).length);
  countUp();
}
const urlFor = i => blobUrls[i.id + i.file.size] ||= (urls.push(blobUrls[i.id + i.file.size] = URL.createObjectURL(i.file)), blobUrls[i.id + i.file.size]);

function openDetail(id, ids) {
  if (ids) visible = ids; curId = id;
  const i = items.find(x => x.id === id), d = $('#detail'), u = i.file ? urlFor(i) : '', isImg = i.file && i.file.type.startsWith('image/');
  const prev = i.file ? (isImg ? `<img alt="${esc(i.title)}" src="${u}">` : `<iframe title="${esc(i.title)}" src="${u}"></iframe>`) : `<div class="thumb" style="width:100%;height:100%;min-height:240px">${esc(i.title[0] || '?')}</div>`;
  const labels = TYPES[i.type].fields, link = safeUrl(i.url);
  d.innerHTML = `<button class="icon-btn close" aria-label="Close" onclick="this.closest('dialog').close()">✕</button>
    <div class="dwrap"><div class="dprev">${prev}</div><div class="dinfo">
    ${i.category ? `<span class="tag">${esc(i.category)}</span>` : ''}<h3>${esc(i.title)}</h3>
    ${i.org ? `<p><small>${labels[0]}</small><br>${esc(i.org)}</p>` : ''}${i.date ? `<p><small>${labels[1]}</small><br>${esc(i.date)}</p>` : ''}
    ${i.cred ? `<p><small>Credential ID</small><br>${esc(i.cred)}</p>` : ''}<p style="white-space:pre-line">${esc(i.desc)}</p>
    <div class="btns">${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${i.type === 'cert' ? 'Verify' : 'Open link'}</a>` : ''}
    ${i.file ? `<a class="btn primary" href="${u}" download="${esc(i.fileName || i.title)}">Download</a>` : ''}
    <button class="btn edit-only" id="dEdit">Edit</button><button class="btn danger edit-only" id="dDel">Delete</button></div>
    ${visible.length > 1 ? '<small>Use the left and right arrow keys to browse.</small>' : ''}</div></div>`;
  $('#dEdit', d).onclick = () => { d.close(); openForm(i.type, i); };
  $('#dDel', d).onclick = async () => { if (confirm(`Delete "${i.title}"? This cannot be undone.`)) { await delItem(i.id); items = items.filter(x => x.id !== i.id); d.close(); renderAll(); } };
  if (!d.open) d.showModal();
}
$('#detail').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || visible.length < 2) return;
  const n = (visible.indexOf(curId) + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length; openDetail(visible[n]);
});
let tx0 = 0; // touch swipe
$('#detail').addEventListener('touchstart', e => tx0 = e.touches[0].clientX, { passive: true });
$('#detail').addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - tx0; if (Math.abs(dx) > 70 && visible.length > 1) { const n = (visible.indexOf(curId) + (dx < 0 ? 1 : -1) + visible.length) % visible.length; openDetail(visible[n]); } });
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

function openForm(type, item) {
  const t = TYPES[type], f = $('#itemForm'), v = item || {};
  f.innerHTML = `<h3>${item ? 'Edit' : 'Add'} ${t.one}</h3>
    <label>Title<input name="title" required value="${esc(v.title)}"></label>
    <div class="row"><label>${t.fields[0]}<input name="org" value="${esc(v.org)}"></label><label>${t.fields[1]}<input name="date" type="date" value="${esc(v.date)}"></label></div>
    <div class="row"><label>Category<input name="category" value="${esc(v.category)}"></label><label>${type === 'cert' ? 'Credential ID (optional)' : 'Live demo or source link (optional)'}<input name="${type === 'cert' ? 'cred' : 'url'}" value="${esc(type === 'cert' ? v.cred : v.url)}"></label></div>
    ${type === 'cert' ? `<label>Verification URL (optional)<input name="url" type="url" value="${esc(v.url)}"></label>` : ''}
    <label>Description<textarea name="desc" rows="4">${esc(v.desc)}</textarea></label>
    <label>${type === 'cert' ? 'Image or PDF' : 'Thumbnail image or report PDF (optional)'}${item && v.file ? ` (current: ${esc(v.fileName)})` : ''}<input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"></label>
    <p id="ferr" class="err" role="alert"></p>
    <div class="btns"><button class="btn primary" type="submit">Save ${t.one}</button><button class="btn" type="button" onclick="this.closest('dialog').close()">Cancel</button></div>`;
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f), err = m => $('#ferr').textContent = m, file = fd.get('file');
    if (!fd.get('title').trim()) return err('Enter a title.');
    if (file && file.size) {
      if (!OK_FILES.includes(file.type)) return err('Use a PNG, JPG, WebP, GIF or PDF file.');
      if (file.size > MAX_MB * 1048576) return err(`Choose a file under ${MAX_MB} MB.`);
    } else if (t.fileReq && !v.file) return err('Choose an image or PDF of the certificate.');
    const rec = { id: v.id || crypto.randomUUID(), type, file: v.file, fileName: v.fileName, added: v.added || Date.now() };
    for (const k of ['title', 'org', 'date', 'category', 'desc', 'cred', 'url']) rec[k] = (fd.get(k) ?? v[k] ?? '').toString().trim();
    if (file && file.size) { rec.file = file; rec.fileName = file.name; }
    try { await putItem(rec); } catch { return err('The browser could not save this file. Free up storage and try again.'); }
    items = [...items.filter(x => x.id !== rec.id), rec]; $('#formDlg').close(); renderAll();
  };
  $('#formDlg').showModal();
}
const renderAll = () => Object.keys(TYPES).forEach(render);

/* ===== Site settings, profile photo and CV ===== */
$('#openSettings').onclick = () => {
  const f = $('#setForm'), inp = (n, l, v, tp = 'text') => `<label>${l}<input name="${n}" type="${tp}" value="${esc(v)}"></label>`;
  f.innerHTML = `<h3>Site settings</h3><small>Saved in this browser only. Other visitors will not see these changes until you publish your edited files.</small>
    ${inp('name', 'Full name', S.name)}${inp('title', 'Professional title', S.title)}${inp('roles', 'Typewriter roles (comma separated)', S.roles)}
    <label>Short introduction<textarea name="intro" rows="2">${esc(S.intro)}</textarea></label><label>Biography<textarea name="about" rows="5">${esc(S.about)}</textarea></label>
    <div class="row">${inp('location', 'Location', S.location)}${inp('email', 'Email', S.email, 'email')}</div>${inp('phone', 'Phone (optional)', S.phone)}
    ${Object.keys(S.social).map(k => inp('s_' + k, k[0].toUpperCase() + k.slice(1) + ' URL', S.social[k], 'url')).join('')}
    ${inp('footer', 'Footer "Designed by" name', S.footer)}
    <label>Profile photo<input type="file" name="photo" accept="image/png,image/jpeg,image/webp"></label><p id="serr" class="err" role="alert"></p>
    <div class="btns"><button class="btn primary" type="submit">Save settings</button><button class="btn" type="button" id="resetBtn">Reset text to defaults</button><button class="btn" type="button" onclick="this.closest('dialog').close()">Cancel</button></div>`;
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f);
    for (const k of ['name', 'title', 'roles', 'intro', 'about', 'location', 'email', 'phone', 'footer']) S[k] = fd.get(k).trim();
    for (const k of Object.keys(S.social)) { const u = fd.get('s_' + k).trim(); if (u && !safeUrl(u)) return $('#serr').textContent = `${k}: the link must start with https://`; S.social[k] = u; }
    const p = fd.get('photo');
    if (p && p.size) { if (!p.type.startsWith('image/') || p.size > MAX_MB * 1048576) return $('#serr').textContent = 'Choose an image under 10 MB.'; await kvSet('photo', p); showPhoto(p); }
    await kvSet('settings', S); applySettings(); $('#settingsDlg').close();
  };
  $('#resetBtn', f).onclick = async () => { if (confirm('Reset all text and links to the defaults?')) { S = structuredClone(DEFAULTS); await kvSet('settings', S); applySettings(); $('#settingsDlg').close(); } };
  $('#settingsDlg').showModal();
};
let photoUrl; const showPhoto = b => { if (photoUrl) URL.revokeObjectURL(photoUrl); $('#photo').src = photoUrl = URL.createObjectURL(b); };
let cvUrl;
function showCv(cv) {
  const info = $('#cvInfo'), dl = $('#cvDl'), pv = $('#cvPrev'), hero = $('#cvHero');
  if (cvUrl) URL.revokeObjectURL(cvUrl);
  if (!cv) { info.innerHTML = '<div class="empty" style="border:0;padding:1rem 0;text-align:left"><b>No CV uploaded yet</b>Turn on Edit and upload a PDF.</div>'; dl.hidden = pv.hidden = true; hero.href = '#cv'; hero.removeAttribute('download'); return; }
  cvUrl = URL.createObjectURL(cv.blob); pv.src = cvUrl; pv.hidden = dl.hidden = false; dl.href = hero.href = cvUrl; dl.download = hero.download = cv.name;
  info.innerHTML = `<p><b>${esc(cv.name)}</b><br><small>Last uploaded ${new Date(cv.date).toLocaleDateString()}</small></p>`;
}
$('#cvFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.type !== 'application/pdf' || f.size > 20 * 1048576) return alert('Choose a PDF under 20 MB.');
  const cv = { blob: f, name: f.name, date: Date.now() }; await kvSet('cv', cv); showCv(cv); e.target.value = '';
};

/* ===== Contact: honest mailto flow ===== */
$('#cform').onsubmit = e => {
  e.preventDefault(); const f = e.target, m = $('#cmsg'), v = n => f[n].value.trim();
  m.className = 'err';
  if (!v('name') || !v('subject') || !v('message')) return m.textContent = 'Fill in your name, subject and message.';
  if (!/^\S+@\S+\.\S+$/.test(v('email'))) return m.textContent = 'Enter a valid email address.';
  if (!S.email) return m.textContent = 'No recipient email is set. Add one under Edit > Edit site settings.';
  location.href = `mailto:${encodeURIComponent(S.email)}?subject=${encodeURIComponent(v('subject'))}&body=${encodeURIComponent(v('message') + '\n\n' + v('name') + ' (' + v('email') + ')')}`;
  m.className = 'ok'; m.textContent = 'Your email app should open. Press send there to deliver the message.';
};

/* ===== Navigation, edit mode, scroll effects ===== */
$('#burger').onclick = () => { const o = $('#menu').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); };
$$('#menu a').forEach(a => a.onclick = () => $('#menu').classList.remove('open'));
$('#editToggle').onclick = e => { const on = document.body.classList.toggle('editing'); e.target.setAttribute('aria-pressed', on); };
const reveal = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } }), { threshold: .12 });
const watch = () => $$('.rv:not(.in)').forEach(el => reveal.observe(el));
const links = $$('#menu a'), secs = links.map(a => $(a.getAttribute('href')));
addEventListener('scroll', () => {
  const h = document.documentElement, y = scrollY;
  $('#progress').style.width = (y / (h.scrollHeight - h.clientHeight) * 100) + '%';
  $('#top').classList.toggle('show', y > 600);
  const cur = secs.findLastIndex(s => s.getBoundingClientRect().top < innerHeight * .4);
  links.forEach((a, i) => a.classList.toggle('on', i === cur));
}, { passive: true });
$('#top').onclick = () => scrollTo({ top: 0 });
function countUp() {
  $$('[data-count]').forEach(el => {
    const t = +el.dataset.target || 0; if (reduced || !t) { el.textContent = t; return; }
    let n = 0; const step = () => { n = Math.min(t, n + Math.max(1, t / 40)); el.textContent = Math.round(n); if (n < t) requestAnimationFrame(step); }; step();
  });
}
/* tilt on cards */
document.addEventListener('pointermove', e => {
  if (reduced || e.pointerType === 'touch') return; const c = e.target.closest?.('.card'); if (!c) return;
  const r = c.getBoundingClientRect(); c.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 10 + 'deg'); c.style.setProperty('--rx', -((e.clientY - r.top) / r.height - .5) * 10 + 'deg');
});
document.addEventListener('pointerout', e => { const c = e.target.closest?.('.card'); if (c) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); } });

/* particle network */
(function particles() {
  if (reduced) return;
  const cv = $('#bg'), cx = cv.getContext('2d'); let w, h, ps = [];
  const size = () => { w = cv.width = innerWidth; h = cv.height = innerHeight; ps = Array.from({ length: Math.min(70, w / 18 | 0) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 })); };
  size(); addEventListener('resize', size);
  (function frame() {
    if (!document.hidden) {
      cx.clearRect(0, 0, w, h); const col = document.documentElement.dataset.theme === 'dark' ? '120,160,255' : '60,80,200';
      ps.forEach((p, i) => {
        p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h; cx.fillStyle = `rgba(${col},.7)`; cx.fillRect(p.x, p.y, 2, 2);
        for (let j = i + 1; j < ps.length; j++) { const d = Math.hypot(p.x - ps[j].x, p.y - ps[j].y); if (d < 120) { cx.strokeStyle = `rgba(${col},${.18 * (1 - d / 120)})`; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(ps[j].x, ps[j].y); cx.stroke(); } }
      });
    }
    requestAnimationFrame(frame);
  })();
})();

/* ===== Boot ===== */
(async function init() {
  Object.keys(TYPES).forEach(buildToolbar);
  try {
    const saved = await kvGet('settings'); if (saved) S = { ...DEFAULTS, ...saved, social: { ...DEFAULTS.social, ...saved.social } };
    const photo = await kvGet('photo'); if (photo) showPhoto(photo);
    showCv(await kvGet('cv')); items = await allItems();
  } catch (e) { console.warn('Local storage unavailable; the site will work but cannot save changes.', e); showCv(null); }
  applySettings(); renderAll(); watch();
  const start = performance.now(), done = () => $('#preloader').classList.add('done');
  setTimeout(done, Math.max(0, 1100 - (performance.now() - start)));
})();
