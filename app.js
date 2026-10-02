'use strict';

/* ==========================================================
   Apps Script'ни Web app қилиб жойлагандан кейин берилган
   URL'ни шу ерга қўйинг (ёки кириш саҳифасида киритинг):
   ========================================================== */
const DEFAULT_API_URL = '';

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

const S = { pin: null, user: null, cfg: null, dept: null, list: [], listDept: null };

const pad = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoDate(new Date());
const showDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s).split('-').reverse().join('.') : (s || '');
const money = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const num = v => Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = a => Array.from(new Set(a));

function apiUrl() { return DEFAULT_API_URL || store.get('apiUrl') || ''; }

async function api(action, payload) {
  const url = apiUrl();
  if (!url) throw new Error('API манзили киритилмаган');
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
  try { j = await res.json(); } catch (e) { throw new Error('Сервер жавоби нотўғри (API манзилини текширинг)'); }
  if (!j.ok) throw new Error(j.error || 'Хатолик');
  return j;
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
  if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'Кутинг...'; }
  else if (btn.dataset.t) btn.textContent = btn.dataset.t;
}

const deptBy = key => S.cfg.depts.find(d => d.key === key);

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
  if (saved && apiUrl()) { S.pin = saved; login(true); }
}

function doLogin() {
  const u = $('#apiUrl').value.trim();
  if (u) store.set('apiUrl', u);
  S.pin = $('#pin').value.trim();
  if (!S.pin) { $('#loginErr').textContent = 'PIN киритинг'; return; }
  login(false);
}

async function login(silent) {
  const b = $('#loginBtn');
  busy(b, true);
  $('#loginErr').textContent = '';
  try {
    const j = await api('login');
    S.user = j.user;
    S.cfg = j.config;
    sess.set('pin', S.pin);
    startApp();
  } catch (e) {
    sess.del('pin');
    if (!silent) $('#loginErr').textContent = e.message;
  } finally {
    busy(b, false);
  }
}

/* ---------- Илова ---------- */
function startApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#brand').textContent = S.cfg.clinic;
  document.title = S.cfg.clinic;
  $('#userName').textContent = S.user.name + ' · ' + S.user.role;
  $$('.admin-only').forEach(x => x.classList.toggle('hidden', S.user.role !== 'админ'));
  $('#pageStyle').textContent = '@page { size: ' + (S.cfg.receiptWidth || 80) + 'mm auto; margin: 0; }';

  $('#deptGrid').innerHTML = S.cfg.depts
    .map(d => `<button type="button" class="dept" data-key="${d.key}">${esc(d.name)}</button>`).join('');
  $$('#deptGrid .dept').forEach(b => { b.onclick = () => openForm(b.dataset.key); });

  $('#lDept').innerHTML = S.cfg.depts.map(d => `<option value="${d.key}">${esc(d.name)}</option>`).join('');
  $('#lDate').value = today();
  $('#docList').innerHTML = uniq(S.cfg.doctors.map(d => d.name)).map(n => `<option value="${esc(n)}">`).join('');
  $('#qForm').payment.innerHTML = S.cfg.payments.map(p => `<option>${esc(p)}</option>`).join('');

  $$('.tab').forEach(t => { t.onclick = () => showView(t.dataset.view); });
  $('#logout').onclick = () => { sess.del('pin'); location.reload(); };

  bindForm();
  bindList();
  bindPanel();
  setRange('today');
  showView('qabul');
}

function showView(v) {
  $$('.view').forEach(s => s.classList.toggle('hidden', s.id !== 'v-' + v));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  if (v === 'royxat') loadList();
  if (v === 'panel') loadReport();
}

/* ---------- Қабул формаси ---------- */
function svcRow(name, price, custom) {
  const nameHtml = custom
    ? '<input class="s-name" placeholder="Хизмат номи">'
    : `<span class="s-name">${esc(name)}</span>`;
  return `<div class="svc${custom ? ' custom on' : ''}">
    <label class="chk"><input type="checkbox" class="s-on"${custom ? ' checked' : ''}> ${nameHtml}</label>
    <input class="s-qty" type="number" min="1" value="1" title="Сони">
    <input class="s-price" inputmode="numeric" value="${price ? money(price) : ''}" placeholder="Нарх">
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
  $$('#svcBox .svc').forEach(r => r.classList.toggle('on', $('.s-on', r).checked));
  const total = collectItems().reduce((s, i) => s + i.price * i.qty, 0);
  $('#qForm').sum.value = money(total);
}

function openForm(key) {
  S.dept = deptBy(key);
  const f = $('#qForm');
  $$('#deptGrid .dept').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  f.reset();
  f.classList.remove('hidden');
  $('#fTitle').textContent = S.dept.name;

  const docs = S.cfg.doctors.filter(d => d.dept === S.dept.name);
  f.doctor.innerHTML = '<option value="">—</option>' +
    docs.map(d => `<option value="${esc(d.name)}">${esc(d.name)}${d.share ? ' (' + d.share + '%)' : ''}</option>`).join('');
  if (docs.length === 1) f.doctor.value = docs[0].name;

  $('#extraBox').innerHTML = S.dept.extra.map(x => {
    const type = x.t === 'date' ? 'date' : x.t === 'time' ? 'time' : 'text';
    return `<label>${esc(x.h)}<input data-extra="${esc(x.h)}" type="${type}"></label>`;
  }).join('');
  $$('#extraBox [data-extra]').forEach(inp => {
    const now = new Date();
    if (inp.dataset.extra === 'Келган сана') inp.value = today();
    if (inp.dataset.extra === 'Келган соат') inp.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
  });

  const svcs = S.cfg.services.filter(s => s.dept === S.dept.name);
  $('#svcBox').innerHTML = svcs.map(s => svcRow(s.name, s.price, false)).join('') ||
    '<p class="muted">Бу бўлимга хизмат қўшилмаган. «+ Бошқа хизмат» тугмасини босинг ёки Sheets’даги «Хизматлар» варағига қўшинг.</p>';
  if (svcs.length === 1) $('#svcBox .s-on').checked = true;

  calcSum();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => f.fio.focus(), 300);
}

function bindForm() {
  const f = $('#qForm');
  const box = $('#svcBox');

  box.addEventListener('input', e => {
    const row = e.target.closest('.svc');
    if (row && (e.target.matches('.s-qty, .s-price, .s-name'))) $('.s-on', row).checked = true;
    if (e.target.matches('.s-price')) {
      const p = e.target.selectionStart, before = e.target.value.length;
      e.target.value = e.target.value ? money(num(e.target.value)) : '';
      const d = e.target.value.length - before;
      try { e.target.setSelectionRange(p + d, p + d); } catch (x) {}
    }
    calcSum();
  });
  box.addEventListener('change', calcSum);
  box.addEventListener('click', e => {
    if (e.target.matches('.x')) { e.target.closest('.svc').remove(); calcSum(); }
  });

  $('#addCustom').onclick = () => {
    const p = box.querySelector('p.muted');
    if (p) p.remove();
    box.insertAdjacentHTML('beforeend', svcRow('', 0, true));
    $('.svc:last-child .s-name', box).focus();
    calcSum();
  };

  f.sum.addEventListener('input', () => { f.sum.value = f.sum.value ? money(num(f.sum.value)) : ''; });

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

    const extra = {};
    $$('#extraBox [data-extra]').forEach(i => { extra[i.dataset.extra] = i.value; });

    const data = {
      fio: f.fio.value.trim(),
      year: f.year.value.trim(),
      phone: f.phone.value.trim(),
      doctor: f.doctor.value,
      referrer: f.referrer.value.trim(),
      payment: f.payment.value,
      sum: f.sum.value.trim() === '' ? '' : num(f.sum.value),
      note: f.note.value.trim(),
      items: items,
      extra: extra
    };

    const btn = f.querySelector('[type=submit]');
    busy(btn, true);
    try {
      const j = await api('add', { dept: S.dept.key, data: data });
      toast('Сақланди. Навбат № ' + j.record['Навбат №']);
      printReceipt(j.record, S.dept.name);
      openForm(S.dept.key);
    } catch (err) {
      toast(err.message, true);
    } finally {
      busy(btn, false);
    }
  });
}

/* ---------- Чек ---------- */
function printReceipt(r, deptName) {
  const c = S.cfg;
  const w = c.receiptWidth || 80;
  const items = Array.isArray(r.items) && r.items.length
    ? r.items.map(i => `<tr><td>${esc(i.name)}${Number(i.qty) > 1 ? ' ×' + i.qty : ''}</td>
        <td class="r">${money((Number(i.price) || 0) * (Number(i.qty) || 1))}</td></tr>`).join('')
    : `<tr><td colspan="2">${esc(r['Хизматлар'])}</td></tr>`;

  $('#receipt').innerHTML = `<div class="rc" style="width:${w}mm">
    <div class="c b big">${esc(c.clinic)}</div>
    ${c.address ? `<div class="c">${esc(c.address)}</div>` : ''}
    ${c.phone ? `<div class="c">${esc(c.phone)}</div>` : ''}
    <div class="line"></div>
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
      <tr><td>Тўлов:</td><td class="r">${esc(r['Тўлов тури'])}</td></tr>
    </table>
    ${r['Ҳолат'] === 'Бекор' ? '<div class="c b">*** БЕКОР ҚИЛИНГАН ***</div>' : ''}
    <div class="line"></div>
    <div class="c small">Оператор: ${esc(r['Оператор'])}</div>
    <div class="c small">Саломат бўлинг!</div>
  </div>`;
  setTimeout(() => window.print(), 80);
}

/* ---------- Рўйхат ---------- */
function bindList() {
  $('#lLoad').onclick = loadList;
  $('#lDept').onchange = loadList;
  $('#lDate').onchange = loadList;
  $('#lActive').onchange = loadList;

  $('#lTable').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const r = S.list.find(x => String(x['ID']) === b.dataset.id);
    if (!r) return;
    const d = S.listDept;

    if (b.dataset.act === 'print') { printReceipt(r, d.name); return; }

    if (b.dataset.act === 'cancel') {
      const reason = prompt('Бекор қилиш сабаби (' + r['Ф.И.Ш'] + '):');
      if (reason === null) return;
      busy(b, true);
      try { await api('cancel', { dept: d.key, id: r['ID'], reason: reason }); toast('Бекор қилинди'); loadList(); }
      catch (err) { toast(err.message, true); busy(b, false); }
    }

    if (b.dataset.act === 'close') {
      const field = b.dataset.field;
      if (!confirm(r['Ф.И.Ш'] + ' — ' + field + ': ' + showDate(today()) + '?')) return;
      busy(b, true);
      try { await api('setField', { dept: d.key, id: r['ID'], field: field, value: today() }); toast('Сақланди'); loadList(); }
      catch (err) { toast(err.message, true); busy(b, false); }
    }
  });
}

async function loadList() {
  const key = $('#lDept').value;
  const d = deptBy(key);
  const isY = key === 'yotoq';
  $('#lActiveWrap').classList.toggle('hidden', !isY);
  const active = isY && $('#lActive').checked;
  $('#lDate').disabled = active;
  $('#lSummary').textContent = '';
  $('#lTable').innerHTML = '<tr><td class="muted">Юкланмоқда...</td></tr>';
  try {
    const j = await api('list', { dept: key, date: $('#lDate').value || today(), active: active });
    S.list = j.rows;
    S.listDept = d;
    renderList(d, j.rows);
  } catch (e) {
    $('#lTable').innerHTML = `<tr><td class="err">${esc(e.message)}</td></tr>`;
  }
}

function renderList(d, rows) {
  const ok = rows.filter(r => r['Ҳолат'] !== 'Бекор');
  const sum = ok.reduce((s, r) => s + (Number(r['Сумма']) || 0), 0);
  const byPay = {};
  ok.forEach(r => { const k = r['Тўлов тури'] || '—'; byPay[k] = (byPay[k] || 0) + (Number(r['Сумма']) || 0); });
  const cancelled = rows.length - ok.length;
  $('#lSummary').innerHTML = `<b>${esc(d.name)}</b>: ${ok.length} та · жами <b>${money(sum)}</b> сўм` +
    Object.keys(byPay).map(k => ` · ${esc(k)}: ${money(byPay[k])}`).join('') +
    (cancelled ? ` · бекор: ${cancelled}` : '');

  if (!rows.length) { $('#lTable').innerHTML = '<tr><td class="muted">Ёзувлар йўқ</td></tr>'; return; }

  const closeField = d.key === 'yotoq' ? 'Кетган сана' : d.key === 'oper' ? 'Чиққан сана' : null;
  const closeLabel = d.key === 'yotoq' ? 'Кетди' : 'Чиқди';
  const ex = d.extra.map(x => x.h);

  const head = `<tr><th>№</th><th>Сана</th><th>Вақт</th><th>Ф.И.Ш</th><th>Йил</th><th>Телефон</th><th>Хизматлар</th>
    <th class="r">Сумма</th><th>Тўлов</th><th>Доктор</th><th>Юборган</th>${ex.map(h => `<th>${esc(h)}</th>`).join('')}
    <th>Ҳолат</th><th></th></tr>`;

  const body = rows.map(r => {
    const off = r['Ҳолат'] === 'Бекор';
    const id = esc(r['ID']);
    const acts = `<button class="btn sm" data-act="print" data-id="${id}">Чек</button>` +
      (!off ? `<button class="btn sm danger" data-act="cancel" data-id="${id}">Бекор</button>` : '') +
      (!off && closeField && !r[closeField] ? `<button class="btn sm" data-act="close" data-field="${esc(closeField)}" data-id="${id}">${closeLabel}</button>` : '');
    return `<tr class="${off ? 'cancelled' : ''}">
      <td><b>${esc(r['Навбат №'])}</b></td><td>${esc(showDate(r['Сана']))}</td><td>${esc(r['Вақт'])}</td>
      <td>${esc(r['Ф.И.Ш'])}</td><td>${esc(r['Туғилган йил'])}</td><td>${esc(r['Телефон'])}</td>
      <td class="wrap">${esc(r['Хизматлар'])}</td><td class="r">${money(r['Сумма'])}</td>
      <td>${esc(r['Тўлов тури'])}</td><td>${esc(r['Доктор'])}</td><td>${esc(r['Юборган доктор'])}</td>
      ${ex.map(h => { const x = d.extra.find(e => e.h === h); return `<td>${esc(x.t === 'date' ? showDate(r[h]) : r[h])}</td>`; }).join('')}
      <td><span class="badge${off ? ' off' : ''}">${esc(r['Ҳолат'])}</span></td>
      <td class="act">${acts}</td></tr>`;
  }).join('');

  $('#lTable').innerHTML = head + body;
}

/* ---------- Бошқарув панели ---------- */
function setRange(k) {
  const d = new Date();
  let f, t;
  if (k === 'today') { f = t = today(); }
  else if (k === 'yesterday') { const y = new Date(d); y.setDate(d.getDate() - 1); f = t = isoDate(y); }
  else if (k === 'month') { f = isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); t = today(); }
  else if (k === 'lastmonth') { f = isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)); t = isoDate(new Date(d.getFullYear(), d.getMonth(), 0)); }
  $('#pFrom').value = f;
  $('#pTo').value = t;
}

function bindPanel() {
  $$('.range').forEach(b => { b.onclick = () => { setRange(b.dataset.range); loadReport(); }; });
  $('#pLoad').onclick = loadReport;
}

async function loadReport() {
  if (!S.user || S.user.role !== 'админ') return;
  $('#pCards').innerHTML = '<div class="muted">Юкланмоқда...</div>';
  ['#pDepts', '#pDocs', '#pRefs'].forEach(s => { $(s).innerHTML = ''; });
  $('#pDays').innerHTML = '';
  try {
    const j = await api('report', { from: $('#pFrom').value, to: $('#pTo').value });
    renderReport(j.report);
  } catch (e) {
    $('#pCards').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

function renderReport(r) {
  const share = r.depts.reduce((s, d) => s + d.share, 0);
  const stat = (k, v, main) => `<div class="stat${main ? ' main' : ''}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;

  $('#pCards').innerHTML =
    stat('Жами тушум, сўм', money(r.total), true) +
    stat('Қабуллар сони', r.count) +
    stat('Докторлар улуши', money(share)) +
    stat('Клиникада қолади', money(r.total - share)) +
    Object.keys(r.byPay).map(k => stat(k, money(r.byPay[k]))).join('') +
    stat('Бекор қилинган', r.cancelled);

  $('#pDepts').innerHTML = '<tr><th>Бўлим</th><th class="r">Сони</th><th class="r">Сумма</th><th class="r">Доктор улуши</th><th class="r">Қолдиқ</th></tr>' +
    r.depts.map(d => `<tr><td>${esc(d.name)}</td><td class="r">${d.count}</td><td class="r">${money(d.sum)}</td>
      <td class="r">${money(d.share)}</td><td class="r">${money(d.sum - d.share)}</td></tr>`).join('') +
    `<tr class="total"><td>Жами</td><td class="r">${r.count}</td><td class="r">${money(r.total)}</td>
      <td class="r">${money(share)}</td><td class="r">${money(r.total - share)}</td></tr>`;

  $('#pDocs').innerHTML = r.doctors.length
    ? '<tr><th>Доктор</th><th>Бўлим</th><th class="r">Сони</th><th class="r">Сумма</th><th class="r">Улуши</th></tr>' +
      r.doctors.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.dept)}</td><td class="r">${d.count}</td>
        <td class="r">${money(d.sum)}</td><td class="r"><b>${money(d.share)}</b></td></tr>`).join('')
    : '<tr><td class="muted">Маълумот йўқ</td></tr>';

  $('#pRefs').innerHTML = r.referrers.length
    ? '<tr><th>Юборган доктор</th><th class="r">Сони</th><th class="r">Сумма</th></tr>' +
      r.referrers.map(d => `<tr><td>${esc(d.name)}</td><td class="r">${d.count}</td><td class="r">${money(d.sum)}</td></tr>`).join('')
    : '<tr><td class="muted">Маълумот йўқ</td></tr>';

  const days = Object.keys(r.days).sort();
  const max = Math.max(1, ...days.map(k => r.days[k]));
  $('#pDays').innerHTML = days.length
    ? days.map(k => `<div class="bar-row"><span>${esc(showDate(k))}</span>
        <div class="bar" style="width:${(r.days[k] / max * 100).toFixed(1)}%"></div>
        <span class="r">${money(r.days[k])}</span></div>`).join('')
    : '<p class="muted">Маълумот йўқ</p>';
}

initLogin();
