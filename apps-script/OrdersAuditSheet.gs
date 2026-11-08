/**
 * ARRIVE — نظام الأوديت اليومي (Daily Audit Control) — الإصدار 3
 * ---------------------------------------------------------------
 * مستخدم واحد: مراجع الأوديت.
 * الاستخدام اليومي:
 *   1) الصق تصدير اليوم (بالعناوين) في Raw_Daily من A1.
 *   2) 🔄 تحديث (تشغيل الأوديت اليومي):
 *        - يضيف عمود "الإقليم (تلقائي)" في Raw_Daily حسب فرع العضو (من Rules).
 *        - ينشئ تاب باسم تاريخ اليوم (yyyy-mm-dd) فيه الشحنات المتأخرة فقط.
 *        - يحدّث Repeated_Orders (الأوردرات المتكررة + حالة التبليغ) وDashboard وHistory.
 *   3) في تاب اليوم: اختر نوع التبليغ والإجراء واكتب الملاحظة (الأعمدة الصفراء).
 *      وقت الإجراء يُسجَّل تلقائياً بعد تفعيل "تسجيل الإجراءات" مرة واحدة.
 *
 * قواعد التأخر (قابلة للتعديل من ورقة Rules):
 *   عمر الحالة   = تاريخ التقرير − تاريخ آخر حالة   ← مقارنة بحد الحالة (لكل حالة شحنة)
 *   عمر الأوردر  = تاريخ التقرير − تاريخ البيك أب    ← مقارنة بحد الفرع (إقليم الفرع)
 *   أوردر متأخر (الشركة)   : عمر الأوردر ≥ حد الشركة للفرع
 *   تبليغ خدمة العملاء     : حد خدمة العملاء ≤ عمر الأوردر < حد الشركة (يختفي عند تجاوز حد الشركة)
 *   التأخر يبدأ عند الحد نفسه (≥) إذا كانت Rules!B8 = "نعم"، وعند تجاوزه (>) إذا "لا".
 */

const SH = {
  RAW: 'Raw_Daily', RULES: 'Rules', LISTS: 'Lists', DASH: 'Dashboard',
  HIST: 'History', DQ: 'Data_Quality', REP: 'Repeated_Orders'
};
const DAY_TAB_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 45;          // أقصى عدد أيام سابقة تُقرأ لحساب التكرار والتبليغات
const DAY_TAB_INSERT_INDEX = 2;   // موضع التابات اليومية (بعد Dashboard و Repeated_Orders)

// أعمدة تاب اليوم (رقم العمود)
const W = {
  DATE: 1, AWB: 2, BRANCH: 3, REGION: 4, REP: 5, STATUS: 6, AREA: 7, SENDER: 8, COD: 9,
  PICK: 10, LAST: 11, O_AGE: 12, CO_THR: 13, CS_THR: 14, C_AGE: 15, C_THR: 16, TYPE: 17,
  STREAK: 18, PRIORITY: 19, PREV: 20, NOTIF: 21, ACTION: 22, NOTE: 23, ACT_TIME: 24
};
const DAY_HEADERS = ['تاريخ التقرير', 'رقم البوليصة', 'الفرع', 'الإقليم', 'المندوب (العهدة)', 'حالة الشحنة',
  'المنطقة', 'التاجر', 'مبلغ التحصيل', 'تاريخ البيك أب', 'تاريخ آخر حالة', 'عمر الأوردر', 'حد الشركة',
  'حد خدمة العملاء', 'عمر الحالة', 'حد الحالة', 'نوع التأخر', 'أيام متتالية', 'الأولوية',
  'آخر تبليغ/إجراء سابق', 'نوع التبليغ', 'الإجراء', 'ملاحظة', 'وقت الإجراء'];
// اللوحة الجانبية في تاب اليوم: إجمالي الشحنات وإجمالي كل فرع (يقرأها Dashboard)
const SIDE = { LABEL_COL: 26, VAL_COL: 27, FIRST_ROW: 4 };   // Z و AA

const REP_HEADERS = ['رقم البوليصة', 'الفرع', 'الإقليم', 'حالة الشحنة', 'نوع التأخر', 'أيام متتالية',
  'أول ظهور', 'حالة التبليغ', 'عدد التبليغات', 'آخر نوع تبليغ', 'تاريخ آخر تبليغ', 'آخر إجراء'];

const REGION_COL_HEADER = 'الإقليم (تلقائي)';
const DEFAULT_NOTIF_ACTION = 'تم التبليغ';   // يُكتب تلقائياً لو اختير نوع تبليغ بدون إجراء (موجود في Lists)

const RAW_REQ = {
  awb: 'رقم البوليصة', sender: 'الراسل', area: 'المنطقة', cod: 'مبلغ التحصيل',
  pick: 'تاريخ استلام البيك أب', status: 'حالة الشحنة', rep: 'عهدة العضو',
  branch: 'فرع العضو', last: 'تاريخ اخر حالة'
};
const RAW_REPORT_DATE_NAMES = ['تاريخ التقرير', 'تاريخ اخر حالة.1'];
const OUTLIER_AGE = 45;

const RULES_BRANCH_FIRST_ROW = 13, RULES_BRANCH_LAST_ROW = 52;   // A:D
const RULES_STATUS_FIRST_ROW = 13, RULES_STATUS_LAST_ROW = 100;  // F:H

/* ============================== القائمة والإعداد ============================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🔎 الأوديت اليومي')
    .addItem('🔄 تحديث (تشغيل الأوديت اليومي)', 'runDailyAudit')
    .addSeparator()
    .addItem('⚙ تفعيل تسجيل وقت الإجراء (مرة واحدة)', 'setupTriggers')
    .addItem('🎨 إعادة تطبيق القوائم والتنسيق على التاب الحالي', 'reapplyFormatting')
    .addSeparator()
    .addItem('🛠 تهيئة الشيت للإصدار 3 (مرة واحدة)', 'setupWorkbook')
    .addToUi();
}

/** يُنشئ Trigger من نوع onEdit (installable) ليسجل وقت الإجراء. شغّله مرة واحدة. */
function setupTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'onEditInstalled') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert('تم تفعيل تسجيل وقت الإجراء في تابات الأيام.');
}

/* ============================== التشغيل اليومي ============================== */

function runDailyAudit() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const rawSh = mustSheet_(ss, SH.RAW);
    const raw = rawSh.getDataRange().getValues();
    if (raw.length < 2) { ui.alert('Raw_Daily فاضية. الصق تصدير اليوم (بالعناوين) ثم أعد التشغيل.'); return; }
    const cols = findRawCols_(raw[0]);
    if (cols.missing.length) { ui.alert('أعمدة ناقصة في Raw_Daily:\n' + cols.missing.join('\n')); return; }

    const rules = readRules_(ss);
    if (!Object.keys(rules.branch).length) { ui.alert('جدول الفروع في Rules فاضي.'); return; }
    const reportDay = resolveReportDay_(rules, raw, cols);
    const tabName = dayToISO_(reportDay);

    // 1) الإقليم التلقائي داخل Raw_Daily
    writeRegionColumn_(rawSh, raw, cols, rules);

    // 2) الحساب (دالة نقية قابلة للاختبار)
    const res = computeWorklist_(raw.slice(1), cols, rules, reportDay);

    // 3) الأيام السابقة (تابات) + تاب اليوم لو موجود (لاسترجاع التبليغات المكتوبة)
    const prior = listDayTabs_(ss).filter(t => t.day < reportDay).slice(0, HISTORY_DAYS)
      .map(t => ({ day: t.day, map: readDayMap_(ss.getSheetByName(t.name)) }));
    const existing = ss.getSheetByName(tabName);
    const todayMap = existing ? readDayMap_(existing) : {};
    const hist = analysePrior_(prior);

    // 4) أيام متتالية + آخر تبليغ سابق + الأولوية + فرز
    res.items.forEach(it => {
      const p = hist.prevStreak[it.awb];
      it.streak = p ? p + 1 : 1;
      it.prev = hist.lastAction[it.awb] || '';
      it.priority = priorityOf_(it, rules);
    });
    sortItems_(res.items);

    // 5) تاب اليوم
    writeDayTab_(ss, tabName, res, reportDay, todayMap);

    // 6) الأوردرات المتكررة
    const repRows = buildRepeated_(res.items, prior, todayMap, reportDay, rules);
    writeRepeated_(ss, repRows);

    // 7) History + Dashboard + Data_Quality
    upsertHistory_(ss, reportDay, res.total, tabName);
    const dash = ss.getSheetByName(SH.DASH);
    if (dash) dash.getRange('B2').setValue(dayToDate_(reportDay));
    writeDq_(ss, res.dq);

    SpreadsheetApp.flush();
    const c = res.counts;
    ui.alert('تم التحديث — تاب ' + tabName +
      '\nإجمالي الشحنات: ' + res.total +
      '\nللمتابعة (فريد): ' + res.items.length +
      '\n  حالة متأخرة: ' + c.caseLate + ' | أوردر متأخر (الشركة): ' + c.coLate +
      ' | تبليغ خدمة عملاء: ' + c.csLate +
      '\nأوردرات متكررة: ' + repRows.length +
      '\nملاحظات جودة البيانات: ' + res.dq.length + ' (راجع Data_Quality)');
  } finally {
    lock.releaseLock();
  }
}

/* ============================== الحساب (دوال نقية) ============================== */

function normHeader_(h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim(); }

function findRawCols_(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => { const k = normHeader_(h); if (k && !(k in idx)) idx[k] = i; });
  const cols = { missing: [] };
  Object.keys(RAW_REQ).forEach(key => {
    const name = normHeader_(RAW_REQ[key]);
    if (name in idx) cols[key] = idx[name]; else cols.missing.push(RAW_REQ[key]);
  });
  cols.report = -1;
  for (const n of RAW_REPORT_DATE_NAMES) { if (n in idx) { cols.report = idx[n]; break; } }
  cols.region = (normHeader_(REGION_COL_HEADER) in idx) ? idx[normHeader_(REGION_COL_HEADER)] : -1;
  return cols;
}

/** رقم اليوم (أيام منذ 1970) من Date أو نص yyyy-mm-dd أو d/m/yyyy أو رقم تسلسلي. null لو غير صالح. */
function dayNum_(d) {
  if (d instanceof Date) {
    return isNaN(d) ? null : Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }
  if (typeof d === 'number') return d > 20000 ? Math.round(d) - 25569 : null;
  if (typeof d === 'string') {
    const s = d.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // يوم/شهر/سنة (الصيغة المصرية)
    if (m) return Math.round(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5);
  }
  return null;
}
function dayToISO_(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
function dayToDate_(n) { const u = new Date(n * 864e5); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }

function readRules_(ss) {
  const v = mustSheet_(ss, SH.RULES).getRange(1, 1, RULES_STATUS_LAST_ROW, 8).getValues();
  const yes = x => normHeader_(x) !== 'لا';
  const rules = {
    reportDate: v[2][1], defCase: Number(v[3][1]) || 3, hi: Number(v[4][1]) || 7,
    mid: Number(v[5][1]) || 3, streakN: Number(v[6][1]) || 3,
    ge: yes(v[7][1]),                 // نعم (الافتراضي) = التأخر يبدأ عند الحد نفسه
    repOnlyNotified: yes(v[8][1]),    // نعم (الافتراضي) = المتكرر الذي سبق تبليغه فقط
    branch: {}, status: {}
  };
  for (let r = RULES_BRANCH_FIRST_ROW - 1; r < RULES_BRANCH_LAST_ROW; r++) {   // A:D
    const b = normHeader_(v[r][0]);
    if (!b) continue;
    rules.branch[b] = { region: normHeader_(v[r][1]), co: Number(v[r][2]) || null, cs: Number(v[r][3]) || null };
  }
  for (let r = RULES_STATUS_FIRST_ROW - 1; r < RULES_STATUS_LAST_ROW; r++) {  // F:H
    const s = normHeader_(v[r][5]);
    if (!s) continue;
    const thr = v[r][6] === '' || v[r][6] == null ? rules.defCase : Number(v[r][6]);
    rules.status[s] = { thr: thr, include: normHeader_(v[r][7]) !== 'لا' };
  }
  return rules;
}

function resolveReportDay_(rules, raw, cols) {
  const fromRules = dayNum_(rules.reportDate);
  if (fromRules != null) return fromRules;
  if (cols.report >= 0) {
    for (let i = 1; i < raw.length; i++) { const d = dayNum_(raw[i][cols.report]); if (d != null) return d; }
  }
  return dayNum_(new Date());
}

function isLate_(age, thr, ge) {
  if (age == null || thr == null || thr === '') return false;
  return ge ? age >= thr : age > thr;
}

/** الإقليم لكل صف في Raw (بالترتيب نفسه) — للكتابة في عمود الإقليم التلقائي. */
function regionsFor_(rows, cols, rules) {
  return rows.map(r => {
    const b = normHeader_(r[cols.branch]);
    return rules.branch[b] ? rules.branch[b].region : '';
  });
}

/** rows: صفوف Raw (بدون العناوين). تُرجع {items, total, counts, dq, branchTotals} */
function computeWorklist_(rows, cols, rules, reportDay) {
  const items = [], dq = [], seen = {}, branchTotals = {};
  const counts = { caseLate: 0, coLate: 0, csLate: 0 };
  let total = 0, repPrefix = 0;
  const unknownBranch = {}, unknownStatus = {};

  rows.forEach(r => {
    const awb = normHeader_(r[cols.awb]);
    if (!awb) return;
    const branch = normHeader_(r[cols.branch]);
    if (seen[awb]) { dq.push(['بوليصة مكررة', awb, branch, 'تكررت في Raw_Daily — تم تجاهل التكرار']); return; }
    seen[awb] = true;
    total++;
    const bKey = branch || '(بدون فرع)';
    branchTotals[bKey] = (branchTotals[bKey] || 0) + 1;
    if (!branch) dq.push(['فرع فارغ', awb, '', '']);
    const rep = normHeader_(r[cols.rep]);
    if (rep.indexOf('ااا') === 0) repPrefix++;

    const pick = dayNum_(r[cols.pick]), last = dayNum_(r[cols.last]);
    if (pick == null) dq.push(['تاريخ بيك أب غير صالح', awb, branch, String(r[cols.pick])]);
    if (last == null) dq.push(['تاريخ آخر حالة غير صالح', awb, branch, String(r[cols.last])]);
    const status = normHeader_(r[cols.status]);

    let oAge = pick == null ? null : reportDay - pick;
    let cAge = last == null ? null : reportDay - last;
    if (oAge != null && oAge < 0) { dq.push(['تاريخ بيك أب بعد تاريخ التقرير', awb, branch, String(oAge)]); oAge = null; }
    if (cAge != null && cAge < 0) { dq.push(['تاريخ آخر حالة بعد تاريخ التقرير', awb, branch, String(cAge)]); cAge = null; }
    if (oAge != null && oAge > OUTLIER_AGE) dq.push(['عمر أوردر شاذ (>' + OUTLIER_AGE + ' يوم)', awb, branch, oAge + ' يوم — الحالة: ' + status]);

    const b = rules.branch[branch];
    if (!b && !unknownBranch[branch]) { unknownBranch[branch] = 1; dq.push(['فرع غير معرّف في Rules (لم يُحسب عمر الأوردر)', awb, branch, branch || '(فارغ)']); }
    const coThr = b ? b.co : null, csThr = b ? b.cs : null;

    let sRule = rules.status[status];
    if (!sRule) {
      if (!unknownStatus[status]) { unknownStatus[status] = 1; dq.push(['حالة شحنة غير معرّفة في Rules (استُخدم الحد الافتراضي)', awb, branch, status || '(فارغ)']); }
      sRule = { thr: rules.defCase, include: true };
    }

    const coLate = isLate_(oAge, coThr, rules.ge);
    // تبليغ خدمة العملاء نافذة قبل حد الشركة فقط: يختفي بمجرد أن يصبح الأوردر متأخراً للشركة
    const csLate = !coLate && isLate_(oAge, csThr, rules.ge);
    const cLate = sRule.include && isLate_(cAge, sRule.thr, rules.ge);
    if (!coLate && !csLate && !cLate) return;

    const flags = [];
    if (csLate) { flags.push('خدمة عملاء'); counts.csLate++; }
    if (coLate) { flags.push('أوردر'); counts.coLate++; }
    if (cLate) { flags.push('حالة'); counts.caseLate++; }
    const over = [];
    if (csLate) over.push(oAge - csThr);
    if (coLate) over.push(oAge - coThr);
    if (cLate) over.push(cAge - sRule.thr);
    items.push({
      awb: awb, branch: branch, region: b ? b.region : '', rep: rep, status: status, area: normHeader_(r[cols.area]),
      sender: normHeader_(r[cols.sender]), cod: Number(r[cols.cod]) || 0, pick: pick, last: last,
      oAge: oAge, coThr: coThr, csThr: csThr, cAge: cAge, cThr: sRule.include ? sRule.thr : '',
      type: flags.join(' + '), overdue: Math.max.apply(null, over)
    });
  });

  if (repPrefix) dq.push(['أسماء مناديب غير موحدة', '', '', repPrefix + ' صف اسم العهدة فيه يبدأ بـ "ااا" — يفضل توحيد الأسماء في النظام']);
  return { items: items, total: total, counts: counts, dq: dq, branchTotals: branchTotals };
}

function priorityOf_(it, rules) {
  if (it.streak >= rules.streakN || it.overdue >= rules.hi) return 'عالية';
  if (it.overdue >= rules.mid) return 'متوسطة';
  return 'عادية';
}
const PRIORITY_RANK = { 'عالية': 0, 'متوسطة': 1, 'عادية': 2 };

// الأوردر المتأخر للشركة أولاً، ثم تبليغ خدمة العملاء، ثم تأخر الحالة؛ وداخل كل نوع بالأولوية ثم أيام التجاوز
const typeRank_ = it => (it.type.indexOf('أوردر') >= 0 ? 0 : (it.type.indexOf('خدمة') >= 0 ? 1 : 2));
function sortItems_(items) {
  items.sort((a, b) =>
    (typeRank_(a) - typeRank_(b)) ||
    (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) ||
    (b.overdue - a.overdue) || (b.streak - a.streak) ||
    (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
}

/**
 * prior: [{day, map}] مرتبة من الأحدث للأقدم، map[awb] = {streak, notif, action, note, time}
 * يُرجع: prevStreak (من آخر يوم سابق) و lastAction (آخر تبليغ/إجراء سابق لكل بوليصة).
 */
function analysePrior_(prior) {
  const prevStreak = {}, lastAction = {};
  if (prior.length) {
    const m = prior[0].map;
    Object.keys(m).forEach(awb => { prevStreak[awb] = Number(m[awb].streak) || 1; });
  }
  prior.forEach(p => {                     // الأحدث أولاً: أول ما نلاقيه هو الأحدث
    Object.keys(p.map).forEach(awb => {
      if (lastAction[awb]) return;
      const e = p.map[awb];
      if (e.notif || e.action) {
        lastAction[awb] = (e.notif ? e.notif + ' — ' : '') + (e.action || '') + ' (' + dayToISO_(p.day) + ')';
      }
    });
  });
  return { prevStreak: prevStreak, lastAction: lastAction };
}

/**
 * الأوردرات المتكررة: شحنة ظهرت متأخرة في أيام متتالية (streak ≥ 2).
 * حالة التبليغ من التبليغات المسجلة في تابات الأيام السابقة واليوم.
 */
function buildRepeated_(items, prior, todayMap, reportDay, rules) {
  const out = [];
  items.forEach(it => {
    if (it.streak < 2) return;
    const chain = [];                       // الأيام السابقة المتصلة (الأحدث أولاً)
    for (let i = 0; i < prior.length; i++) {
      if (prior[i].map[it.awb]) chain.push(prior[i]); else break;
    }
    const entries = [];                     // من الأقدم للأحدث
    chain.slice().reverse().forEach(p => entries.push({ day: p.day, e: p.map[it.awb] }));
    const t = todayMap[it.awb];
    if (t) entries.push({ day: reportDay, e: t });
    const notified = entries.filter(x => x.e.notif);
    if (rules.repOnlyNotified && !notified.length) return;
    const last = notified.length ? notified[notified.length - 1] : null;
    const firstDay = chain.length ? chain[chain.length - 1].day : reportDay;
    out.push([
      it.awb, it.branch, it.region, it.status, it.type, it.streak, dayToDate_(firstDay),
      notified.length ? 'اتبلّغ' : 'لم يُبلَّغ', notified.length,
      last ? last.e.notif : '', last ? dayToDate_(last.day) : '', last ? last.e.action : ''
    ]);
  });
  out.sort((a, b) => b[5] - a[5]);
  return out;
}

/* ============================== التابات اليومية ============================== */

function listDayTabs_(ss) {
  const out = [];
  ss.getSheets().forEach(sh => {
    if (DAY_TAB_RE.test(sh.getName())) out.push({ name: sh.getName(), day: dayNum_(sh.getName()) });
  });
  return out.sort((a, b) => b.day - a.day);
}

/** يقرأ تاب يوم: awb → {streak, notif, action, note, time} */
function readDayMap_(sh) {
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, W.ACT_TIME).getValues();
  v.forEach(r => {
    const awb = r[W.AWB - 1];
    if (!awb) return;
    map[awb] = {
      streak: r[W.STREAK - 1], notif: r[W.NOTIF - 1], action: r[W.ACTION - 1],
      note: r[W.NOTE - 1], time: r[W.ACT_TIME - 1]
    };
  });
  return map;
}

function writeDayTab_(ss, name, res, reportDay, todayMap) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, Math.min(DAY_TAB_INSERT_INDEX, ss.getSheets().length));
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setRightToLeft(true);

  sh.getRange(1, 1, 1, DAY_HEADERS.length).setValues([DAY_HEADERS]);
  const dayDate = dayToDate_(reportDay);
  const rows = res.items.map(it => {
    const sd = todayMap[it.awb] || {};
    return [dayDate, it.awb, it.branch, it.region, it.rep, it.status, it.area, it.sender, it.cod,
      it.pick == null ? '' : dayToDate_(it.pick), it.last == null ? '' : dayToDate_(it.last),
      it.oAge == null ? '' : it.oAge, it.coThr == null ? '' : it.coThr, it.csThr == null ? '' : it.csThr,
      it.cAge == null ? '' : it.cAge, it.cThr, it.type, it.streak, it.priority, it.prev,
      sd.notif || '', sd.action || '', sd.note || '', sd.time || ''];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, DAY_HEADERS.length).setValues(rows);

  // اللوحة الجانبية: إجمالي الشحنات وإجمالي كل فرع
  sh.getRange(1, SIDE.LABEL_COL, 1, 2).setValues([['إجمالي الشحنات', res.total]]);
  sh.getRange(SIDE.FIRST_ROW - 1, SIDE.LABEL_COL, 1, 2).setValues([['الفرع', 'إجمالي الشحنات']]);
  const bt = Object.keys(res.branchTotals).map(k => [k, res.branchTotals[k]]).sort((a, b) => b[1] - a[1]);
  if (bt.length) sh.getRange(SIDE.FIRST_ROW, SIDE.LABEL_COL, bt.length, 2).setValues(bt);
  sh.getRange(1, SIDE.LABEL_COL, 1, 2).setFontWeight('bold');
  sh.getRange(SIDE.FIRST_ROW - 1, SIDE.LABEL_COL, 1, 2).setFontWeight('bold').setBackground('#D9E2F3');

  applyDayFormat_(sh, rows.length);
}

function applyDayFormat_(sh, n) {
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  sh.getRange(1, 1, 1, DAY_HEADERS.length).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setWrap(true);
  const maxRows = Math.max(n + 1, 2000);
  [W.DATE, W.PICK, W.LAST].forEach(c => sh.getRange(2, c, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd'));
  sh.getRange(2, W.ACT_TIME, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(2, W.COD, maxRows - 1, 1).setNumberFormat('#,##0');
  const lists = SpreadsheetApp.getActive().getSheetByName(SH.LISTS);
  sh.getRange(2, W.ACTION, maxRows - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(lists.getRange('A2:A30'), true)
      .setAllowInvalid(false).setHelpText('اختر الإجراء من القائمة، والتفاصيل في عمود ملاحظة').build());
  sh.getRange(2, W.NOTIF, maxRows - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(lists.getRange('C2:C10'), true)
      .setAllowInvalid(false).setHelpText('نوع التبليغ: خدمة عملاء / فروع داخلية / فروع خارجية').build());
  const pr = sh.getRange(2, W.PRIORITY, maxRows - 1, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('عالية').setBackground('#F8CBAD').setFontColor('#9C0006').setRanges([pr]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('متوسطة').setBackground('#FFE699').setRanges([pr]).build()
  ]);
  sh.getRange(2, W.NOTIF, maxRows - 1, 3).setBackground('#FFF2CC');
  sh.getRange(1, 1, Math.max(n + 1, 2), DAY_HEADERS.length).createFilter();
}

/* ============================== باقي الكتابة ============================== */

function writeRegionColumn_(rawSh, raw, cols, rules) {
  const regions = regionsFor_(raw.slice(1), cols, rules).map(x => [x]);
  const colIdx = cols.region >= 0 ? cols.region : raw[0].length;   // 0-based
  rawSh.getRange(1, colIdx + 1).setValue(REGION_COL_HEADER).setFontWeight('bold').setBackground('#E2EFDA');
  rawSh.getRange(2, colIdx + 1, regions.length, 1).setValues(regions);
}

function writeRepeated_(ss, rows) {
  const sh = ss.getSheetByName(SH.REP) || ss.insertSheet(SH.REP);
  sh.clearContents();
  sh.getRange(1, 1, 1, REP_HEADERS.length).setValues([REP_HEADERS])
    .setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF').setWrap(true);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, REP_HEADERS.length).setValues(rows);
    sh.getRange(2, 7, rows.length, 1).setNumberFormat('yyyy-mm-dd');
    sh.getRange(2, 11, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  }
  sh.setFrozenRows(1);
  sh.setRightToLeft(true);
}

function upsertHistory_(ss, reportDay, total, tabName) {
  const sh = mustSheet_(ss, SH.HIST);
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 6).setValues([['تاريخ التقرير', 'إجمالي الشحنات', 'للمتابعة', 'تم التعامل', 'نسبة المتابعة', 'نسبة التغطية']]);
  let row = -1;
  if (sh.getLastRow() > 1) {
    const d = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < d.length; i++) if (dayNum_(d[i][0]) === reportDay) { row = i + 2; break; }
  }
  if (row < 0) row = Math.max(sh.getLastRow(), 1) + 1;
  const q = "'" + tabName + "'!";
  sh.getRange(row, 1, 1, 2).setValues([[dayToDate_(reportDay), total]]);
  sh.getRange(row, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, 3, 1, 4).setFormulas([[
    '=COUNTA(' + q + 'B2:B20000)',
    '=COUNTIF(' + q + 'V2:V20000,"?*")',
    '=IFERROR(C' + row + '/B' + row + ',0)',
    '=IFERROR(D' + row + '/C' + row + ',0)']]);
  sh.getRange(row, 5, 1, 2).setNumberFormat('0.0%');
}

function writeDq_(ss, dq) {
  const sh = ss.getSheetByName(SH.DQ) || ss.insertSheet(SH.DQ);
  sh.clearContents();
  sh.getRange(1, 1, 1, 4).setValues([['نوع الملاحظة', 'رقم البوليصة', 'الفرع', 'التفاصيل']])
    .setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
  if (dq.length) sh.getRange(2, 1, dq.length, 4).setValues(dq);
  sh.setFrozenRows(1);
}

/* ============================== تسجيل وقت الإجراء (onEdit) ============================== */

function onEditInstalled(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (!DAY_TAB_RE.test(sh.getName())) return;
  const r0 = e.range.getRow(), c0 = e.range.getColumn();
  const nr = e.range.getNumRows(), nc = e.range.getNumColumns();
  if (r0 < 2 || c0 > W.NOTE || c0 + nc - 1 < W.NOTIF) return;

  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const now = new Date();
    const block = sh.getRange(r0, 1, nr, W.ACT_TIME).getValues();
    block.forEach((row, i) => {
      const r = r0 + i;
      if (!row[W.AWB - 1]) return;
      const notif = row[W.NOTIF - 1], note = row[W.NOTE - 1];
      let action = row[W.ACTION - 1];
      if (notif && !action) {                       // اختير نوع تبليغ بدون إجراء ← "تم التبليغ"
        action = DEFAULT_NOTIF_ACTION;
        sh.getRange(r, W.ACTION).setValue(action);
      }
      const hasEntry = !!(action || note || notif);
      const prevTime = row[W.ACT_TIME - 1];
      sh.getRange(r, W.ACT_TIME).setValue(hasEntry ? (prevTime instanceof Date ? prevTime : now) : '');
    });
  } finally {
    lock.releaseLock();
  }
}

function reapplyFormatting() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!DAY_TAB_RE.test(sh.getName())) {
    SpreadsheetApp.getUi().alert('افتح تاب يوم (اسمه تاريخ) ثم أعد المحاولة.');
    return;
  }
  if (sh.getFilter()) sh.getFilter().remove();
  applyDayFormat_(sh, Math.max(sh.getLastRow() - 1, 0));
  SpreadsheetApp.getUi().alert('تم تطبيق القوائم والتنسيق.');
}


/* ============================== تهيئة شيت قديم للإصدار 3 ============================== */

const OBSOLETE_SHEETS = ['Worklist', 'Audit_Log', 'Employees', 'Run_Info'];

/**
 * يجهّز شيتًا أُنشئ من الإصدار 2: يعيد بناء Dashboard (يقرأ من تاب اليوم) ويفرّغ History،
 * ويحدّث README، ثم يسأل قبل حذف الأوراق القديمة. لا يلمس Rules ولا Lists ولا Raw_Daily.
 */
function setupWorkbook() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const rules = ss.getSheetByName(SH.RULES), lists = ss.getSheetByName(SH.LISTS);
  if (!rules || !lists || !ss.getSheetByName(SH.RAW)) {
    ui.alert('لازم تكون أوراق Rules و Lists و Raw_Daily موجودة. لم يتم أي تغيير.');
    return;
  }
  const okRules = normHeader_(rules.getRange('F12').getValue()) === 'حالة الشحنة' &&
    normHeader_(rules.getRange('A12').getValue()).indexOf('الفرع') === 0;
  if (!okRules) { ui.alert('شكل ورقة Rules مختلف عن المتوقع (جدول الفروع A12:D52 وجدول الحالات F12:H100). لم يتم أي تغيير.'); return; }
  const lv = lists.getRange('A2:A30').getValues().map(r => normHeader_(r[0]));
  if (lv.indexOf(DEFAULT_NOTIF_ACTION) < 0) lists.getRange(2 + lv.filter(Boolean).length, 1).setValue(DEFAULT_NOTIF_ACTION);

  const go = ui.alert('تهيئة الإصدار 3',
    'سيتم: إعادة بناء Dashboard، تفريغ History، تحديث README، وإنشاء Repeated_Orders و Data_Quality إن لم يوجدا.\n' +
    'لن يتم لمس Rules و Lists و Raw_Daily.\n\nهل تتابع؟', ui.ButtonSet.YES_NO);
  if (go !== ui.Button.YES) return;

  // History: تفريغ البيانات (معادلاتها القديمة تشير لأوراق ستُحذف)
  const hist = ss.getSheetByName(SH.HIST) || ss.insertSheet(SH.HIST);
  hist.clear();
  hist.getRange(1, 1, 1, 6).setValues([['تاريخ التقرير', 'إجمالي الشحنات', 'للمتابعة', 'تم التعامل', 'نسبة المتابعة', 'نسبة التغطية']])
    .setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
  hist.setRightToLeft(true);

  // Repeated_Orders / Data_Quality
  writeRepeated_(ss, []);
  writeDq_(ss, []);

  // Dashboard
  let dash = ss.getSheetByName(SH.DASH);
  if (!dash) dash = ss.insertSheet(SH.DASH, 0);
  buildDashboard_(dash, hist);

  // ترتيب الأوراق: Dashboard ثم Repeated_Orders
  ss.setActiveSheet(dash); ss.moveActiveSheet(1);
  ss.setActiveSheet(ss.getSheetByName(SH.REP)); ss.moveActiveSheet(2);
  ss.setActiveSheet(dash);

  writeReadme_(ss);

  // حذف الأوراق القديمة بعد التأكيد
  const found = OBSOLETE_SHEETS.filter(n => ss.getSheetByName(n));
  let deleted = [];
  if (found.length) {
    const del = ui.alert('حذف الأوراق القديمة',
      'الأوراق التالية لم تعد مستخدمة في الإصدار 3:\n' + found.join('، ') +
      '\n\nلو كتبت فيها تبليغات تريد الاحتفاظ بها، انسخها أولاً.\nهل أحذفها الآن؟', ui.ButtonSet.YES_NO);
    if (del === ui.Button.YES) found.forEach(n => { ss.deleteSheet(ss.getSheetByName(n)); deleted.push(n); });
  }
  ui.alert('تمت التهيئة.' + (deleted.length ? '\nتم حذف: ' + deleted.join('، ') : '') +
    '\n\nالخطوة التالية: الصق تصدير اليوم في Raw_Daily ثم 🔄 تحديث.');
}

/** خلايا Dashboard كقيم/معادلات: [صف، عمود، محتوى، هل معادلة]. دالة نقية قابلة للاختبار. */
function dashboardCells_() {
  const T = col => 'INDIRECT("\'"&$B$3&"\'!' + col + '$2:' + col + '$20000")';
  const cells = [];
  const put = (r, c, v, f) => cells.push([r, c, v, !!f]);
  put(1, 1, 'لوحة الأوديت اليومية — عمر الحالة وعمر الأوردر (الشركة وخدمة العملاء)');
  put(2, 1, 'اليوم المعروض (اختر من القائمة)');
  put(3, 1, 'اسم التاب'); put(3, 2, '=TEXT(B2,"yyyy-mm-dd")', true);
  // كروت للإدارة: أنواع التأخر بدون تداخل + التبليغ والتصعيد + التحصيل المعرّض
  const kl = ['للمتابعة (فريد)', 'أوردر متأخر (الشركة)', 'خدمة عملاء (قبل حد الشركة)', 'حالة فقط',
    'أوردر/خدمة: لم يُبلَّغ بعد', 'أوردر/خدمة: اتبلّغ', 'متكرر بعد التبليغ', 'التحصيل المعرّض (ج.م)'];
  const kf = [
    '=IFERROR(COUNTA(' + T('B') + '),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*أوردر*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*خدمة*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"حالة"),0)',
    '=B6+C6-F6',
    '=IFERROR(COUNTIFS(' + T('Q') + ',"*أوردر*",' + T('U') + ',"?*")+COUNTIFS(' + T('Q') + ',"*خدمة*",' + T('U') + ',"?*"),0)',
    '=COUNTA(Repeated_Orders!A$2:A$20000)',
    '=IFERROR(SUMIF(' + T('Q') + ',"*أوردر*",' + T('I') + ')+SUMIF(' + T('Q') + ',"*خدمة*",' + T('I') + '),0)'];
  kl.forEach((l, i) => { put(5, i + 1, l); put(6, i + 1, kf[i], true); });
    put(7, 1, 'الأنواع الثلاثة (أوردر الشركة / خدمة العملاء / حالة فقط) لا تتداخل، ومجموعها = للمتابعة. الشحنة التي تجمع أوردراً وحالة تُحسب أوردراً. "لم يُبلَّغ بعد" = أوردر أو خدمة عملاء بلا نوع تبليغ مسجل. التحصيل المعرّض = مجموع مبلغ التحصيل لأوردرات الشركة وخدمة العملاء.');

  put(8, 1, 'أداء الفروع');
  ['الفرع', 'الإقليم', 'إجمالي الشحنات', 'حالة متأخرة', 'أوردر متأخر (الشركة)', 'تبليغ خدمة عملاء', 'للمتابعة (فريد)', 'نسبة المتابعة', 'تم التعامل', 'نسبة التغطية']
    .forEach((h, i) => put(9, i + 1, h));
  for (let r = 10; r < 40; r++) {
    const s = r - 6;   // Z4 ...
    const z = 'INDIRECT("\'"&$B$3&"\'!Z' + s + '")';
    const fs = [
      '=IFERROR(IF(' + z + '="","",' + z + '),"")',
      '=IF(A' + r + '="","",IFERROR(INDEX(Rules!$B$13:$B$52,MATCH(A' + r + ',Rules!$A$13:$A$52,0)),""))',
      '=IF(A' + r + '="","",INDIRECT("\'"&$B$3&"\'!AA' + s + '"))',
      '=IF(A' + r + '="","",COUNTIFS(' + T('C') + ',A' + r + ',' + T('Q') + ',"*حالة*"))',
      '=IF(A' + r + '="","",COUNTIFS(' + T('C') + ',A' + r + ',' + T('Q') + ',"*أوردر*"))',
      '=IF(A' + r + '="","",COUNTIFS(' + T('C') + ',A' + r + ',' + T('Q') + ',"*خدمة*"))',
      '=IF(A' + r + '="","",COUNTIF(' + T('C') + ',A' + r + '))',
      '=IF(A' + r + '="","",IFERROR(G' + r + '/C' + r + ',0))',
      '=IF(A' + r + '="","",COUNTIFS(' + T('C') + ',A' + r + ',' + T('V') + ',"?*"))',
      '=IF(A' + r + '="","",IFERROR(I' + r + '/G' + r + ',0))'];
    fs.forEach((f, i) => put(r, i + 1, f, true));
  }
  put(41, 1, 'حسب الإقليم');
  ['الإقليم', 'للمتابعة (فريد)', 'حالة متأخرة', 'أوردر متأخر (الشركة)', 'تبليغ خدمة عملاء'].forEach((h, i) => put(42, i + 1, h));
  ['القاهره و الاسكندريه', 'الدلتا و القنال', 'الصعيد'].forEach((rg, k) => {
    const r = 43 + k;
    put(r, 1, rg);
    put(r, 2, '=IFERROR(COUNTIF(' + T('D') + ',A' + r + '),0)', true);
    put(r, 3, '=IFERROR(COUNTIFS(' + T('D') + ',A' + r + ',' + T('Q') + ',"*حالة*"),0)', true);
    put(r, 4, '=IFERROR(COUNTIFS(' + T('D') + ',A' + r + ',' + T('Q') + ',"*أوردر*"),0)', true);
    put(r, 5, '=IFERROR(COUNTIFS(' + T('D') + ',A' + r + ',' + T('Q') + ',"*خدمة*"),0)', true);
  });
  put(47, 1, 'الأوردرات المتكررة حسب نوع التبليغ (آخر تحديث)');
  put(48, 1, 'نوع التبليغ'); put(48, 2, 'عدد الأوردرات المتكررة');
  for (let i = 0; i < 3; i++) {
    const r = 49 + i, lr = 2 + i;
    put(r, 1, '=IF(Lists!C' + lr + '="","",Lists!C' + lr + ')', true);
    put(r, 2, '=IF(A' + r + '="","",COUNTIF(Repeated_Orders!J$2:J$20000,A' + r + '))', true);
  }
  put(52, 1, 'متكرر لم يُبلَّغ'); put(52, 2, '=COUNTIF(Repeated_Orders!H$2:H$20000,"لم يُبلَّغ")', true);
  return cells;
}

function buildDashboard_(dash, hist) {
  const prevDate = dash.getRange('B2').getValue();
  dash.getCharts().forEach(c => dash.removeChart(c));
  dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns()).breakApart();
  dash.clear();
  dash.clearConditionalFormatRules();
  dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns()).clearDataValidations();
  dash.setRightToLeft(true);

  dashboardCells_().forEach(c => {
    const cell = dash.getRange(c[0], c[1]);
    if (c[3]) cell.setFormula(c[2]); else cell.setValue(c[2]);
  });
  const HF = '#1F3864';
  const hdr = rg => rg.setFontWeight('bold').setBackground(HF).setFontColor('#FFFFFF').setHorizontalAlignment('center').setWrap(true);
  dash.getRange('A1:J1').merge().setFontWeight('bold').setFontSize(16).setFontColor('#FFFFFF').setBackground(HF)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  dash.setRowHeight(1, 34);
  // اليوم المعروض
  const b2 = dash.getRange('B2');
  b2.setValue(prevDate instanceof Date ? prevDate : '').setNumberFormat('yyyy-mm-dd').setBackground('#FFF2CC').setFontColor('#0000FF').setFontWeight('bold');
  b2.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(hist.getRange('A2:A400'), true).setAllowInvalid(true).build());
  dash.getRange('A2').setFontWeight('bold');
  dash.getRange('A3:B3').setFontColor('#7F7F7F');
  // KPIs
  const kl = dash.getRange('A5:H5').setFontWeight('bold').setBackground('#D9E2F3').setHorizontalAlignment('center').setWrap(true);
  dash.setRowHeight(5, 32);
  dash.getRange('A6:H6').setFontWeight('bold').setFontSize(16).setFontColor(HF).setHorizontalAlignment('center').setNumberFormat('#,##0');
  dash.setRowHeight(6, 30);
  dash.getRange('A7').setFontStyle('italic').setFontColor('#7F7F7F').setFontSize(9);
  ['A8', 'A41', 'A47'].forEach(a => dash.getRange(a).setFontWeight('bold').setFontSize(13).setFontColor(HF));
  hdr(dash.getRange('A9:J9')); dash.setRowHeight(9, 32);
  dash.getRange('C10:J39').setNumberFormat('#,##0'); dash.getRange('H10:H39').setNumberFormat('0.0%'); dash.getRange('J10:J39').setNumberFormat('0.0%');
  hdr(dash.getRange('A42:E42')); hdr(dash.getRange('A48:B48'));
  dash.getRange('A10:J39').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A43:E45').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A49:B52').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A5:H6').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.setColumnWidth(1, 220); dash.setColumnWidths(2, 9, 120);

  try {
    dash.insertChart(dash.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(dash.getRange('A10:A32')).addRange(dash.getRange('G10:G32'))
      .setPosition(8, 12, 0, 0).setOption('title', 'الشحنات للمتابعة حسب الفرع')
      .setOption('legend', { position: 'none' }).setOption('width', 620).setOption('height', 420).build());
    dash.insertChart(dash.newChart().setChartType(Charts.ChartType.LINE)
      .addRange(hist.getRange('A1:A60')).addRange(hist.getRange('C1:C60')).setNumHeaders(1)
      .setPosition(34, 12, 0, 0).setOption('title', 'اتجاه المتابعة (History)')
      .setOption('width', 620).setOption('height', 300).build());
  } catch (e) { /* الرسوم اختيارية؛ الجداول تعمل بدونها */ }
}

function writeReadme_(ss) {
  const sh = ss.getSheetByName('README') || ss.insertSheet('README');
  sh.clear(); sh.setRightToLeft(true);
  const lines = [
    'نظام الأوديت اليومي — ARRIVE (الإصدار 3: مراجع أوديت واحد، وتاب لكل يوم)', '',
    'التشغيل اليومي',
    '1) امسح Raw_Daily والصق تصدير اليوم (بالعناوين) من A1.',
    '2) القائمة: 🔎 الأوديت اليومي ← 🔄 تحديث. يُنشأ تاب باسم تاريخ اليوم فيه الشحنات المتأخرة فقط.',
    '3) في تاب اليوم اختر نوع التبليغ (خدمة عملاء / فروع داخلية / فروع خارجية) والإجراء واكتب الملاحظة (الأعمدة الصفراء).',
    '4) اختيار نوع تبليغ بدون إجراء يكتب "تم التبليغ" تلقائياً، ووقت الإجراء يُسجَّل تلقائياً بعد تفعيله مرة واحدة من القائمة.',
    '5) كل يوم تاب جديد، والتابات القديمة سجل الأيام. إعادة التحديث في نفس اليوم لا تمسح ما كتبته.',
    '6) Repeated_Orders: شحنات ظهرت متأخرة في أيام متتالية مع حالة تبليغها (Rules!B9 يتحكم في عرض المبلَّغ عنها فقط).',
    '7) Dashboard: اختر اليوم من الخلية B2. History: اتجاه الأيام.', '',
    'قواعد التأخر (تتعدل في Rules)',
    '• عمر الحالة = تاريخ التقرير − تاريخ آخر حالة، ويُقارن بحد كل حالة شحنة.',
    '• عمر الأوردر = تاريخ التقرير − تاريخ البيك أب، والحد حسب فرع العضو: حد الشركة وحد خدمة العملاء. الإقليم يُضاف تلقائياً.',
    '• التأخر يبدأ عند الحد نفسه (≥). غيّر Rules!B8 إلى "لا" ليبدأ بعد تجاوزه.', '',
    'لا تغيّر أسماء تابات الأيام ولا تحذفها إن أردت حفظ التكرار (يُقرأ آخر 45 يوماً).'];
  lines.forEach((t, i) => sh.getRange(i + 1, 1).setValue(t));
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 900);
}

function mustSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('الورقة غير موجودة: ' + name);
  return sh;
}
