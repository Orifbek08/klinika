'use strict';

/* ==========================================================
   Apps Script Web app манзили
   ========================================================== */
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwSQwhY_I8zn6wVROIm-TaX6FCITGg1kG4ZGa4z0Ap0am-Ntktl5MF87083DBz5SXkH/exec';

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
const C = {}; // кеш: эски маълумот дарҳол кўрсатилади, янгиси орқа фонда келади
let pending = 0, started = false;
const S = { pin: null, user: null, cfg: null, dept: null, list: [], listDept: null,
  paidTouched: false, stayMode: 'active', stays: [], stay: null, debts: [], report: null };

const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoDate(new Date());
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const showDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).split('-').reverse().join('.') : (s || '');
const money = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
const num = v => Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = a => Array.from(new Set(a));
const daysBetween = (a, b) => {
  const pa = String(a || '').split('-').map(Number), pb = String(b || '').split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || !pa[0] || !pb[0]) return 1;
  return Math.max(1, Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000));
};

function apiUrl() { return DEFAULT_API_URL || store.get('apiUrl') || ''; }

async function api(action, payload) {
  const url = apiUrl();
  if (!url) throw new Error('API манзили киритилмаган');
  pending++;
  document.body.classList.add('syncing');
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, pin: S.pin }, payload || {}))
      });
    } catch (e) {
      throw new Error('Интернет ёки API билан алоқа йўқ');
    }
    let j;
    const raw = await res.text();
    try { j = JSON.parse(raw); } catch (e) {
      // Google хато саҳифасини қайтарди — ундаги матнни кўрсатамиз
      const el = document.createElement('div');
      el.innerHTML = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new Error('Apps Script хатоси: ' + (txt || 'бўш жавоб (HTTP ' + res.status + ')'));
    }
    if (!j.ok) throw new Error(j.error || 'Хатолик');
    return j;
  } finally {
    pending--;
    if (pending <= 0) { pending = 0; document.body.classList.remove('syncing'); }
  }
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 3500);
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
  S.stay = null;
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

  const saved = sess.get('pin');
  if (saved && apiUrl()) {
    S.pin = saved;
    // Саҳифа янгиланганда сақланган созлама билан дарҳол очилади, сервердан орқа фонда текширилади
    let boot = null;
    try { boot = JSON.parse(sess.get('boot') || 'null'); } catch (e) {}
    if (boot && boot.pin === saved && boot.user && boot.cfg) {
      S.user = boot.user; S.cfg = boot.cfg;
      if (enter()) { login(true, true); return; }
    }
    login(true);
  } else {
    $('#pin').focus();
  }
}

function doLogin() {
  const u = $('#apiUrl').value.trim();
  if (u) store.set('apiUrl', u);
  S.pin = $('#pin').value.trim();
  if (!S.pin) { $('#loginErr').textContent = 'PIN киритинг'; return; }
  login(false);
}

async function login(silent, background) {
  const b = $('#loginBtn');
  if (!background) busy(b, true);
  $('#loginErr').textContent = '';
  try {
    const j = await api('login');
    if (!j.user || !j.config || !Array.isArray(j.config.depts)) {
      throw new Error('Сервер жавоби тўлиқ эмас. Apps Script’га янги Code.gs қўйилиб, «New version» қилиб deploy қилинганини текширинг.');
    }
    S.user = j.user;
    S.cfg = j.config;
    sess.set('pin', S.pin);
    sess.set('boot', JSON.stringify({ pin: S.pin, user: S.user, cfg: S.cfg }));
    if (background) applyConfig(); else enter();
  } catch (e) {
    if (background) {
      if (/PIN/.test(e.message)) { sess.del('pin'); sess.del('boot'); location.reload(); }
      return;
    }
    sess.del('pin'); sess.del('boot');
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
    return true;
  } catch (e) {
    console.error(e);
    sess.del('boot');
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

  const cur = $('#lDept').value;
  $('#lDept').innerHTML = out.map(d => `<option value="${d.key}">${esc(d.name)}</option>`).join('');
  if (cur) $('#lDept').value = cur;
  $('#docList').innerHTML = uniq(S.cfg.doctors.map(d => d.name)).map(n => `<option value="${esc(n)}">`).join('');
  if (!$('#qPay').children.length) $('#qPay').innerHTML = segHtml(S.cfg.payments);
}

// Бир марта: тугмаларни боғлаш ва биринчи маълумотларни орқа фонда юклаш
function startApp() {
  $('#deptGrid').addEventListener('click', e => {
    const b = e.target.closest('.dept');
    if (!b) return;
    if (b.dataset.go) showView(b.dataset.go); else openForm(b.dataset.key);
  });
  $('#lDate').value = today();
  $$('.nav').forEach(t => { t.onclick = () => showView(t.dataset.view); });
  $('#logout').onclick = () => { sess.del('pin'); sess.del('boot'); location.reload(); };

  bindForm();
  bindList();
  bindYotoq();
  bindQarz();
  bindReport();
  setRange('today');
  showView('qabul');
  loadStays('active', true);
  loadDebts(true);
}

function showView(v) {
  $$('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'v-' + v));
  $$('.nav').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  window.scrollTo(0, 0);
  if (v === 'royxat') loadList();
  if (v === 'yotoq') loadStays();
  if (v === 'qarz') loadDebts();
  if (v === 'hisobot') loadReport();
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

  calcSum();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => f.fio.focus(), 250);
}

function bindForm() {
  const f = $('#qForm');
  const box = $('#svcBox');

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
      const j = await api('add', { dept: S.dept.key, data: data });
      toast('Сақланди. Навбат № ' + j.record['Навбат №']);
      printVisit(j.record, S.dept.name);
      const ck = 'list:' + S.dept.key + ':' + j.record['Сана'];
      if (C[ck]) C[ck].unshift(j.record);
      openForm(S.dept.key);
      if (j.record['Қарз'] > 0) loadDebts(true);
    } catch (err) {
      toast(err.message, true);
    } finally {
      busy(btn, false);
    }
  });
}

/* ================= РЎЙХАТ ================= */
function bindList() {
  $('#lLoad').onclick = loadList;
  $('#lDept').onchange = loadList;
  $('#lDate').onchange = loadList;

  $('#lTable').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const r = S.list.find(x => String(x['ID']) === b.dataset.id);
    if (!r) return;
    const d = S.listDept;

    if (b.dataset.act === 'print') { printVisit(r, d.name); return; }

    if (b.dataset.act === 'cancel') {
      const reason = prompt('Бекор қилиш сабаби (' + r['Ф.И.Ш'] + '):');
      if (reason === null) return;
      busy(b, true);
      try { await api('cancel', { dept: d.key, id: r['ID'], reason: reason }); toast('Бекор қилинди'); r['Ҳолат'] = 'Бекор'; r['Қарз'] = 0; renderList(d, S.list); loadList(); loadDebts(true); }
      catch (err) { toast(err.message, true); busy(b, false); }
    }

    if (b.dataset.act === 'close') {
      const field = b.dataset.field;
      if (!confirm(r['Ф.И.Ш'] + ' — ' + field + ': ' + showDate(today()) + '?')) return;
      busy(b, true);
      try { await api('setField', { dept: d.key, id: r['ID'], field: field, value: today() }); toast('Сақланди'); r[field] = today(); renderList(d, S.list); }
      catch (err) { toast(err.message, true); busy(b, false); }
    }
  });
}

async function loadList() {
  const key = $('#lDept').value;
  const d = deptBy(key);
  const date = $('#lDate').value || today();
  const ck = 'list:' + key + ':' + date;
  S.listKey = ck;
  if (C[ck]) { S.list = C[ck]; S.listDept = d; renderList(d, C[ck]); }
  else { $('#lStats').innerHTML = ''; $('#lTable').innerHTML = empty('Юкланмоқда…'); }
  try {
    const j = await api('list', { dept: key, date: date });
    C[ck] = j.rows;
    if (S.listKey !== ck) return;
    S.list = j.rows;
    S.listDept = d;
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
function bindYotoq() {
  $('#yMode').addEventListener('seg', e => { S.stayMode = e.detail; loadStays(); });
  $('#yLoad').onclick = () => loadStays();
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

// quiet = фақат орқа фонда янгилаш (экранни «Юкланмоқда»га ўтказмайди)
async function loadStays(mode, quiet) {
  mode = mode || S.stayMode;
  const ck = 'stays:' + mode;
  const shown = () => mode === S.stayMode;
  if (shown()) {
    if (C[ck]) renderStays(C[ck], mode);
    else if (!quiet) { $('#yGrid').innerHTML = '<p class="muted pad">Юкланмоқда…</p>'; $('#yStats').innerHTML = ''; }
  }
  try {
    const j = await api('stays', { mode: mode });
    C[ck] = j.rows;
    if (shown()) renderStays(j.rows, mode);
    else if (mode === 'active') setPill('#nYotoq', j.rows.length);
  } catch (e) {
    if (shown() && !C[ck] && !quiet) $('#yGrid').innerHTML = `<p class="err pad">${esc(e.message)}</p>`;
    else if (!quiet) toast(e.message, true);
  }
}

// Сервер жавобидаги беморни кешга қўйиб, рўйхатни дарҳол янгилайди
function patchStay(v) {
  const id = v.stay['ID'];
  const lite = { stay: v.stay, calc: v.calc };
  const gone = v.stay['Ҳолат'] === 'Бекор';
  ['active', 'done'].forEach(m => {
    const ck = 'stays:' + m;
    if (!C[ck]) return;
    C[ck] = C[ck].filter(x => x.stay['ID'] !== id);
    if (!gone && (m === 'active') === !!v.calc.active) {
      if (m === 'active') C[ck].push(lite); else C[ck].unshift(lite);
    }
  });
  if (C['stays:' + S.stayMode]) renderStays(C['stays:' + S.stayMode], S.stayMode);
  else if (C['stays:active']) setPill('#nYotoq', C['stays:active'].length);
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

async function openStay(id) {
  // Рўйхатдаги маълумот дарҳол кўрсатилади, муолажа ва тўловлар орқа фонда келади
  const lite = (S.stays || []).find(x => x.stay['ID'] === id);
  openSheet('<p class="muted pad">Юкланмоқда…</p>', 'drawer');
  if (lite) renderStay({ stay: lite.stay, calc: lite.calc, charges: [], payments: [], loading: true });
  try {
    const j = await api('stay', { id: id });
    if ($('#overlay').classList.contains('hidden') || (S.stay && S.stay.stay['ID'] !== id)) return;
    if (!S.stay || S.stay.loading) {
      const open = $('#sheet .panel:not(.hidden)');
      renderStay(j.detail, open ? open.dataset.panel : null);
    }
  } catch (e) {
    if (!lite) $('#sheet').innerHTML = `<p class="err pad">${esc(e.message)}</p>`; else toast(e.message, true);
  }
}

function svcOptions() {
  const by = {};
  S.cfg.services.forEach((s, i) => { if (s.dept !== YOTOQ_NAME) (by[s.dept] = by[s.dept] || []).push(i); });
  return '<option value="">Хизматни танланг…</option>' +
    Object.keys(by).map(d => `<optgroup label="${esc(d)}">` +
      by[d].map(i => `<option value="${i}">${esc(S.cfg.services[i].name)}${S.cfg.services[i].price ? ' — ' + money(S.cfg.services[i].price) : ''}</option>`).join('') +
      '</optgroup>').join('') + '<option value="custom">Бошқа хизмат…</option>';
}

function renderStay(v, keep) {
  S.stay = v;
  const s = v.stay, c = v.calc, act = c.active;
  const bal = c.balance;
  const balRow = bal > 0
    ? `<div class="tot due"><span>${act ? 'Тўланмаган қолдиқ' : 'Қарз'}</span><b>${money(bal)}</b></div>`
    : bal < 0 ? `<div class="tot ok"><span>Ортиқча тўланган</span><b>${money(-bal)}</b></div>`
    : '<div class="tot ok"><span>Қолдиқ</span><b>0</b></div>';

  // Муолажалар кунлар бўйича
  const byDay = {};
  v.charges.forEach(x => { (byDay[x['Сана']] = byDay[x['Сана']] || []).push(x); });
  const days = Object.keys(byDay).sort().reverse();
  const chargesHtml = days.length ? days.map(d => {
    const sub = byDay[d].reduce((a, x) => a + (Number(x['Сумма']) || 0), 0);
    return `<div class="day"><div class="day-head"><b>${showDate(d)}</b><span>${money(sub)}</span></div>` +
      byDay[d].map(x => `<div class="line">
        <span class="nm">${esc(x['Хизмат'])}${Number(x['Сони']) > 1 ? ' ×' + esc(x['Сони']) : ''}<small>${esc(x['Бўлим'] || '')}</small></span>
        <span class="am">${money(x['Сумма'])}</span>
        ${act ? `<button type="button" class="x" title="Олиб ташлаш" data-act="chargeDel" data-id="${esc(x['ID'])}">×</button>` : '<span></span>'}
      </div>`).join('') + '</div>';
  }).join('') : `<p class="muted note">${v.loading ? 'Юкланмоқда…' : 'Ҳали муолажа киритилмаган.'}</p>`;

  const paysHtml = v.payments.length ? v.payments.map(p => `<div class="line">
      <span class="nm">${showDate(p['Сана'])} ${esc(p['Вақт'])}<small>${esc(p['Тури'])} · ${esc(p['Тўлов тури'])}</small></span>
      <span class="am">${money(p['Сумма'])}</span><span></span></div>`).join('')
    : `<p class="muted note">${v.loading ? 'Юкланмоқда…' : 'Тўлов қилинмаган.'}</p>`;

  $('#sheet').innerHTML = `
    <div class="sheet-head">
      <div><span class="qno">№ ${esc(s['Навбат №'])}</span>
        <h3>${esc(s['Ф.И.Ш'])}</h3>
        <p class="muted">${[s['Туғилган йил'] ? s['Туғилган йил'] + ' й.' : '', s['Телефон']].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p></div>
      <div class="head-r"><span class="badge ${act ? '' : 'off'}">${act ? 'Ётибди' : 'Кетди'}</span>
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
    </div>

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
    <div class="lines">${chargesHtml}</div>
    <h4>Тўловлар</h4>
    <div class="lines">${paysHtml}</div>
    ${s['Изоҳ'] ? `<p class="muted note">Изоҳ: ${esc(s['Изоҳ'])}</p>` : ''}`;

  if (keep) togglePanel(keep, true);
  updateOutCalc(true);
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
  if (!f || !S.stay) return;
  const s = S.stay.stay, c = S.stay.calc;
  const days = daysBetween(s['Келган сана'], f.date.value || today());
  const total = days * c.rate + c.svc;
  const bal = total - c.paid;
  $('[data-role=outCalc]', f).innerHTML =
    `${days} кун · жами <b>${money(total)}</b> · тўланган ${money(c.paid)} · <b class="${bal > 0 ? 'neg' : 'pos'}">${bal >= 0 ? 'қолдиқ ' + money(bal) : 'ортиқча ' + money(-bal)}</b>`;
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

async function onSheetClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') return closeSheet();
  if (act === 'panel') return togglePanel(b.dataset.p);
  if (!S.stay) return;
  const id = S.stay.stay['ID'];

  if (act === 'statement') return printStay(S.stay);

  if (act === 'chargeDel') {
    if (!confirm('Бу муолажа ҳисобдан олиб ташлансинми?')) return;
    busy(b, true);
    try { const j = await api('stayChargeCancel', { chargeId: b.dataset.id }); renderStay(j.detail); patchStay(j.detail); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }

  if (act === 'stayCancel') {
    const reason = prompt('Ётоқ ёзувини бекор қилиш сабаби (тўловлари ҳам бекор бўлади):');
    if (reason === null) return;
    busy(b, true);
    try { await api('cancel', { dept: YOTOQ, id: id, reason: reason }); toast('Бекор қилинди'); const g = S.stay; g.stay['Ҳолат'] = 'Бекор'; patchStay(g); closeSheet(); loadDebts(true); }
    catch (err) { toast(err.message, true); busy(b, false); }
  }

  if (act === 'debt') {
    const st = S.stay;
    closeSheet();
    openDebtPay({ dept: YOTOQ, deptName: YOTOQ_NAME, id: id, fio: st.stay['Ф.И.Ш'], debt: st.calc.balance, sum: st.calc.total, paid: st.calc.paid });
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
      const j = await api('stayAdmit', { data: {
        fio: f.fio.value.trim(), year: f.year.value.trim(), phone: f.phone.value.trim(),
        room: f.room.value.trim(), rate: num(f.rate.value),
        arrive: f.arrive.value, arriveTime: f.arriveTime.value,
        doctor: f.doctor.value.trim(), referrer: f.referrer.value.trim(),
        prepay: prepay, payment: payment, note: f.note.value.trim() } });
      toast('Бемор қабул қилинди. № ' + j.detail.stay['Навбат №']);
      S.stayMode = 'active';
      $$('#yMode button').forEach(x => x.classList.toggle('on', x.dataset.v === 'active'));
      patchStay(j.detail);
      if (!C['stays:active']) loadStays('active');
      openSheet('', 'drawer');
      renderStay(j.detail);
      if (prepay > 0) printPay({ title: 'АВАНС ТЎЛОВИ', dept: YOTOQ_NAME, fio: j.detail.stay['Ф.И.Ш'], amount: prepay, payment: payment });
    } catch (err) { toast(err.message, true); busy(btn, false); }
    return;
  }

  if (f.id === 'debtForm') return submitDebt(f, btn);
  if (!S.stay) return;
  const id = S.stay.stay['ID'];
  const kind = f.dataset.panel;

  try {
    if (kind === 'charge') {
      const v = f.svc.value;
      const sv = S.cfg.services[v];
      const name = v === 'custom' ? f.custom.value.trim() : (sv ? sv.name : '');
      if (!name) { toast('Хизматни танланг', true); return; }
      busy(btn, true);
      const j = await api('stayCharge', { id: id, date: f.date.value || today(),
        items: [{ name: name, dept: sv ? sv.dept : '', qty: Math.max(1, parseInt(f.qty.value, 10) || 1), price: num(f.price.value) }] });
      toast('Муолажа қўшилди');
      const d = f.date.value;
      renderStay(j.detail);
      const nf = $('#sheet form[data-panel="charge"]');
      if (nf && d) nf.date.value = d;
      patchStay(j.detail);
    }
    if (kind === 'pay') {
      const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
      if (!(amount > 0)) { toast('Суммани киритинг', true); return; }
      busy(btn, true);
      const j = await api('stayPay', { id: id, amount: amount, payment: payment });
      toast('Тўлов қабул қилинди');
      renderStay(j.detail);
      patchStay(j.detail);
      printPay({ title: 'АВАНС ТЎЛОВИ', dept: YOTOQ_NAME, fio: j.detail.stay['Ф.И.Ш'], amount: amount, payment: payment,
        note: 'Жорий ҳисоб: ' + money(j.detail.calc.total) + ' · тўланган: ' + money(j.detail.calc.paid) });
    }
    if (kind === 'edit') {
      busy(btn, true);
      const j = await api('stayEdit', { id: id, data: { room: f.room.value.trim(), rate: num(f.rate.value), arrive: f.arrive.value } });
      toast('Сақланди');
      renderStay(j.detail);
      patchStay(j.detail);
    }
    if (kind === 'out') {
      const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
      const s = S.stay.stay, c = S.stay.calc;
      const bal = daysBetween(s['Келган сана'], f.date.value || today()) * c.rate + c.svc - c.paid;
      if (amount > Math.max(0, bal)) { toast('Сумма қолдиқдан катта', true); return; }
      const left = bal - amount;
      if (!confirm(s['Ф.И.Ш'] + ' чиқарилсинми?\nКетган сана: ' + showDate(f.date.value || today()) +
          '\nҲозир тўлайди: ' + money(amount) + ' сўм' + (left > 0 ? '\nҚарзга қолади: ' + money(left) + ' сўм' : ''))) return;
      busy(btn, true);
      const j = await api('stayDischarge', { id: id, data: { date: f.date.value || today(), amount: amount, payment: payment } });
      toast('Бемор чиқарилди');
      renderStay(j.detail);
      patchStay(j.detail);
      if (j.detail.calc.balance > 0) loadDebts(true);
      printStay(j.detail);
    }
  } catch (err) {
    toast(err.message, true);
    busy(btn, false);
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
  if (S.debtsLoaded) renderDebts();
  else if (!quiet) { $('#dTable').innerHTML = empty('Юкланмоқда…'); $('#dStats').innerHTML = ''; }
  try {
    const j = await api('debts');
    S.debts = j.rows;
    S.debtsLoaded = true;
    renderDebts();
  } catch (e) {
    if (quiet) return;
    if (S.debtsLoaded) toast(e.message, true);
    else $('#dTable').innerHTML = `<tr><td class="err">${esc(e.message)}</td></tr>`;
  }
}

function renderDebts() {
  const q = $('#dSearch').value.trim().toLowerCase();
  const rows = S.debts.filter(r => !q || String(r.fio).toLowerCase().includes(q) || String(r.phone).toLowerCase().includes(q));
  S.debtView = rows;
  setPill('#nQarz', S.debts.length);
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

async function submitDebt(f, btn) {
  const r = S.debtRow;
  const amount = num(f.amount.value), payment = segVal($('[data-role=pay]', f));
  if (!(amount > 0)) { toast('Суммани киритинг', true); return; }
  if (amount > r.debt) { toast('Сумма қарздан катта', true); return; }
  busy(btn, true);
  try {
    const j = await api('payDebt', { dept: r.dept, id: r.id, amount: amount, payment: payment });
    toast('Қарз тўлови қабул қилинди');
    closeSheet();
    // Жадвал дарҳол янгиланади, сервердан орқа фонда тасдиқланади
    r.paid += amount; r.debt -= amount;
    if (r.debt <= 0) S.debts = S.debts.filter(x => x !== r);
    renderDebts();
    Object.keys(C).forEach(k => { if (k.indexOf('list:') === 0 || k.indexOf('report:') === 0) delete C[k]; });
    loadDebts(true);
    if (r.dept === YOTOQ) loadStays('done', true);
    printPay({ title: 'ҚАРЗ ТЎЛОВИ', dept: r.deptName, fio: r.fio, amount: amount, payment: payment,
      note: j.payment.left > 0 ? 'Қолган қарз: ' + money(j.payment.left) + ' сўм' : 'Қарз тўлиқ ёпилди' });
  } catch (err) { toast(err.message, true); busy(btn, false); }
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

function bindReport() {
  $('#pRange').addEventListener('seg', e => { setRange(e.detail); loadReport(); });
  $('#pLoad').onclick = () => { $$('#pRange button').forEach(b => b.classList.remove('on')); loadReport(); };
  $('#pPrint').onclick = () => { if (S.report) doPrint('report'); };
}

async function loadReport() {
  if (!S.user || S.user.role !== 'админ') return;
  const from = $('#pFrom').value, to = $('#pTo').value;
  const ck = 'report:' + from + ':' + to;
  S.reportKey = ck;
  if (C[ck]) { S.report = C[ck]; renderReport(C[ck]); }
  else $('#pBody').innerHTML = '<p class="muted pad">Юкланмоқда…</p>';
  try {
    const j = await api('report', { from: from, to: to });
    C[ck] = j.report;
    if (S.reportKey !== ck) return;
    S.report = j.report;
    renderReport(j.report);
  } catch (e) {
    if (S.reportKey !== ck) return;
    if (C[ck]) toast(e.message, true);
    else $('#pBody').innerHTML = `<p class="err pad">${esc(e.message)}</p>`;
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
