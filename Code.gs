/******************************************************
 *  КЛИНИКА — Google Sheets API (Apps Script)
 *  1) Шу кодни Sheets → Кенгайтмалар → Apps Script га қўйинг
 *  2) setup функциясини бир марта ишга туширинг
 *  3) Deploy → Web app (Anyone) қилиб URL олинг
 ******************************************************/

const TZ = 'Asia/Tashkent';

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
  { key: 'yotoq', name: 'Ётоқхона',        reset: false, extra: [
      { h: 'Келган сана', t: 'date' },
      { h: 'Келган соат', t: 'time' },
      { h: 'Кетган сана', t: 'date' },
      { h: 'Ётоқ тури',   t: 'text' } ] }
];

const COMMON = ['ID', 'Сана', 'Вақт', 'Навбат №', 'Ф.И.Ш', 'Туғилган йил', 'Телефон',
  'Хизматлар', 'Сумма', 'Тўлов тури', 'Доктор', 'Доктор улуши', 'Юборган доктор',
  'Ҳолат', 'Оператор', 'Изоҳ'];

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
  ['Ётоқхона', 'Ётоқ (1 кун)', 0]
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
    .addItem('Ўрнатиш (варақларни яратиш)', 'setup')
    .addToUi();
}

function setup() {
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

  makeSheet_(ss, 'Хизматлар', ['Бўлим', 'Хизмат', 'Нарх'], SEED_SERVICES, []);
  makeSheet_(ss, 'Докторлар', ['Исм', 'Бўлим', 'Улуш %'], SEED_DOCTORS, []);
  makeSheet_(ss, 'Навбат', ['Бўлим', 'Охирги рақам', 'Сана', 'Ҳар куни 1 дан'],
    DEPTS.map(d => [d.name, 0, '', d.reset ? 'ҲА' : 'ЙЎҚ']), [3]);

  DEPTS.forEach(d => {
    const head = headers_(d);
    const textCols = [];
    head.forEach((h, i) => {
      const ex = d.extra.find(x => x.h === h);
      if (['ID', 'Сана', 'Вақт', 'Туғилган йил', 'Телефон'].indexOf(h) >= 0 || ex) textCols.push(i + 1);
    });
    const sh = makeSheet_(ss, d.name, head, [], textCols);
    ['Сумма', 'Доктор улуши'].forEach(h => {
      const c = head.indexOf(h) + 1;
      sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0');
    });
  });

  // Бўш стандарт варақни ўчириш
  ['Sheet1', 'Лист1', 'Varaq1', 'Лист 1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  try { SpreadsheetApp.getUi().alert('Тайёр! Варақлар яратилди.'); } catch (e) {}
}

function makeSheet_(ss, name, head, rows, textCols) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh; // мавжуд варақ ўзгармайди
  sh = ss.insertSheet(name);
  (textCols || []).forEach(c => sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'));
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#e6f4f1');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  sh.autoResizeColumns(1, head.length);
  return sh;
}

function headers_(d) { return COMMON.concat(d.extra.map(x => x.h)); }

/* ================= API ================= */

function doGet() {
  return json_({ ok: true, msg: 'Клиника API ишлаяпти' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = auth_(req.pin);
    if (!user) return json_({ ok: false, error: 'PIN нотўғри' });

    switch (req.action) {
      case 'login':
        return json_({ ok: true, user: user, config: config_() });
      case 'add':
        return json_({ ok: true, record: add_(req.dept, req.data || {}, user) });
      case 'list':
        return json_({ ok: true, rows: list_(req.dept, req.date, req.active) });
      case 'cancel':
        return json_({ ok: true, result: cancel_(req.dept, req.id, user, req.reason) });
      case 'setField':
        return json_({ ok: true, result: setField_(req.dept, req.id, req.field, req.value) });
      case 'report':
        if (user.role !== 'админ') return json_({ ok: false, error: 'Фақат админ учун' });
        return json_({ ok: true, report: report_(req.from, req.to) });
      default:
        return json_({ ok: false, error: 'Номаълум амал' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================= ЁРДАМЧИЛАР ================= */

function sh_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('"' + name + '" варағи топилмади. Аввал «Ўрнатиш»ни бажаринг.');
  return sh;
}

function dept_(key) {
  const d = DEPTS.find(x => x.key === key);
  if (!d) throw new Error('Бўлим топилмади');
  return d;
}

function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }

function rows_(name) { return sh_(name).getDataRange().getValues().slice(1); }

function head_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }

function obj_(head, row) {
  const o = {};
  head.forEach((h, j) => {
    let x = row[j];
    if (x instanceof Date) {
      x = (h === 'Вақт' || h === 'Келган соат') ? fmt_(x, 'HH:mm') : fmt_(x, 'yyyy-MM-dd');
    }
    o[h] = x;
  });
  return o;
}

function normDate_(v) { return v instanceof Date ? fmt_(v, 'yyyy-MM-dd') : String(v || '').trim(); }

function findRow_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
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

/* ================= АМАЛЛАР ================= */

function add_(key, data, user) {
  const d = dept_(key);
  const fio = String(data.fio || '').trim();
  if (!fio) throw new Error('Ф.И.Ш киритилмаган');
  const items = (data.items || []).filter(i => i && String(i.name || '').trim());
  if (!items.length) throw new Error('Хизмат танланмаган');

  const calc = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const sum = (data.sum === '' || data.sum === null || data.sum === undefined || isNaN(Number(data.sum))) ? calc : Number(data.sum);
  const itemsText = items.map(i => String(i.name).trim() + ((Number(i.qty) || 1) > 1 ? ' ×' + i.qty : '')).join(', ');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date();
    const date = fmt_(now, 'yyyy-MM-dd');
    const no = nextNo_(d, date);
    const share = Math.round(sum * doctorShare_(data.doctor, d.name) / 100);

    const rec = {
      'ID': d.key + '-' + fmt_(now, 'yyMMddHHmmss') + '-' + no,
      'Сана': date,
      'Вақт': fmt_(now, 'HH:mm'),
      'Навбат №': no,
      'Ф.И.Ш': fio,
      'Туғилган йил': String(data.year || ''),
      'Телефон': String(data.phone || ''),
      'Хизматлар': itemsText,
      'Сумма': sum,
      'Тўлов тури': data.payment || '',
      'Доктор': data.doctor || '',
      'Доктор улуши': share,
      'Юборган доктор': data.referrer || '',
      'Ҳолат': 'Фаол',
      'Оператор': user.name,
      'Изоҳ': data.note || ''
    };
    d.extra.forEach(f => { rec[f.h] = (data.extra || {})[f.h] || ''; });

    const sh = sh_(d.name);
    const head = head_(sh);
    sh.appendRow(head.map(h => (rec[h] === undefined ? '' : rec[h])));

    rec.items = items;
    rec.dept = d.name;
    return rec;
  } finally {
    lock.releaseLock();
  }
}

function list_(key, date, active) {
  const d = dept_(key);
  const v = sh_(d.name).getDataRange().getValues();
  const head = v[0].map(String);
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const o = obj_(head, v[i]);
    if (!o['ID']) continue;
    const ok = active
      ? (o['Ҳолат'] !== 'Бекор' && !o['Кетган сана'])
      : o['Сана'] === date;
    if (ok) out.push(o);
  }
  return out.reverse();
}

function cancel_(key, id, user, reason) {
  const d = dept_(key);
  const sh = sh_(d.name);
  const head = head_(sh);
  const r = findRow_(sh, id);
  if (!r) throw new Error('Ёзув топилмади');
  const row = obj_(head, sh.getRange(r, 1, 1, head.length).getValues()[0]);
  if (row['Ҳолат'] === 'Бекор') throw new Error('Аллақачон бекор қилинган');
  if (user.role !== 'админ' && row['Сана'] !== fmt_(new Date(), 'yyyy-MM-dd')) {
    throw new Error('Эски ёзувни фақат админ бекор қила олади');
  }
  sh.getRange(r, head.indexOf('Ҳолат') + 1).setValue('Бекор');
  const note = [row['Изоҳ'], 'Бекор: ' + user.name + (reason ? ' — ' + reason : '')]
    .filter(x => String(x || '').trim()).join(' | ');
  sh.getRange(r, head.indexOf('Изоҳ') + 1).setValue(note);
  return { id: id };
}

function setField_(key, id, field, value) {
  const d = dept_(key);
  const f = d.extra.find(x => x.h === field && x.t === 'date');
  if (!f) throw new Error('Бу майдонни ўзгартириб бўлмайди');
  const sh = sh_(d.name);
  const head = head_(sh);
  const r = findRow_(sh, id);
  if (!r) throw new Error('Ёзув топилмади');
  sh.getRange(r, head.indexOf(field) + 1).setValue(String(value || ''));
  return { id: id };
}

function report_(from, to) {
  from = from || fmt_(new Date(), 'yyyy-MM-dd');
  to = to || from;
  const res = { from: from, to: to, total: 0, count: 0, cancelled: 0, byPay: {}, depts: [], doctors: [], referrers: [], days: {} };
  const docs = {}, refs = {};

  DEPTS.forEach(d => {
    const r = { name: d.name, count: 0, sum: 0, share: 0 };
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(d.name);
    if (sh) {
      const v = sh.getDataRange().getValues();
      const head = v[0].map(String);
      for (let i = 1; i < v.length; i++) {
        const o = obj_(head, v[i]);
        const dt = String(o['Сана'] || '');
        if (!dt || dt < from || dt > to) continue;
        if (o['Ҳолат'] === 'Бекор') { res.cancelled++; continue; }
        const s = Number(o['Сумма']) || 0;
        const sh2 = Number(o['Доктор улуши']) || 0;
        const p = o['Тўлов тури'] || '—';
        r.count++; r.sum += s; r.share += sh2;
        res.byPay[p] = (res.byPay[p] || 0) + s;
        res.days[dt] = (res.days[dt] || 0) + s;
        if (o['Доктор']) {
          const k = o['Доктор'] + '|' + d.name;
          docs[k] = docs[k] || { name: o['Доктор'], dept: d.name, count: 0, sum: 0, share: 0 };
          docs[k].count++; docs[k].sum += s; docs[k].share += sh2;
        }
        if (o['Юборган доктор']) {
          const k = String(o['Юборган доктор']).trim();
          refs[k] = refs[k] || { name: k, count: 0, sum: 0 };
          refs[k].count++; refs[k].sum += s;
        }
      }
    }
    res.total += r.sum;
    res.count += r.count;
    res.depts.push(r);
  });

  res.doctors = Object.keys(docs).map(k => docs[k]).sort((a, b) => b.sum - a.sum);
  res.referrers = Object.keys(refs).map(k => refs[k]).sort((a, b) => b.sum - a.sum);
  return res;
}
