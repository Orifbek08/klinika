'use strict';

/* ==========================================================
   Apps Script Web app манзили
   ========================================================== */
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyp5VCANPea44ZdRZkLOuSBnoIUqqmIDnwXm1ShoqafILyvslJe8kUl8qwO0aWeTBDlxw/exec';

/* ---------- Ёрдамчилар ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const safe = (st) => ({
  get: k => { try { return st().getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { st().setItem(k, v); } catch (e) {} },
  del: k => { try { st().removeItem(k); } catch (e) {} }
});
const store = safe(() => localStorage);
const sess = safe(() => sessionStorage);

const YOTOQ = 'yotoq';
const YOTOQ_NAME = 'Ётоқхона';
const MUTATING = ['add', 'cancel', 'setField', 'payDebt', 'stayAdmit', 'stayOp'];

/* Маҳаллий база: сайт шу билан ишлайди, сервер билан орқа фонда тенглашади.
   lists — бугунги қабуллар (бўлим бўйича), stays — ҳозир ётганлар,
   done — кетганлар, debts — қарзлар (иккаласи биринчи очилганда юкланади). */
const DB = { date: '', ver: '', lists: {}, stays: [], done: null, debts: null, debtsVer: '' };
const C = {};           // бошқа саналар рўйхати ва ҳисоботлар кеши
let pending = 0;        // жорий сўровлар
let W = 0;              // навбатдаги ёзишлар
let Q = Promise.resolve();
let started = false, wantSync = false, tmpN = 0;
const S = { pin: null, token: null, user: null, cfg: null, dept: null, list: [], listDept: null,
  paidTouched: false, stayMode: 'active', stays: [], stayId: null, stayObj: null, view: 'qabul', report: null };

const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoDate(new Date());
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const showDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).split('-').reverse().join('.') : (s || '');
const money = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
const num = v => Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = a => Array.from(new Set(a));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const daysBetween = (a, b) => {
  const pa = String(a || '').split('-').map(Number), pb = String(b || '').split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || !pa[0] || !pb[0]) return 1;
  return Math.max(1, Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000));
};

function apiUrl() { return DEFAULT_API_URL || store.get('apiUrl') || ''; }

/* ---------- Сервер билан алоқа ---------- */
async function callOnce(url, body) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 40000);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, signal: ctl.signal });
  } catch (e) {
    const err = new Error(e && e.name === 'AbortError' ? 'Сервер 40 сониядан бери жавоб бермаяпти' : 'Интернет ёки сервер билан алоқа йўқ');
    err.retry = true; throw err;
  } finally { clearTimeout(tm); }
  const raw = await res.text();
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    // Google хато саҳифасини қайтарди — ундаги матнни кўрсатамиз
    const el = document.createElement('div');
    el.innerHTML = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const err = new Error('Apps Script хатоси: ' + (txt || 'бўш жавоб (HTTP ' + res.status + ')')); err.retry = true; throw err;
  }
  if (!j.ok) { const err = new Error(j.error || 'Хатолик'); err.auth = !!j.auth; throw err; }
  return j;
}

async function api(action, payload) {
  const url = apiUrl();
  if (!url) throw new Error('API манзили киритилмаган');
  const req = Object.assign({ action: action }, S.token ? { t: S.token } : { pin: S.pin }, payload || {});
  // rid — қайта уринишда сервер иккинчи марта ёзмаслиги учун
  if (MUTATING.indexOf(action) >= 0) req.rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const body = JSON.stringify(req);
  pending++;
  document.body.classList.add('syncing');
  try {
    // Жавоб келмаса 3 мартагача уринади; rid бир хил — сервер иккинчи марта ёзмайди
    const waits = [1000, 3000];
    for (let i = 0; ; i++) {
      try { return await callOnce(url, body); }
      catch (e) {
        if (!e.retry || i >= waits.length) { e.lost = !!e.retry; throw e; }
        await sleep(waits[i]);
      }
    }
  } finally {
    pending--;
    if (pending <= 0) { pending = 0; document.body.classList.remove('syncing'); }
  }
}

// Ёзишлар навбат билан, бирма-бир юборилади.
function write(action, payload) {
  W++;
  const run = async () => {
    const sent = DB.ver;
    const j = await api(action, Object.assign({ ver: sent }, payload));
    // Сервер «орада бошқа ҳеч ким ёзмаган» деса — янги версияни оламиз, тўлиқ янгилаш керак бўлмайди
    if (j && j.fresh && j.ver && DB.ver === sent) { DB.ver = j.ver; persist(); }
    return j;
  };
  const p = Q.then(run, run);
  Q = p.catch(() => {});
  const fin = () => { W--; if (!W && wantSync) { wantSync = false; sync(true); } };
  p.then(fin, fin);
  return p;
}

// Ёзиш сўровига жавоб келмади, лекин сервер ёзиб улгурган бўлиши мумкин.
// Сервердан янги ҳолатни олиб, ёзув борлигини текширамиз — такрор киритилмасин.
async function recover(find) {
  try {
    const j = await api('sync', {});
    applySync(j);
    refreshView();
    return find() || null;
  } catch (e) { return null; }
}

function persist() {
  store.set('db', JSON.stringify({ date: DB.date, ver: DB.ver, lists: DB.lists, stays: DB.stays, debts: DB.debts, debtsVer: DB.debtsVer || '' }));
}

function dropReports() { if (S.view === 'hisobot') repLabel(); }

function applySync(d) {
  if (!d || d.same) return false;
  DB.date = d.date; DB.ver = d.ver;
  DB.lists = d.lists || {};
  DB.stays = d.stays || [];
  persist();
  return true;
}

// Сервердан янги ҳолатни олади (ўзгариш бўлмаса — жуда енгил жавоб).
async function sync(force) {
  if (!S.token) return;
  if (W) { if (force) wantSync = true; return; }
  try {
    const j = await api('sync', force ? {} : { ver: DB.ver, date: DB.date });
    if (W) { wantSync = true; return; }   // шу орада ёзиш бошланди — кейин қайта оламиз
    const before = S.stayObj ? JSON.stringify(S.stayObj) : '';
    const wasActive = !!S.stayId && DB.stays.some(x => x['ID'] === S.stayId);
    if (!applySync(j)) return;
    dropReports();
    refreshView();
    if (S.stayId) {
      const s = findStay(S.stayId);
      if (s) { if (JSON.stringify(s) !== before) { S.stayObj = s; refreshStay(); } }
      else if (wasActive) closeSheet();   // бошқа компьютерда чиқарилган ёки бекор қилинган
    }
  } catch (e) {
    if (e.auth) return relogin(e.message);
    if (force) toast(e.message, true);
  }
}

// Рухсатнома бекор бўлган (PIN ўзгарган ёки муддати тугаган) — кириш ойнасига қайтамиз
function relogin(msg) {
  store.del('auth'); S.token = null;
  showLogin(msg || '');
  $('#pin').value = ''; $('#pin').focus();
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, bad ? 6000 : 3000);
}

function busy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Кутинг…'; }
  else if (btn.dataset.t) btn.textContent = btn.dataset.t;
}

const deptBy = key => S.cfg.depts.find(d => d.key === key);
const segHtml = (vals, sel) => vals.map((v, i) =>
  `<button type="button" data-v="${esc(v)}" class="${(sel ? v === sel : i === 0) ? 'on' : ''}">${esc(v)}</button>`).join('');
const segVal = el => { const b = el && el.querySelector('.on'); return b ? b.dataset.v : ''; };
const stat = (k, v, cls, sub) => `<div class="stat ${cls || ''}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;
const empty = (msg, cols) => `<tr><td class="empty"${cols ? ` colspan="${cols}"` : ''}>${esc(msg)}</td></tr>`;

/* Умумий: сегмент тугмалар ва пул майдонлари */
document.addEventListener('click', e => {
  const b = e.target.closest('.seg button');
  if (!b) return;
  $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
  b.parentElement.dispatchEvent(new CustomEvent('seg', { detail: b.dataset.v, bubbles: true }));
});
document.addEventListener('input', e => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('money')) return;
  const end = t.selectionStart === t.value.length;
  t.value = t.value.replace(/[^\d]/g, '') ? money(num(t.value)) : '';
  if (end) { try { t.setSelectionRange(t.value.length, t.value.length); } catch (x) {} }
});

/* ---------- Модал ойна ---------- */
function openSheet(html, cls) {
  const sh = $('#sheet');
  sh.className = 'sheet ' + (cls || '');
  sh.innerHTML = html;
  $('#overlay').classList.remove('hidden');
  document.body.classList.add('locked');
}
function closeSheet() {
  $('#overlay').classList.add('hidden');
  $('#sheet').innerHTML = '';
  document.body.classList.remove('locked');
  S.stayId = null;
  S.stayObj = null;
}
$('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#overlay').classList.contains('hidden')) closeSheet(); });

/* ---------- Кириш ---------- */
function initLogin() {
  if (!apiUrl()) $('#urlBox').classList.remove('hidden');
  if (DEFAULT_API_URL) $('#changeUrl').classList.add('hidden');
  $('#changeUrl').onclick = e => {
    e.preventDefault();
    $('#urlBox').classList.toggle('hidden');
    $('#apiUrl').value = store.get('apiUrl') || '';
  };
  $('#loginBtn').onclick = doLogin;
  $('#pin').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Олдин кирилган бўлса — PIN сўралмайди: сақланган маълумот билан дарҳол очилади,
  // сервердан орқа фонда янгиланади.
  let a = null, db = null;
  try { a = JSON.parse(store.get('auth') || 'null'); db = JSON.parse(store.get('db') || 'null'); } catch (e) {}
  if (a && a.token && a.exp > Date.now() + 60000 && a.user && a.cfg && apiUrl()) {
    S.token = a.token; S.user = a.user; S.cfg = a.cfg;
    if (db && db.date === today()) { Object.assign(DB, db); if (!Array.isArray(DB.debts)) { DB.debts = null; DB.debtsVer = ''; } }
    if (enter()) { login(true, true); return; }
  }
  S.token = null;
  warmUp();
  $('#pin').focus();
  $('#pin').addEventListener('input', warmUp);
}

/* Google скрипти биринчи мурожаатда 2–4 сония «уйғонади». PIN терилаётганда
   олдиндан уйғотиб қўямиз — кириш тезроқ бўлади. */
let warmAt = 0;
function warmUp() {
  if (!apiUrl() || Date.now() - warmAt < 4 * 60000) return;
  warmAt = Date.now();
  fetch(apiUrl()).catch(() => {});
}

function doLogin() {
  const u = $('#apiUrl').value.trim();
  if (u) store.set('apiUrl', u);
  S.pin = $('#pin').value.trim();
  S.token = null;
  if (!S.pin) { $('#loginErr').textContent = 'PIN киритинг'; return; }
  login(false);
}

async function login(silent, background) {
  const b = $('#loginBtn');
  if (!background) busy(b, true);
  $('#loginErr').textContent = '';
  try {
    // Битта сўров: фойдаланувчи + созлама + бугунги маълумотлар
    const j = await api('login', { sync: true, ver: DB.ver, date: DB.date });
    if (!j.user || !j.config || !Array.isArray(j.config.depts) || !j.data) {
      throw new Error('Сервер жавоби тўлиқ эмас. Apps Script’га янги Code.gs (v4) қўйилиб, «New version» қилиб deploy қилинганини текширинг.');
    }
    if (!j.token) throw new Error('Сервер рухсатнома бермади. Apps Script’га янги Code.gs (v8) қўйилганини текширинг.');
    S.user = j.user;
    S.cfg = j.config;
    S.token = j.token; S.pin = null;
    store.set('auth', JSON.stringify({ token: j.token, exp: j.exp, user: S.user, cfg: S.cfg }));
    if (S.user.role !== 'админ') store.del('rep');   // ҳисобот фақат админга
    if (!W) applySync(j.data);
    if (background) { applyConfig(); refreshView(); } else enter();
    loadDebts(true);
  } catch (e) {
    if (background) {
      if (e.auth) relogin(e.message); else toast(e.message, true);
      return;
    }
    S.token = null;
    showLogin(silent ? '' : e.message);
  } finally {
    if (!background) busy(b, false);
  }
}

function showLogin(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginErr').textContent = msg || '';
}

// Иловани очади; хато бўлса кириш ойнасига қайтариб, сабабини кўрсатади.
function enter() {
  try {
    applyConfig();
    if (!started) { startApp(); started = true; }
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    refreshView();
    return true;
  } catch (e) {
    console.error(e);
    store.del('auth');
    showLogin('Иловани очишда хато: ' + e.message);
    return false;
  }
}

/* ---------- Илова ---------- */
// Созламага боғлиқ ҳамма нарса (қайта чақирса бўлади)
function applyConfig() {
  $('#brand').textContent = S.cfg.clinic;
  document.title = S.cfg.clinic;
  $('#userName').textContent = S.user.name || '';
  $('#userRole').textContent = S.user.role || '';
  const admin = S.user.role === 'админ';
  $$('.admin-only').forEach(x => x.classList.toggle('hidden', !admin));

  const out = S.cfg.depts.filter(d => d.key !== YOTOQ);
  const active = S.dept ? S.dept.key : '';
  $('#deptGrid').innerHTML = out
    .map(d => `<button type="button" class="dept${d.key === active ? ' active' : ''}" data-key="${d.key}">${esc(d.name)}</button>`).join('') +
    `<button type="button" class="dept alt" data-go="yotoq">${YOTOQ_NAME} →</button>`;

  const cur = $('#lDept').value || store.get('lDept') || '';
  $('#lDept').innerHTML = out.map(d => `<option value="${d.key}">${esc(d.name)}</option>`).join('');
  if (cur && out.some(d => d.key === cur)) $('#lDept').value = cur;
  $('#docList').innerHTML = uniq(S.cfg.doctors.map(d => d.name)).map(n => `<option value="${esc(n)}">`).join('');
  if (!$('#qPay').children.length) $('#qPay').innerHTML = segHtml(S.cfg.payments);
}

// Бир марта: тугмаларни боғлаш
function startApp() {
  $('#deptGrid').addEventListener('click', e => {
    const b = e.target.closest('.dept');
    if (!b) return;
    if (b.dataset.go) showView(b.dataset.go); else openForm(b.dataset.key);
  });
  $('#lDate').value = today();
  $$('.nav').forEach(t => { t.onclick = () => showView(t.dataset.view); });
  $('#logout').onclick = () => { ['auth', 'db', 'rep'].forEach(k => store.del(k)); location.reload(); };

  bindForm();
  bindList();
  bindYotoq();
  bindQarz();
  bindReport();
  setRange('today');
  showView('qabul');

  // Бошқа компьютерда киритилган ёзувлар ҳам кўриниши учун орқа фонда тенглашиб туради
  setInterval(() => { if (!document.hidden) sync(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}

function showView(v) {
  S.view = v;
  $$('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'v-' + v));
  $$('.nav').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  window.scrollTo(0, 0);
  refreshView();
  if (v === 'qarz') loadDebts(DB.debts !== null);
  if (v === 'hisobot') loadReport();
}

// Жорий бўлимни маҳаллий базадан қайта чизади (серверга мурожаатсиз).
function refreshView() {
  if (!started) return;
  setPill('#nYotoq', DB.stays.length);
  if (DB.debts) setPill('#nQarz', DB.debts.length);
  if (S.view === 'royxat') loadList();
  if (S.view === 'yotoq') loadStays();
  if (S.view === 'qarz' && DB.debts) renderDebts();
}

function setPill(sel, n) {
  const el = $(sel);
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

/* ================= ҚАБУЛ ================= */
function svcRow(name, price, custom) {
  const nameHtml = custom
    ? '<input class="s-name" placeholder="Хизмат номи">'
    : `<span class="s-name">${esc(name)}</span>`;
  return `<div class="svc${custom ? ' custom on' : ''}">
    <label class="chk"><input type="checkbox" class="s-on"${custom ? ' checked' : ''}> ${nameHtml}</label>
    <input class="s-qty" type="number" min="1" value="1" title="Сони">
    <input class="s-price money" inputmode="numeric" value="${price ? money(price) : ''}" placeholder="Нарх">
    ${custom ? '<button type="button" class="x" title="Олиб ташлаш">×</button>' : '<span></span>'}
  </div>`;
}


function collectItems() {
  return $$('#svcBox .svc').filter(r => $('.s-on', r).checked).map(r => {
    const n = $('.s-name', r);
    return {
      name: (n.tagName === 'INPUT' ? n.value : n.textContent).trim(),
      qty: Math.max(1, parseInt($('.s-qty', r).value, 10) || 1),
      price: num($('.s-price', r).value)
    };
  });
}


function calcSum() {
  const f = $('#qForm');
  $$('#svcBox .svc').forEach(r => r.classList.toggle('on', $('.s-on', r).checked));
  f.sum.value = money(collectItems().reduce((s, i) => s + i.price * i.qty, 0));
  syncPaid();
}


function syncPaid() {
  const f = $('#qForm');
  const sum = num(f.sum.value);
  if (!S.paidTouched) f.paid.value = money(sum);
  if (num(f.paid.value) > sum) f.paid.value = money(sum);
  const debt = sum - num(f.paid.value);
  const dl = $('#debtLine');
  dl.classList.toggle('hidden', !(debt > 0));
  $('b', dl).textContent = money(debt) + ' сўм';
}


function openForm(key) {
  S.dept = deptBy(key);
  S.paidTouched = false;
  const f = $('#qForm');
  $$('#deptGrid .dept').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  f.reset();
  f.classList.remove('hidden');
  $('#fTitle').textContent = S.dept.name;
  $('#qPay').innerHTML = segHtml(S.cfg.payments);

  const docs = S.cfg.doctors.filter(d => d.dept === S.dept.name);
  f.doctor.innerHTML = '<option value="">—</option>' +
    docs.map(d => `<option value="${esc(d.name)}">${esc(d.name)}${d.share ? ' (' + d.share + '%)' : ''}</option>`).join('');
  if (docs.length === 1) f.doctor.value = docs[0].name;

  $('#extraBox').innerHTML = S.dept.extra.map(x => {
    const type = x.t === 'date' ? 'date' : x.t === 'time' ? 'time' : 'text';
    return `<label class="f">${esc(x.h)}<input data-extra="${esc(x.h)}" type="${type}"></label>`;
  }).join('');
  $$('#extraBox [data-extra]').forEach(inp => {
    if (inp.dataset.extra === 'Келган сана') inp.value = today();
  });

  const svcs = S.cfg.services.filter(s => s.dept === S.dept.name);
  $('#svcBox').innerHTML = svcs.map(s => svcRow(s.name, s.price, false)).join('') ||
    '<p class="muted note">Бу бўлимга хизмат қўшилмаган. «+ Бошқа хизмат»ни босинг ёки Sheets’даги «Хизматлар» варағига қўшинг.</p>';
  if (svcs.length === 1) $('#svcBox .s-on').checked = true;

  fillPatients();
  calcSum();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => f.fio.focus(), 250);
}


// Бугун ёзилган беморлар: исм танланса йил ва телефон ўзи тўлади (бир бемор — бир неча бўлим)
function patientsToday() {
  const m = {};
  Object.keys(DB.lists).forEach(k => (DB.lists[k] || []).forEach(r => {
    const n = String(r['Ф.И.Ш'] || '').trim();
    if (n && r['Ҳолат'] !== 'Бекор' && !m[n.toLowerCase()]) m[n.toLowerCase()] = { fio: n, year: r['Туғилган йил'] || '', phone: r['Телефон'] || '', dept: (deptBy(k) || {}).name || '' };
  }));
  DB.stays.forEach(s => {
    const n = String(s['Ф.И.Ш'] || '').trim();
    if (n && !m[n.toLowerCase()]) m[n.toLowerCase()] = { fio: n, year: s['Туғилган йил'] || '', phone: s['Телефон'] || '', dept: YOTOQ_NAME };
  });
  return m;
}

function fillPatients() {
  const m = patientsToday();
  $('#patList').innerHTML = Object.keys(m).map(k => `<option value="${esc(m[k].fio)}">${esc([m[k].year, m[k].dept].filter(Boolean).join(' · '))}</option>`).join('');
}

function bindForm() {
  const f = $('#qForm');
  const box = $('#svcBox');

  f.fio.addEventListener('change', () => {
    const p = patientsToday()[f.fio.value.trim().toLowerCase()];
    if (!p) return;
    if (!f.year.value) f.year.value = p.year;
    if (!f.phone.value) f.phone.value = p.phone;
  });

  box.addEventListener('input', e => {
    const row = e.target.closest('.svc');
    if (row && e.target.matches('.s-qty, .s-price, .s-name')) $('.s-on', row).checked = true;
    calcSum();
  });
  box.addEventListener('change', calcSum);
  box.addEventListener('click', e => {
    if (e.target.matches('.x')) { e.target.closest('.svc').remove(); calcSum(); }
  });

  $('#addCustom').onclick = () => {
    const p = box.querySelector('p.note');
    if (p) p.remove();
    box.insertAdjacentHTML('beforeend', svcRow('', 0, true));
    $('.svc:last-child .s-name', box).focus();
    calcSum();
  };

  f.sum.addEventListener('input', syncPaid);
  f.paid.addEventListener('input', () => { S.paidTouched = true; syncPaid(); });
  $('#payFull').onclick = () => { S.paidTouched = false; syncPaid(); };
  $('#payNone').onclick = () => { S.paidTouched = true; f.paid.value = '0'; syncPaid(); };

  $('#closeForm').onclick = () => {
    f.classList.add('hidden');
    $$('#deptGrid .dept').forEach(b => b.classList.remove('active'));
  };

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const items = collectItems();
    if (!f.fio.value.trim()) { toast('Ф.И.Ш ни киритинг', true); f.fio.focus(); return; }
    if (!items.length) { toast('Камида битта хизмат танланг', true); return; }
    if (items.some(i => !i.name)) { toast('Хизмат номини ёзинг', true); return; }
    const sum = num(f.sum.value), paid = Math.min(sum, num(f.paid.value));
    if (sum - paid > 0 && !f.phone.value.trim() &&
        !confirm('Қарз қоляпти (' + money(sum - paid) + ' сўм), лекин телефон киритилмаган. Шундай сақлансинми?')) { f.phone.focus(); return; }

    const extra = {};
    $$('#extraBox [data-extra]').forEach(i => { extra[i.dataset.extra] = i.value; });
    const data = {
      fio: f.fio.value.trim(), year: f.year.value.trim(), phone: f.phone.value.trim(),
      doctor: f.doctor.value, referrer: f.referrer.value.trim(),
      payment: segVal($('#qPay')), sum: sum, paid: paid,
      note: f.note.value.trim(), items: items, extra: extra
    };

    const btn = f.querySelector('[type=submit]');
    busy(btn, true);
    try {
      const key = S.dept.key;
      const j = await write('add', { dept: key, data: data });
      const r = j.record;
      toast('Сақланди. Навбат № ' + r['Навбат №']);
      printVisit(r, S.dept.name);
      if (r['Сана'] === DB.date) (DB.lists[key] = DB.lists[key] || []).unshift(r);
      if (r['Қарз'] > 0 && DB.debts) {
        DB.debts.unshift({ dept: key, deptName: S.dept.name, id: r['ID'], row: r._row, no: r['Навбат №'], date: r['Сана'],
          fio: r['Ф.И.Ш'], year: r['Туғилган йил'], phone: r['Телефон'], items: r['Хизматлар'],
          sum: Number(r['Сумма']) || 0, paid: Number(r['Тўланган']) || 0, debt: Number(r['Қарз']) || 0 });
        DB.debtsVer = '';
      }
      persist();
      delete C['list:' + key + ':' + r['Сана']];
      dropReports();
      refreshView();
      openForm(key);
    } catch (err) {
      const key = S.dept.key;
      const known = (DB.lists[key] || []).map(x => x['ID']);
      const r = err.lost ? await recover(() => (DB.lists[key] || []).find(x => known.indexOf(x['ID']) < 0 &&
        String(x['Ф.И.Ш']).trim() === data.fio && Number(x['Сумма']) === data.sum)) : null;
      if (r) {
        toast('Сақланган экан. Навбат № ' + r['Навбат №']);
        r.items = items;
        printVisit(r, S.dept.name);
        DB.debtsVer = ''; openForm(key);
      } else {
        toast(err.lost ? 'Сервердан жавоб келмади. «Рўйхат»ни текширинг: ёзув йўқ бўлса, қайта сақланг.' : err.message, true);
      }
    } finally {
      busy(btn, false);
    }
  });
}


/* ================= РЎЙХАТ ================= */
function bindList() {
  $('#lLoad').onclick = () => { if (($('#lDate').value || today()) === DB.date) sync(true); else loadList(true); };
  $('#lDept').onchange = () => { store.set('lDept', $('#lDept').value); loadList(); };
  $('#lDate').onchange = () => loadList();

  $('#lTable').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const r = S.list.find(x => String(x['ID']) === b.dataset.id);
    if (!r) return;
    const d = S.listDept;

    if (b.dataset.act === 'print') { printVisit(r, d.name); return; }

    if (b.dataset.act === 'cancel') {
      const reason = prompt('Бекор қилиш сабаби (' + r['Ф.И.Ш'] + '):');
      if (reason === null) return;
      // Экранда дарҳол ўзгаради, серверга орқа фонда ёзилади
      r['Ҳолат'] = 'Бекор'; r['Қарз'] = 0;
      if (DB.debts) { DB.debts = DB.debts.filter(x => x.id !== r['ID']); DB.debtsVer = ''; }
      persist(); dropReports(); renderList(d, S.list); refreshView();
      write('cancel', { dept: d.key, id: r['ID'], row: r._row, reason: reason })
        .then(() => toast('Бекор қилинди'), err => { toast('Сақланмади: ' + err.message, true); sync(true); });
    }

    if (b.dataset.act === 'close') {
      const field = b.dataset.field;
      if (!confirm(r['Ф.И.Ш'] + ' — ' + field + ': ' + showDate(today()) + '?')) return;
      r[field] = today();
      persist(); renderList(d, S.list);
      write('setField', { dept: d.key, id: r['ID'], row: r._row, field: field, value: today() })
        .then(() => toast('Сақланди'), err => { toast('Сақланмади: ' + err.message, true); sync(true); });
    }
  });
}

// Бугунги рўйхат маҳаллий базадан дарҳол чиқади; бошқа сана — сервердан (кеш билан).
async function loadList(force) {
  const key = $('#lDept').value;
  if (!key) return;
  const d = deptBy(key);
  const date = $('#lDate').value || today();
  if (date === DB.date) {
    S.list = DB.lists[key] || (DB.lists[key] = []);
    S.listDept = d; S.listKey = '';
    renderList(d, S.list);
    return;
  }
  const ck = 'list:' + key + ':' + date;
  S.listKey = ck;
  if (C[ck]) { S.list = C[ck]; S.listDept = d; renderList(d, C[ck]); if (!force) return; }
  else { $('#lStats').innerHTML = ''; $('#lTable').innerHTML = empty('Юкланмоқда…'); }
  try {
    const j = await api('list', { dept: key, date: date });
    C[ck] = j.rows;
    if (S.listKey !== ck) return;
    S.list = j.rows; S.listDept = d;
    renderList(d, j.rows);
  } catch (e) {
    if (S.listKey !== ck) return;
    if (C[ck]) toast(e.message, true);
    else $('#lTable').innerHTML = `<tr><td class="err">${esc(e.message)}</td></tr>`;
  }
}

const paidOf = r => (r['Тўланган'] === '' || r['Тўланган'] == null) ? Number(r['Сумма']) || 0 : Number(r['Тўланган']) || 0;

function renderList(d, rows) {
  const ok = rows.filter(r => r['Ҳолат'] !== 'Бекор');
  const sum = ok.reduce((s, r) => s + (Number(r['Сумма']) || 0), 0);
  const paid = ok.reduce((s, r) => s + paidOf(r), 0);
  const debt = ok.reduce((s, r) => s + (Number(r['Қарз']) || 0), 0);
  $('#lStats').innerHTML =
    stat('Қабуллар', ok.length, '', d.name) +
    stat('Жами сумма', money(sum)) +
    stat('Тўланган', money(paid), 'good') +
    stat('Қарз', money(debt), debt > 0 ? 'warn' : '') +
    (rows.length - ok.length ? stat('Бекор қилинган', rows.length - ok.length) : '');

  if (!rows.length) { $('#lTable').innerHTML = empty('Бу кунда ёзувлар йўқ'); return; }

  const closeField = d.key === 'oper' ? 'Чиққан сана' : null;
  const ex = d.extra.map(x => x.h);

  const head = `<tr><th>№</th><th>Вақт</th><th>Ф.И.Ш</th><th>Йил</th><th>Телефон</th><th>Хизматлар</th>
    <th class="r">Сумма</th><th class="r">Тўланди</th><th class="r">Қарз</th><th>Тўлов</th><th>Доктор</th><th>Юборган</th>
    ${ex.map(h => `<th>${esc(h)}</th>`).join('')}<th>Ҳолат</th><th></th></tr>`;

  const body = rows.map(r => {
    const off = r['Ҳолат'] === 'Бекор';
    const id = esc(r['ID']);
    const dbt = Number(r['Қарз']) || 0;
    const acts = `<button class="btn sm" data-act="print" data-id="${id}">Чек</button>` +
      (!off && closeField && !r[closeField] ? `<button class="btn sm" data-act="close" data-field="${esc(closeField)}" data-id="${id}">Чиқди</button>` : '') +
      (!off ? `<button class="btn sm danger" data-act="cancel" data-id="${id}">Бекор</button>` : '');
    return `<tr class="${off ? 'cancelled' : ''}">
      <td><b class="qno">${esc(r['Навбат №'])}</b></td><td>${esc(r['Вақт'])}</td>
      <td class="strong">${esc(r['Ф.И.Ш'])}</td><td>${esc(r['Туғилган йил'])}</td><td>${esc(r['Телефон'])}</td>
      <td class="wrap">${esc(r['Хизматлар'])}</td><td class="r">${money(r['Сумма'])}</td>
      <td class="r">${money(paidOf(r))}</td><td class="r ${dbt > 0 ? 'neg' : ''}">${dbt > 0 ? money(dbt) : '—'}</td>
      <td>${esc(r['Тўлов тури'])}</td><td>${esc(r['Доктор'])}</td><td>${esc(r['Юборган доктор'])}</td>
      ${ex.map(h => { const x = d.extra.find(e => e.h === h); return `<td>${esc(x.t === 'date' ? showDate(r[h]) : r[h])}</td>`; }).join('')}
      <td><span class="badge${off ? ' off' : (dbt > 0 ? ' warn' : '')}">${off ? 'Бекор' : (dbt > 0 ? 'Қарз' : 'Тўланган')}</span></td>
      <td><div class="act">${acts}</div></td></tr>`;
  }).join('');

  $('#lTable').innerHTML = head + body;
}


/* ================= ЁТОҚХОНА ================= */
const stayActive = s => s['Ҳолат'] !== 'Бекор' && s['Ҳолат'] !== 'Кетди' && !s['Кетган сана'];

// Ҳисоб: кунлар × кунлик нарх + муолажалар − тўланган (leave — кетиш санаси бўйича ҳисоблаш учун)
function calcOf(s, leave) {
  const days = daysBetween(s['Келган сана'] || s['Сана'], leave || s['Кетган сана'] || today());
  const rate = Number(s['Кунлик нарх']) || 0;
  const svc = (s.ch || []).reduce((a, c) => a + (Number(c[6]) || 0), 0);
  const paid = (s.py || []).reduce((a, p) => a + (Number(p[2]) || 0), 0);
  const bed = days * rate, total = bed + svc;
  return { active: stayActive(s), days: days, rate: rate, bed: bed, svc: svc, total: total, paid: paid, balance: total - paid };
}

const viewOf = (s, leave) => ({
  stay: s, calc: calcOf(s, leave),
  charges: (s.ch || []).map(c => ({ 'ID': c[0], 'Сана': c[1], 'Бўлим': c[2], 'Хизмат': c[3], 'Сони': c[4], 'Нарх': c[5], 'Сумма': c[6] })),
  payments: (s.py || []).map(p => ({ 'Сана': p[0], 'Вақт': p[1], 'Сумма': p[2], 'Тўлов тури': p[3], 'Тури': p[4] }))
});

function findStay(id) {
  return DB.stays.find(x => x['ID'] === id) || (DB.done || []).find(x => x['ID'] === id) || null;
}

function putStay(st) {
  const id = st['ID'];
  DB.stays = DB.stays.filter(x => x['ID'] !== id);
  if (DB.done) DB.done = DB.done.filter(x => x['ID'] !== id);
  if (st['Ҳолат'] === 'Бекор') return;
  if (stayActive(st)) DB.stays.push(st);
  else if (DB.done) DB.done.unshift(st);
  if (S.stayId === id) S.stayObj = st;
}

function bindYotoq() {
  $('#yMode').addEventListener('seg', e => { S.stayMode = e.detail; loadStays(); });
  $('#yLoad').onclick = () => { if (S.stayMode === 'active') sync(true); else loadDone(true); };
  $('#yAdmit').onclick = openAdmit;
  $('#yGrid').addEventListener('click', e => {
    const c = e.target.closest('[data-stay]');
    if (c) openStay(c.dataset.stay);
  });
  $('#sheet').addEventListener('click', onSheetClick);
  $('#sheet').addEventListener('submit', onSheetSubmit);
  $('#sheet').addEventListener('input', onSheetInput);
  $('#sheet').addEventListener('change', onSheetInput);
}

function loadStays() {
  if (S.stayMode === 'active') {
    const rows = DB.stays.slice().sort((a, b) => String(a['Келган сана']).localeCompare(String(b['Келган сана'])));
    renderStays(rows.map(s => viewOf(s)), 'active');
  } else if (DB.done) {
    renderStays(DB.done.map(s => viewOf(s)), 'done');
  } else {
    $('#yStats').innerHTML = ''; $('#yGrid').innerHTML = '<p class="muted pad">Юкланмоқда…</p>';
    loadDone();
  }
}

async function loadDone(loud) {
  try {
    const j = await api('staysDone');
    DB.done = j.rows;
    if (S.view === 'yotoq' && S.stayMode === 'done') loadStays();
  } catch (e) {
    if (DB.done || loud) toast(e.message, true);
    else if (S.stayMode === 'done') $('#yGrid').innerHTML = `<p class="err pad">${esc(e.message)}</p>`;
  }
}

function renderStays(rows, mode) {
  S.stays = rows;
  const st = { count: rows.length, total: 0, paid: 0, balance: 0 };
  rows.forEach(v => { st.total += v.calc.total; st.paid += v.calc.paid; st.balance += v.calc.balance; });
  if (mode === 'active') setPill('#nYotoq', st.count);
  $('#yStats').innerHTML = mode === 'active'
    ? stat('Ҳозир ётганлар', st.count, 'main') +
      stat('Жорий ҳисоб', money(st.total), '', 'бугунгача') +
      stat('Олдиндан тўланган', money(st.paid), 'good') +
      stat('Тўланмаган қолдиқ', money(Math.max(0, st.balance)), st.balance > 0 ? 'warn' : '')
    : stat('Кетганлар', st.count) + stat('Жами ҳисоб', money(st.total)) +
      stat('Тўланган', money(st.paid), 'good') + stat('Қарз', money(Math.max(0, st.balance)), st.balance > 0 ? 'warn' : '');

  if (!rows.length) {
    $('#yGrid').innerHTML = `<div class="blank"><b>${mode === 'active' ? 'Ҳозир ётган бемор йўқ' : 'Кетган беморлар йўқ'}</b>
      <span>Янги беморни «+ Бемор қабул қилиш» тугмаси орқали ёзинг.</span></div>`;
    return;
  }
  $('#yGrid').innerHTML = rows.map(v => {
    const s = v.stay, c = v.calc;
    const bal = c.balance;
    const tag = bal > 0 ? `<span class="badge warn">${c.active ? 'Қолдиқ' : 'Қарз'} ${money(bal)}</span>`
      : bal < 0 ? `<span class="badge good">Ортиқча ${money(-bal)}</span>` : '<span class="badge good">Тўланган</span>';
    return `<button type="button" class="stay" data-stay="${esc(s['ID'])}">
      <div class="stay-top"><span class="qno">№ ${esc(s['Навбат №'])}</span>${tag}</div>
      <div class="stay-name">${esc(s['Ф.И.Ш'])}</div>
      <div class="stay-meta">${esc(s['Ётоқ тури'] || 'Хона кўрсатилмаган')} · ${showDate(s['Келган сана'])}${s['Кетган сана'] ? ' — ' + showDate(s['Кетган сана']) : ''}</div>
      <div class="stay-nums">
        <div><span>Кун</span><b>${c.days}</b></div>
        <div><span>Ҳисоб</span><b>${money(c.total)}</b></div>
        <div><span>Тўланган</span><b>${money(c.paid)}</b></div>
      </div>
    </button>`;
  }).join('');
}


function openAdmit() {
  const rooms = S.cfg.services.filter(s => s.dept === YOTOQ_NAME);
  openSheet(`
    <form id="admitForm" autocomplete="off">
      <div class="sheet-head"><div><h3>Беморни ётоқхонага қабул қилиш</h3>
        <p class="muted">Тўлов одатда кетаётганда олинади; хоҳласа, олдиндан тўлаши мумкин.</p></div>
        <button type="button" class="x" data-act="close">×</button></div>
      <div class="grid g4">
        <label class="f span2">Ф.И.Ш *<input name="fio"></label>
        <label class="f">Туғилган йил<input name="year" inputmode="numeric" maxlength="4"></label>
        <label class="f">Телефон<input name="phone" inputmode="tel"></label>
        <label class="f span2">Хона / ётоқ тури<input name="room" list="roomList" placeholder="Масалан: 2-хона, люкс"></label>
        <label class="f span2">Кунлик нарх, сўм<input name="rate" class="money" inputmode="numeric"></label>
        <label class="f">Келган сана<input name="arrive" type="date" value="${today()}"></label>
        <label class="f">Келган соат<input name="arriveTime" type="time" value="${nowTime()}"></label>
        <label class="f">Доктор<input name="doctor" list="docList"></label>
        <label class="f">Юборган доктор<input name="referrer" list="docList"></label>
        <label class="f span2">Олдиндан тўлов (аванс), сўм<input name="prepay" class="money" inputmode="numeric" placeholder="0"></label>
        <div class="f span2"><span>Тўлов тури</span><div class="seg" data-role="pay">${segHtml(S.cfg.payments)}</div></div>
        <label class="f span4">Изоҳ<input name="note"></label>
      </div>
      <datalist id="roomList">${rooms.map(r => `<option value="${esc(r.name)}">`).join('')}</datalist>
      <div class="sheet-foot"><button type="button" class="btn" data-act="close">Бекор</button>
        <button type="submit" class="btn primary big">Қабул қилиш</button></div>
    </form>`, 'modal');
  $('#admitForm').fio.focus();
}


function svcOptions() {
  const by = {};
  S.cfg.services.forEach((s, i) => { if (s.dept !== YOTOQ_NAME) (by[s.dept] = by[s.dept] || []).push(i); });
  return '<option value="">Хизматни танланг…</option>' +
    Object.keys(by).map(d => `<optgroup label="${esc(d)}">` +
      by[d].map(i => `<option value="${i}">${esc(S.cfg.services[i].name)}${S.cfg.services[i].price ? ' — ' + money(S.cfg.services[i].price) : ''}</option>`).join('') +
      '</optgroup>').join('') + '<option value="custom">Бошқа хизмат…</option>';
}


function openStay(id) {
  const s = findStay(id);
  if (!s) return;
  S.stayId = id;
  S.stayObj = s;
  openSheet('', 'drawer');
  renderStay();
}

// Очиқ турган бемор (рўйхатдан йўқолса ҳам — масалан, ҳозиргина чиқарилган бўлса — панел ишлайверади)
const cur = () => S.stayObj || null;

function stayTopHtml(v) {
  const s = v.stay, c = v.calc, act = c.active, bal = c.balance;
  const balRow = bal > 0
    ? `<div class="tot due"><span>${act ? 'Тўланмаган қолдиқ' : 'Қарз'}</span><b>${money(bal)}</b></div>`
    : bal < 0 ? `<div class="tot ok"><span>Ортиқча тўланган</span><b>${money(-bal)}</b></div>`
    : '<div class="tot ok"><span>Қолдиқ</span><b>0</b></div>';
  return `
    <div class="sheet-head">
      <div><span class="qno">№ ${esc(s['Навбат №'])}</span>
        <h3>${esc(s['Ф.И.Ш'])}</h3>
        <p class="muted">${[s['Туғилган йил'] ? s['Туғилган йил'] + ' й.' : '', s['Телефон']].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p></div>
      <div class="head-r">${s._pend ? '<span class="saving">сақланмоқда…</span>' : ''}<span class="badge ${act ? '' : 'off'}">${act ? 'Ётибди' : 'Кетди'}</span>
        <button type="button" class="x" data-act="close">×</button></div>
    </div>
    <div class="facts">
      <div><span>Хона / ётоқ</span><b>${esc(s['Ётоқ тури'] || '—')}</b></div>
      <div><span>Кунлик нарх</span><b>${money(c.rate)}</b></div>
      <div><span>Келди</span><b>${showDate(s['Келган сана'])} ${esc(s['Келган соат'] || '')}</b></div>
      <div><span>${act ? 'Ётган кун' : 'Кетди'}</span><b>${act ? c.days + ' кун' : showDate(s['Кетган сана']) + ' · ' + c.days + ' кун'}</b></div>
      <div><span>Доктор</span><b>${esc(s['Доктор'] || '—')}</b></div>
      <div><span>Юборган</span><b>${esc(s['Юборган доктор'] || '—')}</b></div>
    </div>
    <div class="totals">
      <div class="tot"><span>Ётоқ: ${c.days} кун × ${money(c.rate)}</span><b>${money(c.bed)}</b></div>
      <div class="tot"><span>Муолажалар</span><b>${money(c.svc)}</b></div>
      <div class="tot sum"><span>Жами</span><b>${money(c.total)}</b></div>
      <div class="tot"><span>Тўланган</span><b>${money(c.paid)}</b></div>
      ${balRow}
    </div>`;
}

function stayChHtml(v) {
  const act = v.calc.active;
  const byDay = {};
  v.charges.forEach(x => { (byDay[x['Сана']] = byDay[x['Сана']] || []).push(x); });
  const days = Object.keys(byDay).sort().reverse();
  if (!days.length) return '<p class="muted note">Ҳали муолажа киритилмаган.</p>';
  return days.map(d => {
    const sub = byDay[d].reduce((a, x) => a + (Number(x['Сумма']) || 0), 0);
    return `<div class="day"><div class="day-head"><b>${showDate(d)}</b><span>${money(sub)}</span></div>` +
      byDay[d].map(x => {
        const tmp = String(x['ID']).indexOf('tmp') === 0;
        return `<div class="line${tmp ? ' tmp' : ''}">
        <span class="nm">${esc(x['Хизмат'])}${Number(x['Сони']) > 1 ? ' ×' + esc(x['Сони']) : ''}<small>${esc(x['Бўлим'] || '')}</small></span>
        <span class="am">${money(x['Сумма'])}</span>
        ${act && !tmp ? `<button type="button" class="x" title="Олиб ташлаш" data-act="chargeDel" data-id="${esc(x['ID'])}">×</button>` : '<span></span>'}
      </div>`;
      }).join('') + '</div>';
  }).join('');
}

function stayPyHtml(v) {
  if (!v.payments.length) return '<p class="muted note">Тўлов қилинмаган.</p>';
  return v.payments.map(p => `<div class="line">
      <span class="nm">${showDate(p['Сана'])} ${esc(p['Вақт'])}<small>${esc(p['Тури'])} · ${esc(p['Тўлов тури'])}</small></span>
      <span class="am">${money(p['Сумма'])}</span><span></span></div>`).join('');
}

// Ён панелни тўлиқ чизади (формалар билан).
function renderStay(keep) {
  const s = cur();
  if (!s) return;
  const v = viewOf(s), c = v.calc, act = c.active, bal = c.balance;
  $('#sheet').innerHTML = `
    <div id="stTop">${stayTopHtml(v)}</div>
    <div class="bar">
      ${act ? `<button type="button" class="btn primary" data-act="panel" data-p="out">Чиқариш (кетди)</button>
               <button type="button" class="btn" data-act="panel" data-p="pay">Тўлов қабул қилиш</button>
               <button type="button" class="btn" data-act="panel" data-p="edit">Таҳрирлаш</button>`
            : (bal > 0 ? `<button type="button" class="btn primary" data-act="debt">Қарзни тўлаш</button>` : '')}
      <button type="button" class="btn" data-act="statement">Ҳисоб чеки</button>
      ${act ? '<button type="button" class="btn danger" data-act="stayCancel">Бекор қилиш</button>' : ''}
    </div>

    ${act ? `
    <form class="panel hidden" data-panel="pay">
      <h4>Тўлов қабул қилиш (аванс)</h4>
      <div class="grid g2">
        <label class="f">Сумма, сўм<input name="amount" class="money" inputmode="numeric" value="${bal > 0 ? money(bal) : ''}"></label>
        <div class="f"><span>Тўлов тури</span><div class="seg" data-role="pay">${segHtml(S.cfg.payments)}</div></div>
      </div>
      <button type="submit" class="btn primary">Тўловни сақлаш ва чек</button>
    </form>

    <form class="panel hidden" data-panel="out">
      <h4>Чиқариш ва ҳисоб-китоб</h4>
      <div class="grid g2">
        <label class="f">Кетган сана<input name="date" type="date" value="${today()}" min="${esc(s['Келган сана'] || '')}"></label>
        <div class="f"><span>Якуний ҳисоб</span><div class="calc" data-role="outCalc"></div></div>
        <label class="f">Ҳозир тўлайди, сўм<input name="amount" class="money" inputmode="numeric"></label>
        <div class="f"><span>Тўлов тури</span><div class="seg" data-role="pay">${segHtml(S.cfg.payments)}</div></div>
      </div>
      <div class="debt-line hidden" data-role="outDebt">Қарзга қолади: <b></b></div>
      <button type="submit" class="btn primary">Чиқариш ва чек</button>
    </form>

    <form class="panel hidden" data-panel="edit">
      <h4>Маълумотни таҳрирлаш</h4>
      <div class="grid g3">
        <label class="f">Хона / ётоқ тури<input name="room" list="roomList2" value="${esc(s['Ётоқ тури'] || '')}"></label>
        <label class="f">Кунлик нарх, сўм<input name="rate" class="money" inputmode="numeric" value="${money(c.rate)}"></label>
        <label class="f">Келган сана<input name="arrive" type="date" value="${esc(s['Келган сана'] || '')}"></label>
      </div>
      <datalist id="roomList2">${S.cfg.services.filter(x => x.dept === YOTOQ_NAME).map(r => `<option value="${esc(r.name)}">`).join('')}</datalist>
      <button type="submit" class="btn primary">Сақлаш</button>
    </form>

    <h4>Муолажа қўшиш</h4>
    <form class="add-line" data-panel="charge">
      <input name="date" type="date" value="${today()}" title="Сана">
      <select name="svc">${svcOptions()}</select>
      <input name="custom" class="hidden" placeholder="Хизмат номи">
      <input name="qty" type="number" min="1" value="1" title="Сони">
      <input name="price" class="money" inputmode="numeric" placeholder="Нарх">
      <button type="submit" class="btn primary">Қўшиш</button>
    </form>` : ''}

    <h4>Муолажалар</h4>
    <div class="lines" id="stCh">${stayChHtml(v)}</div>
    <h4>Тўловлар</h4>
    <div class="lines" id="stPy">${stayPyHtml(v)}</div>
    ${s['Изоҳ'] ? `<p class="muted note">Изоҳ: ${esc(s['Изоҳ'])}</p>` : ''}`;

  if (keep) togglePanel(keep, true);
  updateOutCalc(true);
}

// Фақат рақамлар ва рўйхатларни янгилайди — формага ёзилаётган нарса ўчмайди.
function refreshStay() {
  const s = cur();
  if (!s || !$('#stTop')) return;
  const v = viewOf(s);
  $('#stTop').innerHTML = stayTopHtml(v);
  $('#stCh').innerHTML = stayChHtml(v);
  $('#stPy').innerHTML = stayPyHtml(v);
  updateOutCalc(false);
}

function refreshYotoq() {
  setPill('#nYotoq', DB.stays.length);
  if (S.view === 'yotoq') loadStays();
  refreshStay();
}

// Ётган бемор устидаги амал: экранда дарҳол, серверга орқа фонда.
function stayOp(s, op, data) {
  s._pend = (s._pend || 0) + 1;
  refreshYotoq();
  return write('stayOp', { id: s['ID'], row: s._row, op: op, data: data }).then(j => {
    const now = (S.stayObj && S.stayObj['ID'] === s['ID']) ? S.stayObj : (findStay(s['ID']) || s);
    now._pend = Math.max(0, (now._pend || 1) - 1);
    if (!now._pend) putStay(j.stay);      // навбатда бошқа амал бўлмаса — сервер ҳолати билан алмаштирамиз
    persist(); dropReports(); refreshYotoq();
    return j;
  }, e => {
    toast('Сақланмади: ' + e.message, true);
    const now = findStay(s['ID']); if (now) now._pend = 0;
    sync(true);
    throw e;
  });
}

function togglePanel(name, force) {
  $$('#sheet .panel').forEach(p => {
    const on = p.dataset.panel === name && (force || p.classList.contains('hidden'));
    p.classList.toggle('hidden', !on);
    if (on) { const i = p.querySelector('input'); if (i) i.focus(); }
  });
}


function updateOutCalc(reset) {
  const f = $('#sheet form[data-panel="out"]');
  const s = cur();
  if (!f || !s) return;
  const c = calcOf(s, f.date.value || today());
  const bal = c.balance;
  $('[data-role=outCalc]', f).innerHTML =
    `${c.days} кун · жами <b>${money(c.total)}</b> · тўланган ${money(c.paid)} · <b class="${bal > 0 ? 'neg' : 'pos'}">${bal >= 0 ? 'қолдиқ ' + money(bal) : 'ортиқча ' + money(-bal)}</b>`;
  if (reset) f.amount.value = bal > 0 ? money(bal) : '';
  const left = bal - num(f.amount.value);
  const dl = $('[data-role=outDebt]', f);
  dl.classList.toggle('hidden', !(left > 0));
  $('b', dl).textContent = money(left) + ' сўм';
}

function onSheetInput(e) {
  const t = e.target;
  const f = t.closest('form');
  if (!f) return;
  if (f.dataset.panel === 'out') updateOutCalc(t.name === 'date');
  if (f.dataset.panel === 'charge' && t.name === 'svc') {
    const custom = t.value === 'custom';
    f.custom.classList.toggle('hidden', !custom);
    if (custom) f.custom.focus();
    const sv = S.cfg.services[t.value];
    f.price.value = sv && sv.price ? money(sv.price) : '';
  }
  if (f.id === 'admitForm' && t.name === 'room') {
    const r = S.cfg.services.find(x => x.dept === YOTOQ_NAME && x.name === t.value);
    if (r && r.price) f.rate.value = money(r.price);
  }
}


function onSheetClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') return closeSheet();
  if (act === 'panel') return togglePanel(b.dataset.p);
  const s = cur();
  if (!s) return;

  if (act === 'statement') return printStay(viewOf(s));

  if (act === 'chargeDel') {
    if (!confirm('Бу муолажа ҳисобдан олиб ташлансинми?')) return;
    s.ch = s.ch.filter(c => String(c[0]) !== b.dataset.id);
    stayOp(s, 'chargeCancel', { cid: b.dataset.id }).catch(() => {});
  }

  if (act === 'stayCancel') {
    const reason = prompt('Ётоқ ёзувини бекор қилиш сабаби (тўловлари ҳам бекор бўлади):');
    if (reason === null) return;
    DB.stays = DB.stays.filter(x => x !== s);
    persist(); dropReports(); closeSheet(); refreshYotoq();
    write('cancel', { dept: YOTOQ, id: s['ID'], row: s._row, reason: reason })
      .then(() => toast('Бекор қилинди'), err => { toast('Сақланмади: ' + err.message, true); sync(true); });
  }

  if (act === 'debt') {
    const c = calcOf(s);
    closeSheet();
    openDebtPay({ dept: YOTOQ, deptName: YOTOQ_NAME, id: s['ID'], row: s._row, fio: s['Ф.И.Ш'], debt: c.balance, sum: c.total, paid: c.paid });
  }
}

async function onSheetSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');

  if (f.id === 'admitForm') {
    if (!f.fio.value.trim()) { toast('Ф.И.Ш ни киритинг', true); f.fio.focus(); return; }
    busy(btn, true);
    try {
      const prepay = num(f.prepay.value), payment = segVal($('[data-role=pay]', f));
      const j = await write('stayAdmit', { data: {
        fio: f.fio.value.trim(), year: f.year.value.trim(), phone: f.phone.value.trim(),
        room: f.room.value.trim(), rate: num(f.rate.value),
        arrive: f.arrive.value, arriveTime: f.arriveTime.value,
        doctor: f.doctor.value.trim(), referrer: f.referrer.value.trim(),
        prepay: prepay, payment: payment, note: f.note.value.trim() } });
      const st = j.stay;
      toast('Бемор қабул қилинди. № ' + st['Навбат №']);
      putStay(st); persist(); dropReports();
      S.stayMode = 'active';
      $$('#yMode button').forEach(x => x.classList.toggle('on', x.dataset.v === 'active'));
      refreshYotoq();
      openStay(st['ID']);
      if (prepay > 0) printPay({ title: 'АВАНС ТЎЛОВИ', dept: YOTOQ_NAME, fio: st['Ф.И.Ш'], amount: prepay, payment: payment });
    } catch (err) {
      const fio = f.fio.value.trim();
      const known = DB.stays.map(x => x['ID']);
      const st = err.lost ? await recover(() => DB.stays.find(x => known.indexOf(x['ID']) < 0 && String(x['Ф.И.Ш']).trim() === fio)) : null;
      if (st) {
        toast('Сақланган экан. № ' + st['Навбат №']);
        S.stayMode = 'active';
        $$('#yMode button').forEach(x => x.classList.toggle('on', x.dataset.v === 'active'));
        refreshYotoq();
        openStay(st['ID']);
      } else {
        toast(err.lost ? 'Сервердан жавоб келмади. Рўйхатни текширинг: бемор йўқ бўлса, қайта сақланг.' : err.message, true);
        busy(btn, false);
      }
    }
    return;
  }

  if (f.id === 'debtForm') return submitDebt(f);
  const s = cur();
  if (!s) return;
  const kind = f.dataset.panel;

  if (kind === 'charge') {
    const v = f.svc.value;
    const sv = S.cfg.services[v];
    const name = v === 'custom' ? f.custom.value.trim() : (sv ? sv.name : '');
    if (!name) { toast('Хизматни танланг', true); return; }
    const date = f.date.value || today();
    const qty = Math.max(1, parseInt(f.qty.value, 10) || 1), price = num(f.price.value), dept = sv ? sv.dept : '';
    // Дарҳол рўйхатга қўшилади; форма кейинги муолажа учун тайёр
    s.ch.push(['tmp' + (++tmpN), date, dept, name, qty, price, qty * price]);
    f.svc.value = ''; f.custom.value = ''; f.custom.classList.add('hidden'); f.qty.value = 1; f.price.value = '';
    stayOp(s, 'charge', { date: date, items: [{ name: name, dept: dept, qty: qty, price: price }] }).catch(() => {});
    f.svc.focus();
    return;
  }

  if (kind === 'pay') {
    const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
    if (!(amount > 0)) { toast('Суммани киритинг', true); return; }
    s.py.push([today(), nowTime(), amount, payment, 'Аванс']);
    togglePanel('pay', false); f.classList.add('hidden'); f.amount.value = '';
    stayOp(s, 'pay', { amount: amount, payment: payment }).catch(() => {});
    const c = calcOf(s);
    printPay({ title: 'АВАНС ТЎЛОВИ', dept: YOTOQ_NAME, fio: s['Ф.И.Ш'], amount: amount, payment: payment,
      note: 'Жорий ҳисоб: ' + money(c.total) + ' · тўланган: ' + money(c.paid) });
    return;
  }

  if (kind === 'edit') {
    const data = { room: f.room.value.trim(), rate: num(f.rate.value), arrive: f.arrive.value };
    s['Ётоқ тури'] = data.room; s['Кунлик нарх'] = data.rate;
    if (data.arrive) s['Келган сана'] = data.arrive;
    f.classList.add('hidden');
    stayOp(s, 'edit', data).then(() => toast('Сақланди'), () => {});
    return;
  }

  if (kind === 'out') {
    const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
    const leave = f.date.value || today();
    const bal = calcOf(s, leave).balance;
    if (amount > Math.max(0, bal)) { toast('Сумма қолдиқдан катта', true); return; }
    const left = bal - amount;
    if (!confirm(s['Ф.И.Ш'] + ' чиқарилсинми?\nКетган сана: ' + showDate(leave) +
        '\nҲозир тўлайди: ' + money(amount) + ' сўм' + (left > 0 ? '\nҚарзга қолади: ' + money(left) + ' сўм' : ''))) return;
    busy(btn, true);
    try {
      // Чиқариш — муҳим амал: сервер тасдиғини кутамиз
      const j = await write('stayOp', { id: s['ID'], row: s._row, op: 'discharge', data: { date: leave, amount: amount, payment: payment } });
      putStay(j.stay); persist(); dropReports();
      toast('Бемор чиқарилди');
      refreshYotoq();
      renderStay();
      if (left > 0) loadDebts(true);
      printStay(viewOf(j.stay));
    } catch (err) { toast(err.message, true); busy(btn, false); }
  }
}

/* ================= ҚАРЗЛАР ================= */
function bindQarz() {
  $('#dLoad').onclick = () => loadDebts();
  $('#dSearch').addEventListener('input', renderDebts);
  $('#dTable').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) openDebtPay(S.debtView[Number(b.dataset.i)]);
  });
}

async function loadDebts(quiet) {
  if (DB.debts) renderDebts();
  else if (!quiet) { $('#dTable').innerHTML = empty('Юкланмоқда…'); $('#dStats').innerHTML = ''; }
  // Маълумот версияси ўзгармаган бўлса — сервердан қайта сўрамаймиз
  if (DB.debts && DB.debtsVer && DB.debtsVer === DB.ver) return;
  try {
    const j = await api('debts');
    if (W && DB.debts) return;         // ёзиш кетяпти — эски рўйхат билан алмаштирмаймиз
    DB.debts = j.rows;
    DB.debtsVer = j.ver || '';
    persist();
    renderDebts();
  } catch (e) {
    if (e.auth) return relogin(e.message);
    if (quiet) return;
    if (DB.debts) toast(e.message, true);
    else $('#dTable').innerHTML = `<tr><td class="err">${esc(e.message)}</td></tr>`;
  }
}

function renderDebts() {
  const all = DB.debts || [];
  setPill('#nQarz', all.length);
  const q = $('#dSearch').value.trim().toLowerCase();
  const rows = all.filter(r => !q || String(r.fio).toLowerCase().includes(q) || String(r.phone).toLowerCase().includes(q));
  S.debtView = rows;
  const total = rows.reduce((s, r) => s + r.debt, 0);
  const people = uniq(rows.map(r => String(r.fio).toLowerCase() + '|' + r.phone)).length;
  $('#dStats').innerHTML = stat('Жами қарз', money(total), total > 0 ? 'warn main' : 'main', 'сўм') +
    stat('Ёзувлар', rows.length) + stat('Қарздорлар', people);

  if (!rows.length) { $('#dTable').innerHTML = empty(q ? 'Топилмади' : 'Қарздорлар йўқ'); return; }
  $('#dTable').innerHTML = `<tr><th>Сана</th><th>Бўлим</th><th>Ф.И.Ш</th><th>Телефон</th><th>Хизматлар</th>
    <th class="r">Сумма</th><th class="r">Тўланган</th><th class="r">Қарз</th><th></th></tr>` +
    rows.map((r, i) => `<tr>
      <td>${showDate(r.date)}</td><td>${esc(r.deptName)}</td>
      <td class="strong">${esc(r.fio)}${r.year ? ` <small class="muted">${esc(r.year)}</small>` : ''}</td>
      <td>${esc(r.phone)}</td><td class="wrap">${esc(r.items)}</td>
      <td class="r">${money(r.sum)}</td><td class="r">${money(r.paid)}</td><td class="r neg"><b>${money(r.debt)}</b></td>
      <td><div class="act"><button class="btn sm primary" data-i="${i}">Тўлаш</button></div></td></tr>`).join('');
}

function openDebtPay(r) {
  S.debtRow = r;
  openSheet(`
    <form id="debtForm" autocomplete="off">
      <div class="sheet-head"><div><h3>Қарзни тўлаш</h3>
        <p class="muted">${esc(r.fio)} · ${esc(r.deptName)}</p></div>
        <button type="button" class="x" data-act="close">×</button></div>
      <div class="totals">
        <div class="tot"><span>Жами ҳисоб</span><b>${money(r.sum)}</b></div>
        <div class="tot"><span>Тўланган</span><b>${money(r.paid)}</b></div>
        <div class="tot due"><span>Қарз</span><b>${money(r.debt)}</b></div>
      </div>
      <div class="grid g2">
        <label class="f">Тўлайди, сўм<input name="amount" class="money" inputmode="numeric" value="${money(r.debt)}"></label>
        <div class="f"><span>Тўлов тури</span><div class="seg" data-role="pay">${segHtml(S.cfg.payments)}</div></div>
      </div>
      <div class="sheet-foot"><button type="button" class="btn" data-act="close">Бекор</button>
        <button type="submit" class="btn primary big">Тўловни сақлаш ва чек</button></div>
    </form>`, 'modal narrow');
  const i = $('#debtForm').amount; i.focus(); i.select();
}


function submitDebt(f) {
  const r = S.debtRow;
  const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
  if (!(amount > 0)) { toast('Суммани киритинг', true); return; }
  if (amount > r.debt) { toast('Сумма қарздан катта', true); return; }
  // Экранда дарҳол, серверга орқа фонда
  const row = (DB.debts || []).find(x => x.id === r.id) || r;
  row.paid += amount; row.debt -= amount;
  if (DB.debts && row.debt <= 0) DB.debts = DB.debts.filter(x => x !== row);
  const left = row.debt;
  const today_ = (DB.lists[r.dept] || []).find(x => x['ID'] === r.id);
  if (today_) { today_['Тўланган'] = paidOf(today_) + amount; today_['Қарз'] = Math.max(0, (Number(today_['Қарз']) || 0) - amount); }
  const st = r.dept === YOTOQ ? findStay(r.id) : null;
  if (st) st.py.push([today(), nowTime(), amount, payment, 'Қарз тўлови']);
  DB.debtsVer = '';
  Object.keys(C).forEach(k => delete C[k]);
  persist();
  closeSheet();
  renderDebts(); refreshView();
  toast('Қарз тўлови қабул қилинди');
  printPay({ title: 'ҚАРЗ ТЎЛОВИ', dept: r.deptName, fio: r.fio, amount: amount, payment: payment,
    note: left > 0 ? 'Қолган қарз: ' + money(left) + ' сўм' : 'Қарз тўлиқ ёпилди' });
  write('payDebt', { dept: r.dept, id: r.id, row: r.row, amount: amount, payment: payment })
    .catch(err => { toast('Сақланмади: ' + err.message, true); DB.debts = null; DB.debtsVer = ''; loadDebts(); sync(true); });
}

/* ================= ҲИСОБОТ ================= */
function setRange(k) {
  const d = new Date();
  let f, t = today();
  if (k === 'today') f = t;
  else if (k === 'yesterday') { const y = new Date(d); y.setDate(d.getDate() - 1); f = t = isoDate(y); }
  else if (k === 'week') { const y = new Date(d); y.setDate(d.getDate() - 6); f = isoDate(y); }
  else if (k === 'month') f = isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  else if (k === 'lastmonth') { f = isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)); t = isoDate(new Date(d.getFullYear(), d.getMonth(), 0)); }
  $('#pFrom').value = f;
  $('#pTo').value = t;
}


/* Ҳисобот: сервер бир марта кунлар бўйича жамланма беради (REP.all), даврлар шу ердан йиғилади.
   Охирги ҳисобот сақланиб туради; «Янгилаш» босилганда (ёки 10 дақиқадан эскирса ва ўзгариш бўлса) янгиланади. */
const REP = { all: null, at: 0 };
let repBusy = false;

function bindReport() {
  $('#pRange').addEventListener('seg', e => { setRange(e.detail); loadReport(); });
  $('#pLoad').onclick = () => { $$('#pRange button').forEach(b => b.classList.remove('on')); loadReport(); };
  $('#pRefresh').onclick = () => loadReport(true);
  $('#pPrint').onclick = () => { if (S.report) doPrint('report'); };
  try {
    const r = JSON.parse(store.get('rep') || 'null');
    if (r && r.all && r.all.days) { REP.all = r.all; REP.at = r.at || 0; }
  } catch (e) {}
}

function repLabel() {
  const el = $('#pUpd');
  if (!REP.all) { el.innerHTML = ''; return; }
  const d = new Date(REP.at);
  const stale = !!DB.ver && REP.all.ver !== DB.ver && Number(DB.ver) > Number(REP.all.ver);
  el.innerHTML = '· янгиланди ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) +
    (stale ? ' · <b class="neg">янги ёзувлар бор — «Янгилаш»ни босинг</b>' : '');
}

// Жамланмадан танланган давр учун ҳисобот йиғади (серверга мурожаатсиз)
function aggReport(all, from, to) {
  from = from || all.today; to = to || from;
  const r = { from: from, to: to, cash: { total: 0, count: 0, byPay: {}, byKind: {}, byDay: {} },
    billed: { total: 0, count: 0, debt: 0, share: 0 }, debtNow: all.debtNow, inpatients: all.inpatients,
    cancelled: 0, depts: [], doctors: [], referrers: [] };
  const dm = {};
  const dep = n => dm[n] || (dm[n] = { name: n, count: 0, sum: 0, cash: 0, debt: 0, share: 0 });
  (all.deptNames || []).forEach(dep);
  const docs = {}, refs = {};
  const add = (o, src) => Object.keys(src).forEach(k => { o[k] = (o[k] || 0) + src[k]; });
  Object.keys(all.days).forEach(dt => {
    if (dt < from || dt > to) return;
    const x = all.days[dt];
    r.cash.total += x.cash; r.cash.count += x.cashN;
    add(r.cash.byPay, x.byPay); add(r.cash.byKind, x.byKind);
    if (x.cash) r.cash.byDay[dt] = x.cash;
    Object.keys(x.cashDept).forEach(n => { dep(n).cash += x.cashDept[n]; });
    Object.keys(x.depts).forEach(n => { const a = x.depts[n], m = dep(n); m.count += a.count; m.sum += a.sum; m.debt += a.debt; m.share += a.share; });
    Object.keys(x.docs).forEach(k => { const a = x.docs[k], g = docs[k] || (docs[k] = { name: a.name, dept: a.dept, count: 0, sum: 0, share: 0 }); g.count += a.count; g.sum += a.sum; g.share += a.share; });
    Object.keys(x.refs).forEach(k => { const a = x.refs[k], g = refs[k] || (refs[k] = { name: k, count: 0, sum: 0 }); g.count += a.count; g.sum += a.sum; });
    r.cancelled += x.cancelled;
  });
  r.depts = Object.keys(dm).map(n => dm[n]);
  r.depts.forEach(d => { r.billed.total += d.sum; r.billed.count += d.count; r.billed.debt += d.debt; r.billed.share += d.share; });
  r.doctors = Object.keys(docs).map(k => docs[k]).sort((a, b) => b.sum - a.sum);
  r.referrers = Object.keys(refs).map(k => refs[k]).sort((a, b) => b.sum - a.sum);
  return r;
}

function showReport() {
  if (!REP.all) return;
  S.report = aggReport(REP.all, $('#pFrom').value, $('#pTo').value);
  renderReport(S.report);
  repLabel();
}

async function loadReport(force) {
  if (!S.user || S.user.role !== 'админ') return;
  if (REP.all) showReport();
  else $('#pBody').innerHTML = '<p class="muted pad">Юкланмоқда…</p>';
  const stale = !REP.all || REP.all.ver !== DB.ver;
  const old = !REP.all || Date.now() - REP.at > 10 * 60 * 1000;
  if (repBusy || !(force || !REP.all || (stale && old))) return;
  repBusy = true;
  busy($('#pRefresh'), true);
  try {
    // Жавобда ҳисобот бўлмаса (сервер бўш жавоб қайтарса) — бир марта қайта сўраймиз
    let j = await api('reportAll');
    if (!j.report || !j.report.days) j = await api('reportAll');
    if (!j.report || !j.report.days) throw new Error('Сервер ҳисоботни қайтармади — яна бир марта «Янгилаш»ни босинг');
    REP.all = j.report; REP.at = Date.now();
    store.set('rep', JSON.stringify(REP));
    showReport();
    // Ҳисобот сайтдаги маълумотдан янгироқ бўлса — сайтни ҳам тенглаштирамиз (акс ҳолда «янги ёзувлар бор» ёзуви кетмайди)
    if (REP.all && REP.all.ver !== DB.ver) sync(true).then(() => repLabel());
  } catch (e) {
    if (REP.all) toast(e.message, true);
    else $('#pBody').innerHTML = `<p class="err pad">${esc(e.message)}</p>`;
  } finally {
    repBusy = false;
    busy($('#pRefresh'), false);
  }
}


function bars(obj, sortKeys) {
  const keys = sortKeys ? Object.keys(obj).sort() : Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
  if (!keys.length) return '<p class="muted note">Маълумот йўқ</p>';
  const max = Math.max(1, ...keys.map(k => obj[k]));
  return keys.map(k => `<div class="bar-row"><span>${esc(sortKeys ? showDate(k) : k)}</span>
    <div class="track"><div class="fill" style="width:${(obj[k] / max * 100).toFixed(1)}%"></div></div>
    <b>${money(obj[k])}</b></div>`).join('');
}


function renderReport(r) {
  $('#pPeriod').textContent = r.from === r.to ? showDate(r.from) : showDate(r.from) + ' — ' + showDate(r.to);
  const b = r.billed, c = r.cash, ip = r.inpatients;
  const depts = r.depts.filter(d => d.count || d.cash);
  const maxDept = Math.max(1, ...r.depts.map(d => d.sum));

  $('#pBody').innerHTML = `
    <div class="stats six">
      ${stat('Касса тушуми', money(c.total), 'main', c.count + ' та тўлов')}
      ${stat('Кўрсатилган хизматлар', money(b.total), '', b.count + ' та қабул')}
      ${stat('Шу даврдан қолган қарз', money(b.debt), b.debt > 0 ? 'warn' : '')}
      ${stat('Жами қарз (ҳозир)', money(r.debtNow.total), r.debtNow.total > 0 ? 'warn' : '', r.debtNow.count + ' та ёзув')}
      ${stat('Докторлар улуши', money(b.share))}
      ${stat('Клиника улуши', money(b.total - b.share), 'good', 'хизматлар − улуш')}
    </div>

    <div class="two">
      <div class="card"><h3>Тўлов турлари бўйича тушум</h3>${bars(c.byPay)}</div>
      <div class="card"><h3>Тушум манбаи</h3>${bars(c.byKind)}
        <p class="muted note">Қабул — амбулатор тўлов; Аванс ва Ҳисоб-китоб — ётоқхона; Қарз тўлови — эски қарзлар.</p></div>
    </div>

    <div class="card flush">
      <h3 class="in">Бўлимлар</h3>
      <div class="table-wrap"><table>
        <tr><th>Бўлим</th><th class="r">Қабул</th><th class="r">Хизматлар</th><th class="bar-cell"></th><th class="r">Касса тушуми</th><th class="r">Қарз</th><th class="r">Доктор улуши</th><th class="r">Клиника улуши</th></tr>
        ${(depts.length ? depts : r.depts).map(d => `<tr><td class="strong">${esc(d.name)}</td><td class="r">${d.count}</td>
          <td class="r">${money(d.sum)}</td><td class="bar-cell"><div class="track"><div class="fill" style="width:${(d.sum / maxDept * 100).toFixed(1)}%"></div></div></td>
          <td class="r">${money(d.cash)}</td><td class="r ${d.debt > 0 ? 'neg' : ''}">${d.debt > 0 ? money(d.debt) : '—'}</td>
          <td class="r">${money(d.share)}</td><td class="r">${money(d.sum - d.share)}</td></tr>`).join('')}
        <tr class="total"><td>Жами</td><td class="r">${b.count}</td><td class="r">${money(b.total)}</td><td class="bar-cell"></td>
          <td class="r">${money(c.total)}</td><td class="r">${money(b.debt)}</td><td class="r">${money(b.share)}</td><td class="r">${money(b.total - b.share)}</td></tr>
      </table></div>
    </div>

    <div class="two">
      <div class="card flush"><h3 class="in">Докторлар</h3><div class="table-wrap"><table>${r.doctors.length
        ? '<tr><th>Доктор</th><th>Бўлим</th><th class="r">Қабул</th><th class="r">Сумма</th><th class="r">Улуши</th></tr>' +
          r.doctors.map(d => `<tr><td class="strong">${esc(d.name)}</td><td>${esc(d.dept)}</td><td class="r">${d.count}</td>
            <td class="r">${money(d.sum)}</td><td class="r"><b>${money(d.share)}</b></td></tr>`).join('')
        : empty('Маълумот йўқ')}</table></div></div>
      <div class="card flush"><h3 class="in">Юборган докторлар</h3><div class="table-wrap"><table>${r.referrers.length
        ? '<tr><th>Юборган доктор</th><th class="r">Бемор</th><th class="r">Сумма</th></tr>' +
          r.referrers.map(d => `<tr><td class="strong">${esc(d.name)}</td><td class="r">${d.count}</td><td class="r">${money(d.sum)}</td></tr>`).join('')
        : empty('Маълумот йўқ')}</table></div></div>
    </div>

    <div class="two">
      <div class="card"><h3>Кунлар бўйича касса тушуми</h3>${bars(c.byDay, true)}</div>
      <div class="card"><h3>Ётоқхона — ҳозир</h3>
        <div class="totals plain">
          <div class="tot"><span>Ётган беморлар</span><b>${ip.count}</b></div>
          <div class="tot"><span>Жорий ҳисоб (ҳали ёпилмаган)</span><b>${money(ip.total)}</b></div>
          <div class="tot"><span>Олдиндан тўланган</span><b>${money(ip.paid)}</b></div>
          <div class="tot ${ip.balance > 0 ? 'due' : 'ok'}"><span>Тўланмаган қолдиқ</span><b>${money(Math.max(0, ip.balance))}</b></div>
        </div>
        <p class="muted note">Ётоқхона ҳисоби бўлимлар жадвалига бемор кетган куни қўшилади. Бекор қилинган ёзувлар: ${r.cancelled}.</p>
      </div>
    </div>`;
}


/* ================= ЧЕКЛАР ================= */
function doPrint(mode) {
  const w = (S.cfg && S.cfg.receiptWidth) || 80;
  $('#pageStyle').textContent = mode === 'report'
    ? '@page { size: A4; margin: 12mm; }'
    : '@page { size: ' + w + 'mm auto; margin: 0; }';
  document.body.dataset.print = mode;
  setTimeout(() => window.print(), 80);
}


function rcWrap(inner) {
  const c = S.cfg;
  $('#receipt').innerHTML = `<div class="rc" style="width:${c.receiptWidth || 80}mm">
    <div class="c b big">${esc(c.clinic)}</div>
    ${c.address ? `<div class="c">${esc(c.address)}</div>` : ''}
    ${c.phone ? `<div class="c">${esc(c.phone)}</div>` : ''}
    <div class="line"></div>${inner}
    <div class="line"></div>
    <div class="c small">Оператор: ${esc(S.user.name)}</div>
    <div class="c small">Саломат бўлинг!</div>
  </div>`;
  doPrint('receipt');
}


function printVisit(r, deptName) {
  const items = Array.isArray(r.items) && r.items.length
    ? r.items.map(i => `<tr><td>${esc(i.name)}${Number(i.qty) > 1 ? ' ×' + i.qty : ''}</td>
        <td class="r">${money((Number(i.price) || 0) * (Number(i.qty) || 1))}</td></tr>`).join('')
    : `<tr><td colspan="2">${esc(r['Хизматлар'])}</td></tr>`;
  const debt = Number(r['Қарз']) || 0;
  rcWrap(`
    <div class="c b">${esc(r.dept || deptName)}</div>
    <div class="c">НАВБАТ №</div>
    <div class="c q">${esc(r['Навбат №'])}</div>
    <div class="line"></div>
    <div>Сана: ${esc(showDate(r['Сана']))} ${esc(r['Вақт'])}</div>
    <div>Бемор: ${esc(r['Ф.И.Ш'])}</div>
    ${r['Доктор'] ? `<div>Доктор: ${esc(r['Доктор'])}</div>` : ''}
    <div class="line"></div>
    <table>${items}</table>
    <div class="line"></div>
    <table>
      <tr class="b"><td>ЖАМИ:</td><td class="r">${money(r['Сумма'])} сўм</td></tr>
      <tr><td>Тўланди${r['Тўлов тури'] ? ' (' + esc(r['Тўлов тури']) + ')' : ''}:</td><td class="r">${money(paidOf(r))}</td></tr>
      ${debt > 0 ? `<tr class="b"><td>ҚАРЗ:</td><td class="r">${money(debt)} сўм</td></tr>` : ''}
    </table>
    ${r['Ҳолат'] === 'Бекор' ? '<div class="c b">*** БЕКОР ҚИЛИНГАН ***</div>' : ''}`);
}


function printPay(p) {
  rcWrap(`
    <div class="c b">${esc(p.title)}</div>
    <div class="c">${esc(p.dept)}</div>
    <div class="line"></div>
    <div>Сана: ${showDate(today())} ${nowTime()}</div>
    <div>Бемор: ${esc(p.fio)}</div>
    <div class="line"></div>
    <table>
      <tr class="b"><td>ТЎЛАНДИ:</td><td class="r">${money(p.amount)} сўм</td></tr>
      <tr><td>Тўлов тури:</td><td class="r">${esc(p.payment)}</td></tr>
    </table>
    ${p.note ? `<div class="line"></div><div>${esc(p.note)}</div>` : ''}`);
}


function printStay(v) {
  const s = v.stay, c = v.calc;
  const byDay = {};
  v.charges.forEach(x => { (byDay[x['Сана']] = byDay[x['Сана']] || []).push(x); });
  const lines = Object.keys(byDay).sort().map(d =>
    `<tr><td colspan="2" class="b">${showDate(d)}</td></tr>` +
    byDay[d].map(x => `<tr><td>${esc(x['Хизмат'])}${Number(x['Сони']) > 1 ? ' ×' + esc(x['Сони']) : ''}</td><td class="r">${money(x['Сумма'])}</td></tr>`).join('')).join('');
  const bal = c.balance;
  rcWrap(`
    <div class="c b">ЁТОҚХОНА — ҲИСОБ</div>
    <div class="c">№ ${esc(s['Навбат №'])}</div>
    <div class="line"></div>
    <div>Бемор: ${esc(s['Ф.И.Ш'])}</div>
    ${s['Ётоқ тури'] ? `<div>Хона: ${esc(s['Ётоқ тури'])}</div>` : ''}
    <div>Келди: ${showDate(s['Келган сана'])} ${esc(s['Келган соат'] || '')}</div>
    <div>${s['Кетган сана'] ? 'Кетди: ' + showDate(s['Кетган сана']) : 'Ҳисоб санаси: ' + showDate(today())}</div>
    <div class="line"></div>
    <table>
      <tr><td>Ётоқ: ${c.days} кун × ${money(c.rate)}</td><td class="r">${money(c.bed)}</td></tr>
      ${lines}
    </table>
    <div class="line"></div>
    <table>
      <tr class="b"><td>ЖАМИ:</td><td class="r">${money(c.total)} сўм</td></tr>
      <tr><td>Тўланган:</td><td class="r">${money(c.paid)}</td></tr>
      ${bal > 0 ? `<tr class="b"><td>${c.active ? 'ҚОЛДИҚ' : 'ҚАРЗ'}:</td><td class="r">${money(bal)} сўм</td></tr>` : ''}
      ${bal < 0 ? `<tr class="b"><td>ОРТИҚЧА:</td><td class="r">${money(-bal)} сўм</td></tr>` : ''}
    </table>`);
}


initLogin();
