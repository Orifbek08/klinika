/******************************************************
 *  КЛИНИКА — Google Sheets API (Apps Script)  v2
 *  1) Шу кодни Sheets → Extensions → Apps Script га қўйинг
 *  2) Deploy → Manage deployments → Edit → New version → Deploy
 *     (Execute as: Me, Who has access: Anyone)
 *  Варақлар ва янги устунлар биринчи сўровда ўзи яратилади.
 ******************************************************/

const TZ = 'Asia/Tashkent';
const SCHEMA = '2';
const YOTOQ = 'yotoq';
const S_PAY = 'Тўловлар';
const S_CHG = 'Ётоқ хизматлари';

// Бўлимлар. reset:true — навбат ҳар куни 1 дан бошланади.
const DEPTS = [
  { key: 'fizio', name: 'Физиотерапия',    reset: true,  extra: [] },
  { key: 'ekg',   name: 'ЭКГ',             reset: true,  extra: [] },
  { key: 'uzi',   name: 'УЗИ',             reset: true,  extra: [] },
  { key: 'gin',   name: 'Гинеколог',       reset: true,  extra: [] },
  { key: 'lor',   name: 'ЛОР',             reset: true,  extra: [] },
  { key: 'oper',  name: 'Операция',        reset: true,  extra: [
      { h: 'Туғилган сана',   t: 'date' },
      { h: 'Манзил',          t: 'text' },
      { h: 'Ташхис',          t: 'text' },
      { h: 'Келган сана',     t: 'date' },
      { h: 'Операция санаси', t: 'date' },
      { h: 'Чиққан сана',     t: 'date' } ] },
  { key: 'uro',   name: 'Уролог-андролог', reset: true,  extra: [] },
  { key: 'lab',   name: 'Лаборатория',     reset: true,  extra: [] },
  { key: YOTOQ,   name: 'Ётоқхона',        reset: false, extra: [
      { h: 'Келган сана', t: 'date' },
      { h: 'Келган соат', t: 'time' },
      { h: 'Кетган сана', t: 'date' },
      { h: 'Ётоқ тури',   t: 'text' },
      { h: 'Кунлик нарх', t: 'num' } ] }
];

const COMMON = ['ID', 'Сана', 'Вақт', 'Навбат №', 'Ф.И.Ш', 'Туғилган йил', 'Телефон',
  'Хизматлар', 'Сумма', 'Тўлов тури', 'Доктор', 'Доктор улуши', 'Юборган доктор',
  'Ҳолат', 'Оператор', 'Изоҳ', 'Тўланган', 'Қарз'];

const PAY_HEAD = ['ID', 'Сана', 'Вақт', 'Бўлим', 'Ёзув ID', 'Ф.И.Ш', 'Сумма', 'Тўлов тури', 'Тури', 'Ҳолат', 'Оператор'];
const CHG_HEAD = ['ID', 'Ётиш ID', 'Сана', 'Бўлим', 'Хизмат', 'Сони', 'Нарх', 'Сумма', 'Ҳолат', 'Оператор', 'Киритилди'];

const SEED_SERVICES = [
  ['Физиотерапия', 'Массаж', 60000],
  ['Физиотерапия', 'Парафин', 40000],
  ['Физиотерапия', 'ФТ (физиопроцедура)', 20000],
  ['Физиотерапия', 'Зулук (1 дона)', 35000],
  ['ЭКГ', 'ЭКГ', 40000],
  ['ЭКГ', 'Озон', 0],
  ['УЗИ', 'УЗИ (1 аъзо)', 50000],
  ['УЗИ', 'УЗИ (комплекс)', 100000],
  ['Гинеколог', 'Кўрик', 50000],
  ['ЛОР', 'Кўрик', 50000],
  ['Операция', 'Операция', 0],
  ['Уролог-андролог', 'Кўрик', 50000],
  ['Лаборатория', 'ОАК', 30000],
  ['Лаборатория', 'ОАМ', 30000],
  ['Лаборатория', 'Қанд', 30000],
  ['Лаборатория', 'Спермограмма', 100000],
  ['Ётоқхона', 'Оддий палата', 0],
  ['Ётоқхона', 'Люкс палата', 0]
];

const SEED_DOCTORS = [
  ['Физиотерапевт', 'Физиотерапия', 0],
  ['ЭКГ врачи', 'ЭКГ', 0],
  ['УЗИ врачи', 'УЗИ', 0],
  ['Гинеколог врач', 'Гинеколог', 50],
  ['ЛОР врач', 'ЛОР', 60],
  ['Жарроҳ', 'Операция', 0],
  ['Уролог врач', 'Уролог-андролог', 0],
  ['Лаборант', 'Лаборатория', 0]
];

/* ================= МЕНЮ ВА ЎРНАТИШ ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Клиника')
    .addItem('Ўрнатиш / янгилаш (варақлар)', 'setup')
    .addToUi();
}

function setup() {
  build_();
  try { PropertiesService.getScriptProperties().setProperty('schema', SCHEMA); } catch (e) {}
  try { SpreadsheetApp.getUi().alert('Тайёр! Варақлар яратилди / янгиланди.'); } catch (e) {}
}

// Биринчи сўровда варақлар ва янги устунларни ўзи яратади.
function migrate_() {
  let p = null;
  try { p = PropertiesService.getScriptProperties(); } catch (e) {}
  if (p && p.getProperty('schema') === SCHEMA) return;
  build_();
  if (p) p.setProperty('schema', SCHEMA);
}

function build_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);

  makeSheet_(ss, 'Созламалар', ['Калит', 'Қиймат'], [
    ['Клиника номи', 'Клиника'],
    ['Манзил', ''],
    ['Телефон', ''],
    ['Чек эни (мм)', '80'],
    ['Тўлов турлари', 'Нақд, Карта, Click/Payme']
  ], [2]);

  makeSheet_(ss, 'Фойдаланувчилар', ['Исм', 'PIN', 'Роль'], [
    ['Админ', '1234', 'админ'],
    ['Оператор', '1111', 'оператор']
  ], [2]);

  const svc = makeSheet_(ss, 'Хизматлар', ['Бўлим', 'Хизмат', 'Нарх'], SEED_SERVICES, []);
  // Эски вариантдан қолган вараққа палата турларини қўшиб қўяди
  const haveRoom = svc.getDataRange().getValues().some(r => String(r[0]).trim() === 'Ётоқхона' && String(r[1]).indexOf('палата') >= 0);
  if (!haveRoom) SEED_SERVICES.filter(r => r[0] === 'Ётоқхона').forEach(r => svc.appendRow(r));

  makeSheet_(ss, 'Докторлар', ['Исм', 'Бўлим', 'Улуш %'], SEED_DOCTORS, []);
  makeSheet_(ss, 'Навбат', ['Бўлим', 'Охирги рақам', 'Сана', 'Ҳар куни 1 дан'],
    DEPTS.map(d => [d.name, 0, '', d.reset ? 'ҲА' : 'ЙЎҚ']), [3]);

  DEPTS.forEach(d => {
    const head = headers_(d);
    const textCols = [];
    head.forEach((h, i) => {
      const ex = d.extra.find(x => x.h === h);
      if (['ID', 'Сана', 'Вақт', 'Туғилган йил', 'Телефон'].indexOf(h) >= 0 || (ex && ex.t !== 'num')) textCols.push(i + 1);
    });
    const sh = makeSheet_(ss, d.name, head, [], textCols);
    ensureCols_(sh, head);
  });

  ensureCols_(makeSheet_(ss, S_PAY, PAY_HEAD, [], [1, 2, 3, 5]), PAY_HEAD);
  ensureCols_(makeSheet_(ss, S_CHG, CHG_HEAD, [], [1, 2, 3, 11]), CHG_HEAD);

  ['Sheet1', 'Лист1', 'Varaq1', 'Лист 1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

function makeSheet_(ss, name, head, rows, textCols) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh; // мавжуд варақдаги маълумот ўзгармайди
  sh = ss.insertSheet(name);
  (textCols || []).forEach(c => sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'));
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#e6f4f1');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.autoResizeColumns(1, head.length);
  return sh;
}

// Мавжуд вараққа етишмаётган устунларни охирига қўшади.
function ensureCols_(sh, head) {
  const have = head_(sh);
  let c = have.length;
  head.forEach(h => {
    if (have.indexOf(h) >= 0) return;
    c++;
    sh.getRange(1, c, 1, 1).setValues([[h]]).setFontWeight('bold').setBackground('#e6f4f1');
  });
}

function headers_(d) { return COMMON.concat(d.extra.map(x => x.h)); }

/* ================= API ================= */

function doGet() {
  return json_({ ok: true, msg: 'Клиника API ишлаяпти', v: SCHEMA });
}

const MUTATING = ['add', 'cancel', 'setField', 'payDebt', 'stayAdmit', 'stayCharge',
  'stayChargeCancel', 'stayPay', 'stayEdit', 'stayDischarge'];

function doPost(e) {
  let lock = null;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    migrate_();
    const user = auth_(req.pin);
    if (!user) return json_({ ok: false, error: 'PIN нотўғри' });
    if (MUTATING.indexOf(req.action) >= 0) {
      lock = LockService.getScriptLock();
      lock.waitLock(25000);
    }
    return json_(Object.assign({ ok: true }, route_(req, user)));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) {} }
  }
}

function route_(req, user) {
  switch (req.action) {
    case 'login':            return { user: user, config: config_() };
    case 'add':              return { record: add_(req.dept, req.data || {}, user) };
    case 'list':             return { rows: list_(req.dept, req.date) };
    case 'cancel':           return { result: cancel_(req.dept, req.id, user, req.reason) };
    case 'setField':         return { result: setField_(req.dept, req.id, req.field, req.value) };
    case 'debts':            return debts_();
    case 'payDebt':          return { payment: payDebt_(req.dept, req.id, req.amount, req.payment, user) };
    case 'stays':            return stays_(req.mode);
    case 'stay':             return { detail: stayDetail_(req.id) };
    case 'stayAdmit':        return { detail: stayAdmit_(req.data || {}, user) };
    case 'stayCharge':       return { detail: stayCharge_(req.id, req.date, req.items, user) };
    case 'stayChargeCancel': return { detail: stayChargeCancel_(req.chargeId) };
    case 'stayPay':          return { detail: stayPay_(req.id, req.amount, req.payment, user) };
    case 'stayEdit':         return { detail: stayEdit_(req.id, req.data || {}) };
    case 'stayDischarge':    return { detail: stayDischarge_(req.id, req.data || {}, user) };
    case 'report':
      if (user.role !== 'админ') throw new Error('Фақат админ учун');
      return { report: report_(req.from, req.to) };
    default: throw new Error('Номаълум амал');
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================= ЁРДАМЧИЛАР ================= */

function sh_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" варағи топилмади. Sheets менюсидан «Клиника → Ўрнатиш»ни бажаринг.');
  return sh;
}

function dept_(key) {
  const d = DEPTS.find(x => x.key === key);
  if (!d) throw new Error('Бўлим топилмади');
  return d;
}

function n_(v) { return Number(v) || 0; }
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }
function today_() { return fmt_(new Date(), 'yyyy-MM-dd'); }
function stamp_(now) { return fmt_(now, 'yyMMddHHmmss'); }
function rnd_() { return String(Math.floor(Math.random() * 900) + 100); }

function rows_(name) { return sh_(name).getDataRange().getValues().slice(1); }

function head_(sh) {
  const c = sh.getLastColumn();
  if (c < 1) return [];
  return sh.getRange(1, 1, 1, c).getValues()[0].map(String);
}

function obj_(head, row) {
  const o = {};
  head.forEach((h, j) => {
    if (!h) return;
    let x = row[j];
    if (x instanceof Date) {
      x = (h === 'Вақт' || h === 'Келган соат') ? fmt_(x, 'HH:mm') : fmt_(x, 'yyyy-MM-dd');
    }
    o[h] = x;
  });
  return o;
}

// Варақни объектлар рўйхати қилиб ўқийди (_row — қатор рақами).
function readAll_(name) {
  const sh = sh_(name);
  const v = sh.getDataRange().getValues();
  const head = (v[0] || []).map(String);
  const rows = [];
  for (let i = 1; i < v.length; i++) {
    const o = obj_(head, v[i]);
    if (!o['ID']) continue;
    o._row = i + 1;
    rows.push(o);
  }
  return { sh: sh, head: head, rows: rows };
}

function strip_(o) {
  const c = {};
  Object.keys(o).forEach(k => { if (k !== '_row') c[k] = o[k]; });
  return c;
}

function appendObj_(sh, head, rec) {
  sh.appendRow(head.map(h => (rec[h] === undefined ? '' : rec[h])));
}

function setCells_(sh, head, row, obj) {
  Object.keys(obj).forEach(k => {
    const c = head.indexOf(k);
    if (c >= 0) sh.getRange(row, c + 1).setValue(obj[k]);
  });
}

function normDate_(v) { return v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v || '').trim(); }

function days_(a, b) {
  const pa = String(a || '').split('-').map(Number), pb = String(b || '').split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || !pa[0] || !pb[0]) return 1;
  const d = Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  return Math.max(1, d);
}

function auth_(pin) {
  if (!pin) return null;
  const v = sh_('Фойдаланувчилар').getDataRange().getDisplayValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][1]).trim() !== '' && String(v[i][1]).trim() === String(pin).trim()) {
      return { name: String(v[i][0]), role: String(v[i][2]).trim().toLowerCase() };
    }
  }
  return null;
}

function settings_() {
  const s = {};
  rows_('Созламалар').forEach(r => { if (r[0]) s[String(r[0]).trim()] = String(r[1]); });
  return s;
}

function config_() {
  const s = settings_();
  return {
    clinic: s['Клиника номи'] || 'Клиника',
    address: s['Манзил'] || '',
    phone: s['Телефон'] || '',
    receiptWidth: Number(s['Чек эни (мм)']) || 80,
    payments: (s['Тўлов турлари'] || 'Нақд, Карта').split(',').map(x => x.trim()).filter(String),
    depts: DEPTS.map(d => ({ key: d.key, name: d.name, extra: d.extra })),
    services: rows_('Хизматлар').filter(r => r[1]).map(r => ({ dept: String(r[0]).trim(), name: String(r[1]).trim(), price: Number(r[2]) || 0 })),
    doctors: rows_('Докторлар').filter(r => r[0]).map(r => ({ name: String(r[0]).trim(), dept: String(r[1]).trim(), share: Number(r[2]) || 0 }))
  };
}

function doctorShare_(name, deptName) {
  if (!name) return 0;
  const docs = rows_('Докторлар');
  const hit = docs.find(r => String(r[0]).trim() === name && String(r[1]).trim() === deptName)
           || docs.find(r => String(r[0]).trim() === name);
  return hit ? (Number(hit[2]) || 0) : 0;
}

/* ================= НАВБАТ ================= */

function nextNo_(d, date) {
  const sh = sh_('Навбат');
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim() === d.name) {
      const daily = String(v[i][3]).trim().toUpperCase() !== 'ЙЎҚ';
      let n = Number(v[i][1]) || 0;
      if (daily && normDate_(v[i][2]) !== date) n = 0;
      n++;
      sh.getRange(i + 1, 2, 1, 2).setValues([[n, date]]);
      return n;
    }
  }
  sh.appendRow([d.name, 1, date, d.reset ? 'ҲА' : 'ЙЎҚ']);
  return 1;
}

/* ================= ТЎЛОВЛАР ДАФТАРИ ================= */

function addPay_(deptName, recId, fio, amount, payType, kind, user, now) {
  amount = Math.round(n_(amount));
  if (!(amount > 0)) return null;
  const sh = sh_(S_PAY);
  const rec = {
    'ID': 'p-' + stamp_(now) + '-' + rnd_(),
    'Сана': fmt_(now, 'yyyy-MM-dd'),
    'Вақт': fmt_(now, 'HH:mm'),
    'Бўлим': deptName,
    'Ёзув ID': recId,
    'Ф.И.Ш': fio,
    'Сумма': amount,
    'Тўлов тури': payType || '',
    'Тури': kind,
    'Ҳолат': 'Фаол',
    'Оператор': user.name
  };
  appendObj_(sh, head_(sh), rec);
  return rec;
}

function cancelPays_(recId) {
  const t = readAll_(S_PAY);
  t.rows.forEach(p => {
    if (String(p['Ёзув ID']) === String(recId) && p['Ҳолат'] !== 'Бекор') {
      setCells_(t.sh, t.head, p._row, { 'Ҳолат': 'Бекор' });
    }
  });
}

/* ================= АМБУЛАТОР ҚАБУЛ ================= */

function add_(key, data, user) {
  const d = dept_(key);
  if (d.key === YOTOQ) throw new Error('Ётоқхона учун «Ётоқхона» бўлимидан фойдаланинг');
  const fio = String(data.fio || '').trim();
  if (!fio) throw new Error('Ф.И.Ш киритилмаган');
  const items = (data.items || []).filter(i => i && String(i.name || '').trim());
  if (!items.length) throw new Error('Хизмат танланмаган');

  const calc = items.reduce((s, i) => s + n_(i.price) * (n_(i.qty) || 1), 0);
  const blank = v => v === '' || v === null || v === undefined || isNaN(Number(v));
  const sum = Math.max(0, Math.round(blank(data.sum) ? calc : Number(data.sum)));
  const paid = Math.min(sum, Math.max(0, Math.round(blank(data.paid) ? sum : Number(data.paid))));
  const itemsText = items.map(i => String(i.name).trim() + ((n_(i.qty) || 1) > 1 ? ' ×' + i.qty : '')).join(', ');

  const now = new Date();
  const date = fmt_(now, 'yyyy-MM-dd');
  const no = nextNo_(d, date);
  const rec = {
    'ID': d.key + '-' + stamp_(now) + '-' + no,
    'Сана': date,
    'Вақт': fmt_(now, 'HH:mm'),
    'Навбат №': no,
    'Ф.И.Ш': fio,
    'Туғилган йил': String(data.year || ''),
    'Телефон': String(data.phone || ''),
    'Хизматлар': itemsText,
    'Сумма': sum,
    'Тўлов тури': paid > 0 ? (data.payment || '') : '',
    'Доктор': data.doctor || '',
    'Доктор улуши': Math.round(sum * doctorShare_(data.doctor, d.name) / 100),
    'Юборган доктор': data.referrer || '',
    'Ҳолат': 'Фаол',
    'Оператор': user.name,
    'Изоҳ': data.note || '',
    'Тўланган': paid,
    'Қарз': sum - paid
  };
  d.extra.forEach(f => { rec[f.h] = (data.extra || {})[f.h] || ''; });

  const sh = sh_(d.name);
  appendObj_(sh, head_(sh), rec);
  addPay_(d.name, rec['ID'], fio, paid, data.payment, 'Қабул', user, now);

  rec.items = items;
  rec.dept = d.name;
  return rec;
}

function list_(key, date) {
  const d = dept_(key);
  return readAll_(d.name).rows.filter(o => o['Сана'] === date).map(strip_).reverse();
}

function cancel_(key, id, user, reason) {
  const d = dept_(key);
  const t = readAll_(d.name);
  const row = t.rows.find(o => String(o['ID']) === String(id));
  if (!row) throw new Error('Ёзув топилмади');
  if (row['Ҳолат'] === 'Бекор') throw new Error('Аллақачон бекор қилинган');
  if (user.role !== 'админ' && row['Сана'] !== today_()) {
    throw new Error('Эски ёзувни фақат админ бекор қила олади');
  }
  const note = [row['Изоҳ'], 'Бекор: ' + user.name + (reason ? ' — ' + reason : '')]
    .filter(x => String(x || '').trim()).join(' | ');
  setCells_(t.sh, t.head, row._row, { 'Ҳолат': 'Бекор', 'Қарз': 0, 'Изоҳ': note });
  cancelPays_(id);
  return { id: id };
}

function setField_(key, id, field, value) {
  const d = dept_(key);
  const f = d.extra.find(x => x.h === field && x.t === 'date');
  if (!f || d.key === YOTOQ) throw new Error('Бу майдонни ўзгартириб бўлмайди');
  const t = readAll_(d.name);
  const row = t.rows.find(o => String(o['ID']) === String(id));
  if (!row) throw new Error('Ёзув топилмади');
  const o = {}; o[field] = String(value || '');
  setCells_(t.sh, t.head, row._row, o);
  return { id: id };
}

/* ================= ҚАРЗЛАР ================= */

function debts_() {
  const out = [];
  let total = 0;
  DEPTS.forEach(d => {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(d.name);
    if (!sh) return;
    readAll_(d.name).rows.forEach(o => {
      const debt = n_(o['Қарз']);
      if (o['Ҳолат'] === 'Бекор' || !(debt > 0)) return;
      if (d.key === YOTOQ && stayActive_(o)) return; // ётган бемор ҳали ҳисоб-китоб қилмаган
      total += debt;
      out.push({
        dept: d.key, deptName: d.name, id: o['ID'], no: o['Навбат №'],
        date: d.key === YOTOQ ? (o['Кетган сана'] || o['Сана']) : o['Сана'],
        fio: o['Ф.И.Ш'], year: o['Туғилган йил'], phone: o['Телефон'],
        items: o['Хизматлар'], sum: n_(o['Сумма']), paid: n_(o['Тўланган']), debt: debt
      });
    });
  });
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows: out, total: total };
}

function payDebt_(key, id, amount, payType, user) {
  const d = dept_(key);
  const t = readAll_(d.name);
  const row = t.rows.find(o => String(o['ID']) === String(id));
  if (!row) throw new Error('Ёзув топилмади');
  if (row['Ҳолат'] === 'Бекор') throw new Error('Ёзув бекор қилинган');
  if (d.key === YOTOQ && stayActive_(row)) throw new Error('Бемор ҳали ётибди — тўловни «Ётоқхона» бўлимидан киритинг');
  const debt = n_(row['Қарз']);
  amount = Math.round(n_(amount));
  if (!(amount > 0)) throw new Error('Сумма киритилмаган');
  if (amount > debt) throw new Error('Сумма қарздан катта (қарз: ' + debt + ')');
  const paid = n_(row['Тўланган']) + amount;
  setCells_(t.sh, t.head, row._row, { 'Тўланган': paid, 'Қарз': debt - amount });
  const p = addPay_(d.name, id, row['Ф.И.Ш'], amount, payType, 'Қарз тўлови', user, new Date());
  return { pay: p, dept: d.name, fio: row['Ф.И.Ш'], sum: n_(row['Сумма']), paid: paid, left: debt - amount };
}

/* ================= ЁТОҚХОНА ================= */

function stayActive_(o) {
  return o['Ҳолат'] !== 'Бекор' && o['Ҳолат'] !== 'Кетди' && !o['Кетган сана'];
}

function stayCtx_() {
  const t = readAll_('Ётоқхона');
  const chBy = {}, pyBy = {};
  readAll_(S_CHG).rows.forEach(c => {
    if (c['Ҳолат'] === 'Бекор') return;
    (chBy[c['Ётиш ID']] = chBy[c['Ётиш ID']] || []).push(strip_(c));
  });
  readAll_(S_PAY).rows.forEach(p => {
    if (p['Ҳолат'] === 'Бекор' || p['Бўлим'] !== 'Ётоқхона') return;
    (pyBy[p['Ёзув ID']] = pyBy[p['Ёзув ID']] || []).push(strip_(p));
  });
  return { t: t, chBy: chBy, pyBy: pyBy };
}

function stayView_(o, ctx, withLines) {
  const ch = ctx.chBy[o['ID']] || [], py = ctx.pyBy[o['ID']] || [];
  const active = stayActive_(o);
  const arrive = o['Келган сана'] || o['Сана'];
  const days = days_(arrive, o['Кетган сана'] || today_());
  const rate = n_(o['Кунлик нарх']);
  const bed = days * rate;
  const svc = ch.reduce((s, c) => s + n_(c['Сумма']), 0);
  const paid = py.reduce((s, p) => s + n_(p['Сумма']), 0);
  const total = bed + svc;
  const v = {
    stay: strip_(o),
    calc: { active: active, days: days, rate: rate, bed: bed, svc: svc, total: total, paid: paid, balance: total - paid }
  };
  if (withLines) {
    v.charges = ch.slice().sort((a, b) => String(a['Сана']).localeCompare(String(b['Сана'])));
    v.payments = py;
  }
  return v;
}

function stayRow_(ctx, id) {
  const o = ctx.t.rows.find(r => String(r['ID']) === String(id));
  if (!o) throw new Error('Бемор топилмади');
  return o;
}

function stayDetail_(id) {
  const ctx = stayCtx_();
  return stayView_(stayRow_(ctx, id), ctx, true);
}

// Ҳисобни қайта ҳисоблаб, вараққа ёзади.
function staySync_(id) {
  const ctx = stayCtx_();
  const o = stayRow_(ctx, id);
  const v = stayView_(o, ctx, true);
  const names = [];
  v.charges.forEach(c => { if (names.indexOf(c['Хизмат']) < 0) names.push(c['Хизмат']); });
  const upd = {
    'Сумма': v.calc.total,
    'Тўланган': v.calc.paid,
    'Қарз': Math.max(0, v.calc.balance),
    'Хизматлар': ['Ётоқ ' + v.calc.days + ' кун'].concat(names.slice(0, 8)).join(', ')
  };
  setCells_(ctx.t.sh, ctx.t.head, o._row, upd);
  Object.assign(v.stay, upd);
  return v;
}

function stays_(mode) {
  const ctx = stayCtx_();
  const rows = [];
  const stats = { count: 0, total: 0, paid: 0, balance: 0 };
  ctx.t.rows.forEach(o => {
    if (o['Ҳолат'] === 'Бекор') return;
    const act = stayActive_(o);
    if ((mode === 'done') === act) return;
    const v = stayView_(o, ctx, false);
    rows.push(v);
    stats.count++; stats.total += v.calc.total; stats.paid += v.calc.paid; stats.balance += v.calc.balance;
  });
  if (mode === 'done') {
    rows.sort((a, b) => String(b.stay['Кетган сана']).localeCompare(String(a.stay['Кетган сана'])));
    return { rows: rows.slice(0, 100), stats: stats };
  }
  rows.sort((a, b) => String(a.stay['Келган сана']).localeCompare(String(b.stay['Келган сана'])));
  return { rows: rows, stats: stats };
}

function stayAdmit_(data, user) {
  const d = dept_(YOTOQ);
  const fio = String(data.fio || '').trim();
  if (!fio) throw new Error('Ф.И.Ш киритилмаган');
  const now = new Date();
  const date = fmt_(now, 'yyyy-MM-dd');
  const no = nextNo_(d, date);
  const id = d.key + '-' + stamp_(now) + '-' + no;
  const rec = {
    'ID': id, 'Сана': date, 'Вақт': fmt_(now, 'HH:mm'), 'Навбат №': no,
    'Ф.И.Ш': fio, 'Туғилган йил': String(data.year || ''), 'Телефон': String(data.phone || ''),
    'Хизматлар': '', 'Сумма': 0, 'Тўлов тури': '',
    'Доктор': data.doctor || '', 'Доктор улуши': 0, 'Юборган доктор': data.referrer || '',
    'Ҳолат': 'Ётибди', 'Оператор': user.name, 'Изоҳ': data.note || '',
    'Тўланган': 0, 'Қарз': 0,
    'Келган сана': data.arrive || date, 'Келган соат': data.arriveTime || fmt_(now, 'HH:mm'),
    'Кетган сана': '', 'Ётоқ тури': data.room || '', 'Кунлик нарх': Math.max(0, Math.round(n_(data.rate)))
  };
  const sh = sh_(d.name);
  appendObj_(sh, head_(sh), rec);
  addPay_(d.name, id, fio, data.prepay, data.payment, 'Аванс', user, now);
  return staySync_(id);
}

function stayNeedActive_(id) {
  const o = stayRow_(stayCtx_(), id);
  if (!stayActive_(o)) throw new Error('Бемор аллақачон кетган ёки ёзув бекор қилинган');
  return o;
}

function stayCharge_(id, date, items, user) {
  const o = stayNeedActive_(id);
  items = (items || []).filter(i => i && String(i.name || '').trim());
  if (!items.length) throw new Error('Хизмат танланмаган');
  const now = new Date();
  const sh = sh_(S_CHG);
  const head = head_(sh);
  items.forEach((i, k) => {
    const qty = Math.max(1, Math.round(n_(i.qty)) || 1), price = Math.max(0, Math.round(n_(i.price)));
    appendObj_(sh, head, {
      'ID': 'c-' + stamp_(now) + '-' + k + rnd_(),
      'Ётиш ID': o['ID'],
      'Сана': date || fmt_(now, 'yyyy-MM-dd'),
      'Бўлим': i.dept || '',
      'Хизмат': String(i.name).trim(),
      'Сони': qty, 'Нарх': price, 'Сумма': qty * price,
      'Ҳолат': 'Фаол', 'Оператор': user.name,
      'Киритилди': fmt_(now, 'yyyy-MM-dd HH:mm')
    });
  });
  return staySync_(id);
}

function stayChargeCancel_(chargeId) {
  const t = readAll_(S_CHG);
  const c = t.rows.find(r => String(r['ID']) === String(chargeId));
  if (!c) throw new Error('Хизмат топилмади');
  stayNeedActive_(c['Ётиш ID']);
  setCells_(t.sh, t.head, c._row, { 'Ҳолат': 'Бекор' });
  return staySync_(c['Ётиш ID']);
}

function stayPay_(id, amount, payType, user) {
  const o = stayNeedActive_(id);
  if (!(Math.round(n_(amount)) > 0)) throw new Error('Сумма киритилмаган');
  addPay_('Ётоқхона', o['ID'], o['Ф.И.Ш'], amount, payType, 'Аванс', user, new Date());
  return staySync_(id);
}

function stayEdit_(id, data) {
  const ctx = stayCtx_();
  const o = stayRow_(ctx, id);
  if (!stayActive_(o)) throw new Error('Фақат ётган бемор маълумотини ўзгартириш мумкин');
  const upd = {};
  if (data.room !== undefined) upd['Ётоқ тури'] = String(data.room || '');
  if (data.rate !== undefined) upd['Кунлик нарх'] = Math.max(0, Math.round(n_(data.rate)));
  if (data.arrive) upd['Келган сана'] = String(data.arrive);
  if (data.note !== undefined) upd['Изоҳ'] = String(data.note || '');
  setCells_(ctx.t.sh, ctx.t.head, o._row, upd);
  return staySync_(id);
}

function stayDischarge_(id, data, user) {
  const ctx = stayCtx_();
  const o = stayRow_(ctx, id);
  if (!stayActive_(o)) throw new Error('Бемор аллақачон кетган');
  const leave = String(data.date || today_());
  if (leave < String(o['Келган сана'] || '')) throw new Error('Кетган сана келган санадан олдин бўлиши мумкин эмас');
  const upd = { 'Кетган сана': leave, 'Ҳолат': 'Кетди' };
  if (Math.round(n_(data.amount)) > 0) upd['Тўлов тури'] = data.payment || '';
  setCells_(ctx.t.sh, ctx.t.head, o._row, upd);
  addPay_('Ётоқхона', o['ID'], o['Ф.И.Ш'], data.amount, data.payment, 'Ҳисоб-китоб', user, new Date());
  return staySync_(id);
}

/* ================= ҲИСОБОТ ================= */

function report_(from, to) {
  const today = today_();
  from = from || today;
  to = to || from;
  const inR = d => !!d && String(d) >= from && String(d) <= to;
  const res = {
    from: from, to: to,
    cash: { total: 0, count: 0, byPay: {}, byKind: {}, byDay: {} },
    billed: { total: 0, count: 0, debt: 0, share: 0 },
    debtNow: { total: 0, count: 0 },
    inpatients: { count: 0, total: 0, paid: 0, balance: 0 },
    cancelled: 0, depts: [], doctors: [], referrers: []
  };
  const cashDept = {};

  readAll_(S_PAY).rows.forEach(p => {
    if (p['Ҳолат'] === 'Бекор' || !inR(p['Сана'])) return;
    const s = n_(p['Сумма']);
    const pt = p['Тўлов тури'] || '—', kd = p['Тури'] || '—';
    res.cash.total += s; res.cash.count++;
    res.cash.byPay[pt] = (res.cash.byPay[pt] || 0) + s;
    res.cash.byKind[kd] = (res.cash.byKind[kd] || 0) + s;
    res.cash.byDay[p['Сана']] = (res.cash.byDay[p['Сана']] || 0) + s;
    cashDept[p['Бўлим']] = (cashDept[p['Бўлим']] || 0) + s;
  });

  const docs = {}, refs = {};
  DEPTS.forEach(d => {
    const r = { name: d.name, count: 0, sum: 0, cash: cashDept[d.name] || 0, debt: 0, share: 0 };
    const isY = d.key === YOTOQ;
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(d.name);
    if (sh) {
      readAll_(d.name).rows.forEach(o => {
        if (o['Ҳолат'] === 'Бекор') { if (inR(o['Сана'])) res.cancelled++; return; }
        if (isY && stayActive_(o)) return; // пастда алоҳида ҳисобланади
        const debt = n_(o['Қарз']);
        if (debt > 0) { res.debtNow.total += debt; res.debtNow.count++; }
        const dt = isY ? (o['Кетган сана'] || o['Сана']) : o['Сана'];
        if (!inR(dt)) return;
        const s = n_(o['Сумма']), share = n_(o['Доктор улуши']);
        r.count++; r.sum += s; r.debt += debt; r.share += share;
        if (o['Доктор']) {
          const k = o['Доктор'] + '|' + d.name;
          docs[k] = docs[k] || { name: o['Доктор'], dept: d.name, count: 0, sum: 0, share: 0 };
          docs[k].count++; docs[k].sum += s; docs[k].share += share;
        }
        if (o['Юборган доктор']) {
          const k = String(o['Юборган доктор']).trim();
          refs[k] = refs[k] || { name: k, count: 0, sum: 0 };
          refs[k].count++; refs[k].sum += s;
        }
      });
    }
    res.billed.total += r.sum; res.billed.count += r.count;
    res.billed.debt += r.debt; res.billed.share += r.share;
    res.depts.push(r);
  });

  const st = stays_('active').stats;
  res.inpatients = { count: st.count, total: st.total, paid: st.paid, balance: st.balance };
  res.doctors = Object.keys(docs).map(k => docs[k]).sort((a, b) => b.sum - a.sum);
  res.referrers = Object.keys(refs).map(k => refs[k]).sort((a, b) => b.sum - a.sum);
  return res;
}
