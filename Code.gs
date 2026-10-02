/******************************************************
 *  КЛИНИКА — Google Sheets API (Apps Script)  v4
 *
 *  ЖОЙЛАШТИРИШ
 *  1) Sheets → Extensions → Apps Script. Лойиҳада ФАҚАТ БИТТА .gs файл
 *     бўлсин — ичидагини бутунлай ўчириб, шу кодни қўйинг → сақланг.
 *  2) Deploy → Manage deployments → ✏ → Version: New version → Deploy
 *     (Execute as: Me, Who has access: Anyone). Ҳавола ўзгармайди.
 *
 *  ТЕКШИРИШ: ҳаволани браузерда очинг — {"ok":true,...,"v":"7"} чиқади.
 *
 *  v4 — ТЕЗЛИК
 *   • Сайт битта сўров билан бугунги ҳамма маълумотни олади («sync»)
 *     ва кейин ўзида ишлайди; ёзишлар орқа фонда кетади.
 *   • Созлама, фойдаланувчи ва устун номлари кешда туради.
 *   • Ётган беморнинг муолажа ва тўловлари ўз қаторида сақланади —
 *     ҳар амалда 2–3 та мурожаат етади, варақ тўлиқ ўқилмайди.
 ******************************************************/

const TZ = 'Asia/Tashkent';
const VERSION = '7';   // кўрсатиш учун (doGet)
const SCHEMA = '4';    // варақ тузилиши; фақат устун/варақ қўшилганда оширилади
const YOTOQ = 'yotoq';
const S_YOT = 'Ётоқхона';
const S_PAY = 'Тўловлар';
const S_CHG = 'Ётоқ хизматлари';
const JC = 'Муолажалар (маълумот)';
const JP = 'Тўловлар (маълумот)';

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
  { key: YOTOQ,   name: S_YOT,             reset: false, extra: [
      { h: 'Келган сана', t: 'date' },
      { h: 'Келган соат', t: 'time' },
      { h: 'Кетган сана', t: 'date' },
      { h: 'Ётоқ тури',   t: 'text' },
      { h: 'Кунлик нарх', t: 'num' },
      { h: 'Муолажалар суммаси', t: 'num' },
      { h: JC, t: 'json' },
      { h: JP, t: 'json' } ] }
];

const COMMON = ['ID', 'Сана', 'Вақт', 'Навбат №', 'Ф.И.Ш', 'Туғилган йил', 'Телефон',
  'Хизматлар', 'Сумма', 'Тўлов тури', 'Доктор', 'Доктор улуши', 'Юборган доктор',
  'Ҳолат', 'Оператор', 'Изоҳ', 'Тўланган', 'Қарз'];

const PAY_HEAD = ['ID', 'Сана', 'Вақт', 'Бўлим', 'Ёзув ID', 'Ф.И.Ш', 'Сумма', 'Тўлов тури', 'Тури', 'Ҳолат', 'Оператор'];
const CHG_HEAD = ['ID', 'Ётиш ID', 'Сана', 'Бўлим', 'Хизмат', 'Сони', 'Нарх', 'Сумма', 'Ҳолат', 'Оператор', 'Киритилди'];
const CFG_SHEETS = ['Созламалар', 'Фойдаланувчилар', 'Хизматлар', 'Докторлар'];

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
    .addItem('Кешни тозалаш (нарх, созлама, устунлар)', 'clearCache_')
    .addSeparator()
    .addItem('⚠ Синов маълумотларини тозалаш', 'wipeData')
    .addToUi();
}

function setup() {
  clearCache_();
  build_();
  resyncStays_();
  clearCache_();
  try { PropertiesService.getScriptProperties().setProperty('schema', SCHEMA); } catch (e) {}
  try { SpreadsheetApp.getUi().alert('Тайёр! Варақлар яратилди / янгиланди.'); } catch (e) {}
}

/* ---------- Синов маълумотларини тозалаш ----------
   Ўчади:  ҳамма бўлим варақларидаги қабуллар, «Тўловлар», «Ётоқ хизматлари», навбат рақамлари.
   Қолади: «Созламалар», «Фойдаланувчилар», «Хизматлар», «Докторлар» ва устун сарлавҳалари.
   Аввал жадвалнинг тўлиқ нусхаси олинади. */
function wipeData() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Синов маълумотларини тозалаш',
    'ҲАММА қабуллар, тўловлар, ётоқхона ёзувлари ва навбат рақамлари ўчирилади.\n' +
    'Нархлар, докторлар, фойдаланувчилар ва созламалар ҚОЛАДИ.\n' +
    'Аввал жадвалнинг нусхаси олинади.\n\nДавом этиш учун 1234 деб ёзинг:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || r.getResponseText().trim() !== '1234') {
    ui.alert('Бекор қилинди. Ҳеч нарса ўчирилмади.');
    return;
  }
  const res = wipe_(true);
  ui.alert('Тозаланди: ' + res.rows + ' та қатор ўчирилди.\n' +
    (res.backup ? 'Нусха: «' + res.backup + '» (Google Drive’да).' : 'Нусха олиб бўлмади.') +
    '\n\nЁтоқхона навбати давом этиши керак бўлса, «Навбат» варағида «Охирги рақам»ни ёзиб қўйинг.' +
    '\nСайтда: «Чиқиш» қилиб, қайта киринг.');
}

function wipe_(backup) {
  const ss = ss_();
  let name = '';
  if (backup) {
    try {
      name = ss.getName() + ' — нусха ' + fmt_(new Date(), 'yyyy-MM-dd HH:mm');
      ss.copy(name);
    } catch (e) { name = ''; }
  }
  let rows = 0;
  DEPTS.map(d => d.name).concat([S_PAY, S_CHG]).forEach(n => {
    const sh = ss.getSheetByName(n);
    if (!sh) return;
    const last = sh.getLastRow(), cols = sh.getLastColumn();
    if (last < 2 || cols < 1) return;
    sh.getRange(2, 1, last - 1, cols).clearContent();
    rows += last - 1;
  });
  const q = ss.getSheetByName('Навбат');
  if (q && q.getLastRow() > 1) {
    const n = q.getLastRow() - 1;
    q.getRange(2, 2, n, 2).setValues(Array.from({ length: n }, () => [0, '']));
  }
  clearCache_();
  bump_();
  return { rows: rows, backup: name };
}

// Биринчи сўровда варақлар ва янги устунларни ўзи яратади.
function migrate_() {
  const c = cache_();
  if (c && c.get('schema') === SCHEMA) return;
  let p = null;
  try { p = PropertiesService.getScriptProperties(); } catch (e) {}
  const have = p ? (Number(p.getProperty('schema')) || 0) : 0;
  if (have < Number(SCHEMA)) {
    // Фақат битта сўров янгилайди, қолганлари кутиб туради (бир вақтда бир неча марта қурилмасин)
    const lock = LockService.getScriptLock();
    lock.waitLock(60000);
    try {
      const again = p ? (Number(p.getProperty('schema')) || 0) : 0;
      if (again < Number(SCHEMA)) {
        clearCache_();
        build_();
        resyncStays_();
        clearCache_();
        if (p) p.setProperty('schema', SCHEMA);
      }
    } finally { try { lock.releaseLock(); } catch (e) {} }
  }
  if (c) { try { c.put('schema', SCHEMA, 21600); } catch (e) {} }
}

function build_() {
  const ss = ss_();
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
  const haveRoom = svc.getDataRange().getValues().some(r => String(r[0]).trim() === S_YOT && String(r[1]).indexOf('палата') >= 0);
  if (!haveRoom) SEED_SERVICES.filter(r => r[0] === S_YOT).forEach(r => svc.appendRow(r));

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
    ensureCols_(makeSheet_(ss, d.name, head, [], textCols), head);
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
  const have = headRaw_(sh);
  let c = have.length;
  head.forEach(h => {
    if (have.indexOf(h) >= 0) return;
    c++;
    sh.getRange(1, c, 1, 1).setValues([[h]]).setFontWeight('bold').setBackground('#e6f4f1');
  });
}

function headers_(d) { return COMMON.concat(d.extra.map(x => x.h)); }

// Эски вариантда ёзилган ётоқ ёзувларини янги кўринишга ўтказади:
// муолажа ва тўловларни бемор қаторининг ўзига ёзиб қўяди.
function resyncStays_() {
  try {
    const t = readAll_(S_YOT);
    const todo = t.rows.filter(o => o['Ҳолат'] !== 'Бекор' && !String(o[JC] || '').trim() && !String(o[JP] || '').trim());
    if (!todo.length) return;
    const chBy = {}, pyBy = {};
    readAll_(S_CHG).rows.forEach(c => {
      if (c['Ҳолат'] === 'Бекор') return;
      (chBy[c['Ётиш ID']] = chBy[c['Ётиш ID']] || []).push(
        [c['ID'], c['Сана'], c['Бўлим'], c['Хизмат'], n_(c['Сони']) || 1, n_(c['Нарх']), n_(c['Сумма'])]);
    });
    readAll_(S_PAY).rows.forEach(p => {
      if (p['Ҳолат'] === 'Бекор' || p['Бўлим'] !== S_YOT) return;
      (pyBy[p['Ёзув ID']] = pyBy[p['Ёзув ID']] || []).push(
        [p['Сана'], p['Вақт'], n_(p['Сумма']), p['Тўлов тури'], p['Тури']]);
    });
    todo.forEach(o => {
      const ch = chBy[o['ID']] || [], py = pyBy[o['ID']] || [];
      const L = { sh: t.sh, head: t.head, r: o._row, v: t.sh.getRange(o._row, 1, 1, t.head.length).getValues()[0] };
      const upd = stayTotals_(o, ch, py);
      upd[JC] = JSON.stringify(ch);
      upd[JP] = JSON.stringify(py);
      save_(L, upd);
    });
  } catch (e) {}
}

/* ================= КЕШ ================= */

let SS_ = null;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.getActiveSpreadsheet()); }

function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }

function cached_(key, ttl, fn) {
  const c = cache_();
  try { const v = c && c.get(key); if (v) return JSON.parse(v); } catch (e) {}
  const val = fn();
  try { if (c) c.put(key, JSON.stringify(val), ttl); } catch (e) {}
  return val;
}

function clearCache_() {
  const keys = ['cfg', 'users', 'schema', 'ver', 'sync_n'];
  DEPTS.forEach(d => keys.push('h:' + d.name));
  [S_PAY, S_CHG].forEach(n => keys.push('h:' + n));
  for (let i = 0; i < 40; i++) keys.push('sync_' + i);
  try { cache_().removeAll(keys); } catch (e) {}
  Object.keys(HC_).forEach(k => delete HC_[k]);
}

// Варақ қўлда ўзгартирилса: созламалар кеши тозаланади ва сайтлар янгиланади.
function onEdit(e) {
  try {
    const n = e.range.getSheet().getName();
    if (CFG_SHEETS.indexOf(n) >= 0 || e.range.getRow() === 1) clearCache_();
    else bump_();
  } catch (x) {}
}

// Маълумот версияси — сайт «ўзгариш борми?» деб сўраганда шу солиштирилади.
function ver_() {
  const c = cache_();
  let v = null;
  try { v = c && c.get('ver'); } catch (e) {}
  if (!v) { v = String(Date.now()); try { if (c) c.put('ver', v, 21600); } catch (e) {} }
  return v;
}

function bump_() {
  const c = cache_();
  let old = null;
  try { old = c && c.get('ver'); } catch (e) {}
  let v = String(Date.now());
  if (v === old) v = String(Date.now() + 1);
  try { if (c) c.put('ver', v, 21600); } catch (e) {}
  return v;
}

// 100 КБ дан катта матнни бўлакларга бўлиб кешлаш
function bigPut_(k, text, ttl) {
  try {
    const SZ = 90000, n = Math.ceil(text.length / SZ);
    if (n > 40) return;
    const o = {};
    for (let i = 0; i < n; i++) o[k + i] = text.substring(i * SZ, (i + 1) * SZ);
    o[k + 'n'] = String(n);
    cache_().putAll(o, ttl);
  } catch (e) {}
}

function bigGet_(k) {
  try {
    const c = cache_();
    const n = Number(c.get(k + 'n'));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(k + i);
    const m = c.getAll(keys);
    let s = '';
    for (let j = 0; j < n; j++) { if (m[k + j] == null) return null; s += m[k + j]; }
    return s;
  } catch (e) { return null; }
}

// Натижани маълумот версияси (tag) билан кешлайди: ўзгариш бўлмаса қайта ҳисобламайди.
function memo_(key, tag, fn) {
  const hit = bigGet_(key);
  if (hit) { try { const o = JSON.parse(hit); if (o.tag === tag) return o; } catch (e) {} }
  const res = fn();
  res.tag = tag;
  bigPut_(key, JSON.stringify(res), 600);
  return res;
}

/* ================= API ================= */

function doGet() {
  return out_(JSON.stringify({ ok: true, msg: 'Клиника API ишлаяпти', v: VERSION, schema: SCHEMA }));
}

const MUTATING = ['add', 'cancel', 'setField', 'payDebt', 'stayAdmit', 'stayOp'];

function doPost(e) {
  let lock = null;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    migrate_();
    const user = auth_(req.pin);
    if (!user) return out_(JSON.stringify({ ok: false, error: 'PIN нотўғри' }));

    const mut = MUTATING.indexOf(req.action) >= 0;
    const c = cache_();
    let before = null;
    if (mut) {
      // Бир хил сўров икки марта келса (қайта уриниш) — иккинчи марта ёзилмайди
      if (req.rid && c) { const done = c.get('rid:' + req.rid); if (done) return out_(done); }
      lock = LockService.getScriptLock();
      lock.waitLock(25000);
      if (req.rid && c) { const done2 = c.get('rid:' + req.rid); if (done2) return out_(done2); }
      before = ver_();
    }
    const res = Object.assign({ ok: true }, route_(req, user));
    if (mut) {
      res.ver = bump_();
      // fresh — сайтдаги маълумот янги: бошқа ҳеч ким орада ёзмаган, тўлиқ янгилаш шарт эмас
      res.fresh = !!req.ver && req.ver === before;
    }
    const text = JSON.stringify(res);
    if (mut && req.rid && c) { try { c.put('rid:' + req.rid, text, 600); } catch (x) {} }
    return out_(text);
  } catch (err) {
    return out_(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) {} }
  }
}

function route_(req, user) {
  switch (req.action) {
    case 'login':     return Object.assign({ user: user, config: config_() }, req.sync ? { data: sync_(req) } : {});
    case 'sync':      return sync_(req);
    case 'list':      return { rows: list_(req.dept, req.date) };
    case 'add':       return { record: add_(req.dept, req.data || {}, user) };
    case 'cancel':    return { result: cancel_(req.dept, req.id, req.row, user, req.reason) };
    case 'setField':  return { result: setField_(req.dept, req.id, req.row, req.field, req.value) };
    case 'debts':     return debts_();
    case 'payDebt':   return { payment: payDebt_(req.dept, req.id, req.row, req.amount, req.payment, user) };
    case 'staysDone': return { rows: staysDone_() };
    case 'stayAdmit': return { stay: stayAdmit_(req.data || {}, user) };
    case 'stayOp':    return { stay: stayOp_(req, user) };
    case 'reportAll':
      if (user.role !== 'админ') throw new Error('Фақат админ учун');
      return { report: reportAll_() };
    default: throw new Error('Номаълум амал: ' + req.action + ' (Apps Script’да эски код турган бўлиши мумкин)');
  }
}

function out_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/* ================= ЁРДАМЧИЛАР ================= */

function sh_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" варағи топилмади. Sheets менюсидан «Клиника → Ўрнатиш»ни бажаринг.');
  return sh;
}

function dept_(key) {
  const d = DEPTS.find(x => x.key === key);
  if (!d) throw new Error('Бўлим топилмади');
  return d;
}

function n_(v) { return Number(v) || 0; }
function int_(v) { return Math.round(n_(v)); }
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }
function today_() { return fmt_(new Date(), 'yyyy-MM-dd'); }
function stamp_(now) { return fmt_(now, 'yyMMddHHmmss'); }
function rnd_() { return String(Math.floor(Math.random() * 900) + 100); }
function arr_(s) { try { const a = JSON.parse(String(s || '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

function rows_(name) { return sh_(name).getDataRange().getValues().slice(1); }

function headRaw_(sh) {
  const c = sh.getLastColumn();
  if (c < 1) return [];
  return sh.getRange(1, 1, 1, c).getValues()[0].map(String);
}

// Варақ + устун номлари (устун номлари кешда туради)
const HC_ = {};
function T_(name, write) {
  const sh = sh_(name);
  let h = HC_[name];
  if (!h) {
    h = cached_('h:' + name, 600, () => headRaw_(sh));
    HC_[name] = h;
  }
  // Ёзишдан олдин: устун қўшилган/ўчирилган бўлса, сарлавҳа қайта ўқилади (нотўғри устунга ёзмаслик учун)
  if (write && !HC_['ok:' + name]) {
    if (sh.getLastColumn() !== h.length) {
      h = headRaw_(sh);
      HC_[name] = h;
      try { cache_().put('h:' + name, JSON.stringify(h), 600); } catch (e) {}
    }
    HC_['ok:' + name] = true;
  }
  return { sh: sh, head: h };
}

function obj_(head, row) {
  const o = {};
  for (let j = 0; j < head.length; j++) {
    const h = head[j];
    if (!h) continue;
    let x = row[j];
    if (x instanceof Date) {
      x = (h === 'Вақт' || h === 'Келган соат') ? fmt_(x, 'HH:mm') : fmt_(x, 'yyyy-MM-dd');
    }
    o[h] = x === undefined ? '' : x;
  }
  return o;
}

// Варақни тўлиқ ўқийди (_row — қатор рақами). Фақат ҳисобот ва кичик варақлар учун.
function readAll_(name) {
  const t = T_(name);
  const v = t.sh.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < v.length; i++) {
    const o = obj_(t.head, v[i]);
    if (!o['ID']) continue;
    o._row = i + 1;
    rows.push(o);
  }
  return { sh: t.sh, head: t.head, rows: rows };
}

// Варақни пастдан юқорига бўлаклаб ўқийди (янги ёзувлар пастда).
function tail_(name, keep, stop) {
  const t = T_(name);
  const out = [];
  let end = t.sh.getLastRow();
  while (end >= 2) {
    const start = Math.max(2, end - 299);
    const v = t.sh.getRange(start, 1, end - start + 1, t.head.length).getValues();
    let done = false;
    for (let i = v.length - 1; i >= 0; i--) {
      const o = obj_(t.head, v[i]);
      if (!o['ID']) continue;
      if (stop(o)) { done = true; break; }
      if (keep(o)) { o._row = start + i; out.push(o); }
    }
    if (done) break;
    end = start - 1;
  }
  return out;
}

// Қаторни топади: аввал сайт айтган қатор рақами текширилади (1 та ўқиш),
// тўғри келмаса — ID бўйича қидирилади.
function locate_(name, id, hint) {
  const t = T_(name, true);
  const n = t.head.length;
  hint = Number(hint) || 0;
  if (hint >= 2) {
    try {
      const v = t.sh.getRange(hint, 1, 1, n).getValues()[0];
      if (String(v[0]) === String(id)) return { sh: t.sh, head: t.head, r: hint, v: v };
    } catch (e) {}
  }
  const last = t.sh.getLastRow();
  if (last < 2) return null;
  const cell = t.sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!cell) return null;
  const r = cell.getRow();
  return { sh: t.sh, head: t.head, r: r, v: t.sh.getRange(r, 1, 1, n).getValues()[0] };
}

// Қаторни битта ёзиш билан янгилайди.
function save_(L, upd) {
  let hit = false;
  Object.keys(upd).forEach(k => {
    const c = L.head.indexOf(k);
    if (c >= 0) { L.v[c] = upd[k]; hit = true; }
  });
  if (hit) L.sh.getRange(L.r, 1, 1, L.head.length).setValues([L.v]);
}

function rowOf_(head, rec) { return head.map(h => (rec[h] === undefined ? '' : rec[h])); }

function pick_(sh, head, rowNums) {
  if (!rowNums.length) return [];
  const lo = Math.min.apply(null, rowNums), hi = Math.max.apply(null, rowNums);
  const v = sh.getRange(lo, 1, hi - lo + 1, head.length).getValues();
  return rowNums.slice().sort((a, b) => a - b).map(r => {
    const o = obj_(head, v[r - lo]);
    o._row = r;
    return o;
  }).filter(o => o['ID']);
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
  const users = cached_('users', 600, () => sh_('Фойдаланувчилар').getDataRange().getDisplayValues().slice(1)
    .map(r => [String(r[0]), String(r[1]).trim(), String(r[2]).trim().toLowerCase()])
    .filter(r => r[1] !== ''));
  const u = users.find(r => r[1] === String(pin).trim());
  return u ? { name: u[0] || 'Оператор', role: u[2] || 'оператор' } : null;
}

function config_() { return cached_('cfg', 600, configRead_); }

function configRead_() {
  const s = {};
  rows_('Созламалар').forEach(r => { if (r[0]) s[String(r[0]).trim()] = String(r[1]); });
  return {
    clinic: s['Клиника номи'] || 'Клиника',
    address: s['Манзил'] || '',
    phone: s['Телефон'] || '',
    receiptWidth: Number(s['Чек эни (мм)']) || 80,
    payments: (s['Тўлов турлари'] || 'Нақд, Карта').split(',').map(x => x.trim()).filter(String),
    depts: DEPTS.map(d => ({ key: d.key, name: d.name, extra: d.extra.filter(x => x.t !== 'json' && x.t !== 'num') })),
    services: rows_('Хизматлар').filter(r => r[1]).map(r => ({ dept: String(r[0]).trim(), name: String(r[1]).trim(), price: Number(r[2]) || 0 })),
    doctors: rows_('Докторлар').filter(r => r[0]).map(r => ({ name: String(r[0]).trim(), dept: String(r[1]).trim(), share: Number(r[2]) || 0 }))
  };
}

function doctorShare_(name, deptName) {
  if (!name) return 0;
  const docs = config_().doctors;
  const hit = docs.find(r => r.name === name && r.dept === deptName) || docs.find(r => r.name === name);
  return hit ? hit.share : 0;
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
  amount = int_(amount);
  if (!(amount > 0)) return null;
  const t = T_(S_PAY, true);
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
  t.sh.appendRow(rowOf_(t.head, rec));
  return rec;
}

function cancelPays_(recId) {
  const t = T_(S_PAY, true);
  const c = t.head.indexOf('Ёзув ID');
  const n = t.sh.getLastRow() - 1;
  if (c < 0 || n < 1) return;
  const st = t.head.indexOf('Ҳолат') + 1;
  t.sh.getRange(2, c + 1, n, 1).createTextFinder(String(recId)).matchEntireCell(true).findAll()
    .forEach(x => t.sh.getRange(x.getRow(), st).setValue('Бекор'));
}

/* ================= БИР СЎРОВДА ҲАММАСИ ================= */

// Бугунги қабуллар (ҳамма бўлим) + ҳозир ётганлар. Сайт шу билан ишлайди.
function sync_(req) {
  const date = today_();
  const ver = ver_();
  if (req.ver && req.ver === ver && req.date === date) return { same: true, ver: ver, date: date };
  return memo_('sync_', ver + '|' + date, () => {
    const lists = {};
    DEPTS.forEach(d => {
      if (d.key === YOTOQ) return;
      lists[d.key] = tail_(d.name, o => o['Сана'] === date, o => !!o['Сана'] && String(o['Сана']) < date);
    });
    return { ver: ver, date: date, lists: lists, stays: activeStays_() };
  });
}

// Ҳозир ётганлар: аввал фақат «Ҳолат» устуни ўқилади, кейин керакли қаторлар.
function activeStays_() {
  const t = T_(S_YOT);
  const c = t.head.indexOf('Ҳолат');
  const n = t.sh.getLastRow() - 1;
  if (c < 0 || n < 1) return [];
  const col = t.sh.getRange(2, c + 1, n, 1).getValues();
  const hits = [];
  for (let i = 0; i < col.length; i++) {
    const v = String(col[i][0]);
    if (v === 'Ётибди' || v === 'Фаол') hits.push(i + 2);
  }
  return pick_(t.sh, t.head, hits).filter(stayActive_).map(stayOut_);
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
  const sum = Math.max(0, int_(blank(data.sum) ? calc : data.sum));
  const paid = Math.min(sum, Math.max(0, int_(blank(data.paid) ? sum : data.paid)));
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

  const t = T_(d.name, true);
  const r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, t.head.length).setValues([rowOf_(t.head, rec)]);
  addPay_(d.name, rec['ID'], fio, paid, data.payment, 'Қабул', user, now);

  rec._row = r;
  rec.items = items;
  rec.dept = d.name;
  return rec;
}

function list_(key, date) {
  const d = dept_(key);
  return tail_(d.name, o => o['Сана'] === date, o => !!o['Сана'] && String(o['Сана']) < String(date));
}

function cancel_(key, id, hint, user, reason) {
  const d = dept_(key);
  const L = locate_(d.name, id, hint);
  if (!L) throw new Error('Ёзув топилмади');
  const row = obj_(L.head, L.v);
  if (row['Ҳолат'] === 'Бекор') return { id: id };
  if (user.role !== 'админ' && row['Сана'] !== today_()) {
    throw new Error('Эски ёзувни фақат админ бекор қила олади');
  }
  const note = [row['Изоҳ'], 'Бекор: ' + user.name + (reason ? ' — ' + reason : '')]
    .filter(x => String(x || '').trim()).join(' | ');
  save_(L, { 'Ҳолат': 'Бекор', 'Қарз': 0, 'Изоҳ': note });
  cancelPays_(id);
  return { id: id };
}

function setField_(key, id, hint, field, value) {
  const d = dept_(key);
  const x = d.extra.find(e => e.h === field && e.t === 'date');
  if (!x || d.key === YOTOQ) throw new Error('Бу майдонни ўзгартириб бўлмайди');
  const L = locate_(d.name, id, hint);
  if (!L) throw new Error('Ёзув топилмади');
  const o = {}; o[field] = String(value || '');
  save_(L, o);
  return { id: id };
}

/* ================= ҚАРЗЛАР ================= */

function debts_() {
  const ver = ver_();
  return memo_('debts_', ver, () => debtsRead_(ver));
}

function debtsRead_(ver) {
  const out = [];
  let total = 0;
  DEPTS.forEach(d => {
    const sh = ss_().getSheetByName(d.name);
    if (!sh) return;
    const head = T_(d.name).head;
    const c = head.indexOf('Қарз');
    const n = sh.getLastRow() - 1;
    if (c < 0 || n < 1) return;
    // Фақат «Қарз» устуни ўқилади, кейин қарзи бор қаторлар олинади
    const col = sh.getRange(2, c + 1, n, 1).getValues();
    const hits = [];
    for (let i = 0; i < col.length; i++) if (n_(col[i][0]) > 0) hits.push(i + 2);
    pick_(sh, head, hits).forEach(o => {
      const debt = n_(o['Қарз']);
      if (o['Ҳолат'] === 'Бекор' || !(debt > 0)) return;
      if (d.key === YOTOQ && stayActive_(o)) return; // ётган бемор ҳали ҳисоб-китоб қилмаган
      total += debt;
      out.push({
        dept: d.key, deptName: d.name, id: o['ID'], row: o._row, no: o['Навбат №'],
        date: d.key === YOTOQ ? (o['Кетган сана'] || o['Сана']) : o['Сана'],
        fio: o['Ф.И.Ш'], year: o['Туғилган йил'], phone: o['Телефон'],
        items: o['Хизматлар'], sum: n_(o['Сумма']), paid: n_(o['Тўланган']), debt: debt
      });
    });
  });
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows: out, total: total, ver: ver };
}

function payDebt_(key, id, hint, amount, payType, user) {
  const d = dept_(key);
  const L = locate_(d.name, id, hint);
  if (!L) throw new Error('Ёзув топилмади');
  const row = obj_(L.head, L.v);
  if (row['Ҳолат'] === 'Бекор') throw new Error('Ёзув бекор қилинган');
  if (d.key === YOTOQ && stayActive_(row)) throw new Error('Бемор ҳали ётибди — тўловни «Ётоқхона» бўлимидан киритинг');
  const debt = n_(row['Қарз']);
  amount = int_(amount);
  if (!(amount > 0)) throw new Error('Сумма киритилмаган');
  if (amount > debt) throw new Error('Сумма қарздан катта (қарз: ' + debt + ')');
  const now = new Date();
  const paid = n_(row['Тўланган']) + amount;
  const upd = { 'Тўланган': paid, 'Қарз': debt - amount };
  if (d.key === YOTOQ) {
    const py = arr_(row[JP]);
    py.push([fmt_(now, 'yyyy-MM-dd'), fmt_(now, 'HH:mm'), amount, payType || '', 'Қарз тўлови']);
    upd[JP] = JSON.stringify(py);
  }
  save_(L, upd);
  addPay_(d.name, id, row['Ф.И.Ш'], amount, payType, 'Қарз тўлови', user, now);
  return { dept: d.name, fio: row['Ф.И.Ш'], sum: n_(row['Сумма']), paid: paid, left: debt - amount };
}

/* ================= ЁТОҚХОНА ================= */

function stayActive_(o) {
  return o['Ҳолат'] !== 'Бекор' && o['Ҳолат'] !== 'Кетди' && !o['Кетган сана'];
}

// Сайтга юбориладиган кўриниш: ch — муолажалар, py — тўловлар.
//   ch: [id, сана, бўлим, хизмат, сони, нарх, сумма]
//   py: [сана, вақт, сумма, тўлов тури, тури]
function stayOut_(o) {
  const s = {};
  Object.keys(o).forEach(k => { if (k !== JC && k !== JP) s[k] = o[k]; });
  s.ch = arr_(o[JC]);
  s.py = arr_(o[JP]);
  return s;
}

function stayTotals_(o, ch, py) {
  const days = days_(o['Келган сана'] || o['Сана'], o['Кетган сана'] || today_());
  const svc = ch.reduce((s, c) => s + n_(c[6]), 0);
  const paid = py.reduce((s, p) => s + n_(p[2]), 0);
  const total = days * n_(o['Кунлик нарх']) + svc;
  const names = [];
  ch.forEach(c => { if (names.indexOf(c[3]) < 0) names.push(c[3]); });
  return {
    'Сумма': total,
    'Тўланган': paid,
    'Қарз': Math.max(0, total - paid),
    'Муолажалар суммаси': svc,
    'Хизматлар': ['Ётоқ ' + days + ' кун'].concat(names.slice(0, 8)).join(', ')
  };
}

function staysDone_() {
  const rows = readAll_(S_YOT).rows.filter(o => o['Ҳолат'] !== 'Бекор' && !stayActive_(o));
  rows.sort((a, b) => String(b['Кетган сана']).localeCompare(String(a['Кетган сана'])));
  return rows.slice(0, 150).map(stayOut_);
}

function stayAdmit_(data, user) {
  const d = dept_(YOTOQ);
  const fio = String(data.fio || '').trim();
  if (!fio) throw new Error('Ф.И.Ш киритилмаган');
  const now = new Date();
  const date = fmt_(now, 'yyyy-MM-dd');
  const no = nextNo_(d, date);
  const id = d.key + '-' + stamp_(now) + '-' + no;
  const prepay = Math.max(0, int_(data.prepay));
  const py = prepay > 0 ? [[date, fmt_(now, 'HH:mm'), prepay, data.payment || '', 'Аванс']] : [];
  const rec = {
    'ID': id, 'Сана': date, 'Вақт': fmt_(now, 'HH:mm'), 'Навбат №': no,
    'Ф.И.Ш': fio, 'Туғилган йил': String(data.year || ''), 'Телефон': String(data.phone || ''),
    'Тўлов тури': '', 'Доктор': data.doctor || '', 'Доктор улуши': 0, 'Юборган доктор': data.referrer || '',
    'Ҳолат': 'Ётибди', 'Оператор': user.name, 'Изоҳ': data.note || '',
    'Келган сана': data.arrive || date, 'Келган соат': data.arriveTime || fmt_(now, 'HH:mm'),
    'Кетган сана': '', 'Ётоқ тури': data.room || '', 'Кунлик нарх': Math.max(0, int_(data.rate))
  };
  Object.assign(rec, stayTotals_(rec, [], py));
  rec[JC] = '[]';
  rec[JP] = JSON.stringify(py);

  const t = T_(d.name, true);
  const r = t.sh.getLastRow() + 1;
  t.sh.getRange(r, 1, 1, t.head.length).setValues([rowOf_(t.head, rec)]);
  addPay_(d.name, id, fio, prepay, data.payment, 'Аванс', user, now);
  rec._row = r;
  return stayOut_(rec);
}

// Ётган бемор устидаги ҳамма амал: charge, chargeCancel, pay, edit, discharge.
// Ҳар бири: 1 та ўқиш + 1 та ёзиш (+ дафтарга 1 қатор).
function stayOp_(req, user) {
  const L = locate_(S_YOT, req.id, req.row);
  if (!L) throw new Error('Бемор топилмади');
  const o = obj_(L.head, L.v);
  if (!stayActive_(o)) throw new Error('Бемор аллақачон кетган ёки ёзув бекор қилинган');
  const ch = arr_(o[JC]), py = arr_(o[JP]);
  const d = req.data || {};
  const now = new Date();
  const date = fmt_(now, 'yyyy-MM-dd'), time = fmt_(now, 'HH:mm');
  const upd = {};

  switch (req.op) {
    case 'charge': {
      const items = (d.items || []).filter(i => i && String(i.name || '').trim());
      if (!items.length) throw new Error('Хизмат танланмаган');
      const t = T_(S_CHG, true);
      const logs = [];
      items.forEach((i, k) => {
        const qty = Math.max(1, int_(i.qty) || 1), price = Math.max(0, int_(i.price));
        const cid = 'c-' + stamp_(now) + '-' + k + rnd_();
        const day = d.date || date, name = String(i.name).trim();
        ch.push([cid, day, i.dept || '', name, qty, price, qty * price]);
        logs.push(rowOf_(t.head, {
          'ID': cid, 'Ётиш ID': o['ID'], 'Сана': day, 'Бўлим': i.dept || '', 'Хизмат': name,
          'Сони': qty, 'Нарх': price, 'Сумма': qty * price, 'Ҳолат': 'Фаол',
          'Оператор': user.name, 'Киритилди': date + ' ' + time
        }));
      });
      if (logs.length === 1) t.sh.appendRow(logs[0]);
      else t.sh.getRange(t.sh.getLastRow() + 1, 1, logs.length, t.head.length).setValues(logs);
      break;
    }
    case 'chargeCancel': {
      const i = ch.findIndex(c => String(c[0]) === String(d.cid));
      if (i < 0) throw new Error('Хизмат топилмади');
      ch.splice(i, 1);
      const C = locate_(S_CHG, d.cid, 0);
      if (C) save_(C, { 'Ҳолат': 'Бекор' });
      break;
    }
    case 'pay': {
      const amount = int_(d.amount);
      if (!(amount > 0)) throw new Error('Сумма киритилмаган');
      py.push([date, time, amount, d.payment || '', 'Аванс']);
      addPay_(S_YOT, o['ID'], o['Ф.И.Ш'], amount, d.payment, 'Аванс', user, now);
      break;
    }
    case 'edit': {
      if (d.room !== undefined) upd['Ётоқ тури'] = String(d.room || '');
      if (d.rate !== undefined) upd['Кунлик нарх'] = Math.max(0, int_(d.rate));
      if (d.arrive) upd['Келган сана'] = String(d.arrive);
      break;
    }
    case 'discharge': {
      const leave = String(d.date || date);
      if (leave < String(o['Келган сана'] || '')) throw new Error('Кетган сана келган санадан олдин бўлиши мумкин эмас');
      upd['Кетган сана'] = leave;
      upd['Ҳолат'] = 'Кетди';
      const amount = int_(d.amount);
      if (amount > 0) {
        upd['Тўлов тури'] = d.payment || '';
        py.push([date, time, amount, d.payment || '', 'Ҳисоб-китоб']);
        addPay_(S_YOT, o['ID'], o['Ф.И.Ш'], amount, d.payment, 'Ҳисоб-китоб', user, now);
      }
      break;
    }
    default: throw new Error('Номаълум амал');
  }

  Object.assign(o, upd);
  Object.assign(upd, stayTotals_(o, ch, py));
  upd[JC] = JSON.stringify(ch);
  upd[JP] = JSON.stringify(py);
  save_(L, upd);
  Object.assign(o, upd);
  o._row = L.r;
  return stayOut_(o);
}

/* ================= ҲИСОБОТ ================= */

function inc_(o, k, v) { o[k] = (o[k] || 0) + v; }

// Кунлар бўйича тайёр жамланма (охирги 400 кун). Сайт исталган даврни ўзида йиғади.
function reportAll_() {
  const ver = ver_();
  return memo_('repall_', ver, () => reportAllRead_(ver));
}

function reportAllRead_(ver) {
  const today = today_();
  const minDate = fmt_(new Date(Date.now() - 400 * 86400000), 'yyyy-MM-dd');
  const days = {};
  const D = dt => days[dt] || (days[dt] = { cash: 0, cashN: 0, byPay: {}, byKind: {}, cashDept: {}, depts: {}, docs: {}, refs: {}, cancelled: 0 });

  readAll_(S_PAY).rows.forEach(p => {
    if (p['Ҳолат'] === 'Бекор') return;
    const dt = String(p['Сана'] || '');
    if (!dt || dt < minDate) return;
    const x = D(dt), s = n_(p['Сумма']);
    x.cash += s; x.cashN++;
    inc_(x.byPay, p['Тўлов тури'] || '—', s);
    inc_(x.byKind, p['Тури'] || '—', s);
    inc_(x.cashDept, p['Бўлим'] || '—', s);
  });

  const res = {
    ver: ver, today: today, minDate: minDate, deptNames: DEPTS.map(d => d.name), days: days,
    debtNow: { total: 0, count: 0 }, inpatients: { count: 0, total: 0, paid: 0, balance: 0 }
  };

  DEPTS.forEach(d => {
    const isY = d.key === YOTOQ;
    if (!ss_().getSheetByName(d.name)) return;
    readAll_(d.name).rows.forEach(o => {
      if (o['Ҳолат'] === 'Бекор') {
        const dt0 = String(o['Сана'] || '');
        if (dt0 && dt0 >= minDate) D(dt0).cancelled++;
        return;
      }
      if (isY && stayActive_(o)) {
        // Ҳали ётганлар — жорий ҳисоб (бугунгача)
        const total = days_(o['Келган сана'] || o['Сана'], today) * n_(o['Кунлик нарх']) + n_(o['Муолажалар суммаси']);
        const paid = n_(o['Тўланган']);
        res.inpatients.count++; res.inpatients.total += total;
        res.inpatients.paid += paid; res.inpatients.balance += total - paid;
        return;
      }
      const debt = n_(o['Қарз']);
      if (debt > 0) { res.debtNow.total += debt; res.debtNow.count++; }
      const dt = String((isY ? (o['Кетган сана'] || o['Сана']) : o['Сана']) || '');
      if (!dt || dt < minDate) return;
      const x = D(dt);
      const s = n_(o['Сумма']), share = n_(o['Доктор улуши']);
      const dd = x.depts[d.name] || (x.depts[d.name] = { count: 0, sum: 0, debt: 0, share: 0 });
      dd.count++; dd.sum += s; dd.debt += debt; dd.share += share;
      if (o['Доктор']) {
        const k = o['Доктор'] + '|' + d.name;
        const g = x.docs[k] || (x.docs[k] = { name: o['Доктор'], dept: d.name, count: 0, sum: 0, share: 0 });
        g.count++; g.sum += s; g.share += share;
      }
      if (o['Юборган доктор']) {
        const k = String(o['Юборган доктор']).trim();
        const g = x.refs[k] || (x.refs[k] = { count: 0, sum: 0 });
        g.count++; g.sum += s;
      }
    });
  });
  return res;
}
