/**
 * ARRIVE — نظام الأوديت اليومي (Daily Audit Control) — الإصدار 3.1
 * ---------------------------------------------------------------
 * مستخدم واحد: مراجع الأوديت.
 * الاستخدام اليومي:
 *   1) الصق تصدير اليوم (بالعناوين) في Raw_Daily من A1.
 *   2) 🔄 تحديث (تشغيل الأوديت اليومي):
 *        - يضيف عمود "الإقليم (تلقائي)" في Raw_Daily حسب فرع العضو (من Rules).
 *        - ينشئ تاب باسم تاريخ اليوم (yyyy-mm-dd) فيه **كل البوالص**:
 *          المتأخرة أولاً (بنوع التأخر)، ثم غير المتأخرة ونوعها "غير متأخر".
 *        - يحدّث Repeated_Orders (الأوردرات المتكررة + حالة التبليغ) وDashboard وHistory.
 *   3) في تاب اليوم: اختر نوع التبليغ والإجراء واكتب الملاحظة (الأعمدة الصفراء).
 *      وقت الإجراء يُسجَّل تلقائياً بعد تفعيل "تسجيل الإجراءات" مرة واحدة.
 *
 * الجديد في 3.1:
 *   - تاب اليوم ينزل فيه كل البوالص وليس المتأخر فقط. كل مؤشرات المتابعة والتكرار
 *     تُحسب على المتأخر فقط (نوع التأخر ≠ "غير متأخر").
 *   - إجمالي كل فرع يُحفظ في ورقة مستقلة Day_Totals، فلا يتأثر بحذف أو فرز صفوف تاب اليوم.
 *   - لحماية حجم الملف (حد Google Sheets = 10 مليون خلية): آخر KEEP_FULL_TABS تابات فقط
 *     تبقى كاملة؛ التابات الأقدم تُحذف منها صفوف "غير متأخر" التي لم يُسجَّل عليها شيء.
 *
 * تعديلات الكروت (إصدار الكروت الإدارية):
 *   - "للمتابعة" تحسب كل الصفوف حتى لو تكررت البوليصة في Raw_Daily (يُسجَّل التكرار في Data_Quality).
 *   - "حالة فقط" أُعيدت تسميتها "تأخير الحالة".
 *   - أُلغي كارت "التحصيل المعرّض" من لوحة الشيت.
 *
 * قواعد التأخر (قابلة للتعديل من ورقة Rules):
 *   عمر الحالة   = تاريخ التقرير − تاريخ آخر حالة   ← مقارنة بحد الحالة (لكل حالة شحنة)
 *   عمر الأوردر  = تاريخ التقرير − تاريخ البيك أب    ← مقارنة بحد الفرع (إقليم الفرع)
 *   أوردر متأخر (الشركة)   : عمر الأوردر ≥ حد الشركة للفرع
 *   تبليغ خدمة العملاء     : حد خدمة العملاء ≤ عمر الأوردر < حد الشركة (يختفي عند تجاوز حد الشركة)
 *   التأخر يبدأ عند الحد نفسه (≥) إذا كانت Rules!B8 = "نعم"، وعند تجاوزه (>) إذا "لا".
 *
 * تعديل المنطقة الزمنية (إصلاح إزاحة اليوم):
 *   كل التواريخ تُقرأ وتُكتب الآن بتوقيت الشيت (File > Settings > Time zone)
 *   بدل توقيت مشروع الـ Script، لمنع ظهور التاريخ متأخراً يوماً في الشيت.
 */

const SH = {
  RAW: 'Raw_Daily', RULES: 'Rules', LISTS: 'Lists', DASH: 'Dashboard',
  HIST: 'History', DQ: 'Data_Quality', REP: 'Repeated_Orders', TOT: 'Day_Totals'
};
const DAY_TAB_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 45;          // أقصى عدد أيام سابقة تُقرأ لحساب التكرار والتبليغات
const DAY_TAB_INSERT_INDEX = 2;   // موضع التابات اليومية (بعد Dashboard و Repeated_Orders)
const NOT_LATE = 'غير متأخر';     // نوع التأخر للشحنة التي لم تبلغ أي حد
const KEEP_FULL_TABS = 2;         // عدد أحدث التابات التي تبقى فيها كل البوالص (اليوم + السابق)

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
// اللوحة الجانبية في تاب اليوم (للعرض فقط؛ المصدر المعتمد للإجماليات هو ورقة Day_Totals)
const SIDE = { LABEL_COL: 26, VAL_COL: 27, FIRST_ROW: 4 };   // Z و AA
const TOT_HEADERS = ['اليوم', 'الفرع', 'إجمالي الشحنات'];

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
    .addItem('📊 تحديث معادلات Dashboard', 'patchDashboardMenu')
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

    // 2) الحساب (دالة نقية قابلة للاختبار) — يُرجع كل البوالص، وكل عنصر فيه late = متأخر أم لا
    const res = computeWorklist_(raw.slice(1), cols, rules, reportDay);

    // 3) الأيام السابقة (تابات) + تاب اليوم لو موجود (لاسترجاع التبليغات المكتوبة)
    const prior = listDayTabs_(ss).filter(t => t.day < reportDay).slice(0, HISTORY_DAYS)
      .map(t => ({ day: t.day, map: readDayMap_(ss.getSheetByName(t.name)) }));
    const existing = ss.getSheetByName(tabName);
    const todayMap = existing ? readDayMap_(existing) : {};
    const hist = analysePrior_(prior);

    // 4) أيام متتالية + آخر تبليغ سابق + الأولوية + فرز (المتأخر أولاً ثم غير المتأخر)
    const lateItems = finalizeItems_(res, hist, rules);

    // 5) إجمالي الفروع في Day_Totals ثم تاب اليوم
    writeDayTotals_(ss, tabName, res.branchTotals);
    writeDayTab_(ss, tabName, res, reportDay, todayMap);

    // 6) الأوردرات المتكررة (من المتأخر فقط)
    const repRows = buildRepeated_(lateItems, prior, todayMap, reportDay, rules);
    writeRepeated_(ss, repRows);

    // 7) History + Dashboard + Data_Quality
    upsertHistory_(ss, reportDay, res.total, tabName);
    const dash = ss.getSheetByName(SH.DASH);
    if (dash) { patchDashboard_(dash); dash.getRange('B2').setValue(dayToDate_(reportDay)); }
    writeDq_(ss, res.dq);

    // 8) تخفيف التابات الأقدم (حذف صفوف "غير متأخر" غير المستخدمة) وحذف الصفوف الفارغة الزائدة لحماية حجم الملف
    const compacted = compactOldTabs_(ss);
    trimDayTabs_(ss);

    SpreadsheetApp.flush();
    const c = res.counts;
    ui.alert('تم التحديث — تاب ' + tabName +
      '\nإجمالي الشحنات (كلها في التاب): ' + res.total +
      '\nللمتابعة: ' + lateItems.length +
      '\n  حالة متأخرة: ' + c.caseLate + ' | أوردر متأخر (الشركة): ' + c.coLate +
      ' | تبليغ خدمة عملاء: ' + c.csLate +
      '\nغير متأخر: ' + (res.items.length - lateItems.length) +
      '\nأوردرات متكررة: ' + repRows.length +
      '\nملاحظات جودة البيانات: ' + res.dq.length + ' (راجع Data_Quality)' +
      (compacted.length ? '\nتم تخفيف التابات: ' + compacted.join('، ') : ''));
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

/* ---------- التواريخ بتوقيت الشيت (إصلاح إزاحة اليوم) ---------- */

let TZ_CACHE_ = null;
/** المنطقة الزمنية للشيت (File > Settings)، وليس لمشروع الـ Script. */
function ssTz_() {
  return TZ_CACHE_ || (TZ_CACHE_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone());
}

/** رقم اليوم (أيام منذ 1970) من Date أو نص yyyy-mm-dd أو d/m/yyyy أو رقم تسلسلي. null لو غير صالح. */
function dayNum_(d) {
  if (d instanceof Date) {
    if (isNaN(d)) return null;
    const p = Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd').split('-');   // بتوقيت الشيت لا المشروع
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5);
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

const DATE_MEMO_ = {};
/** منتصف ليل اليوم n بتوقيت الشيت (يظهر في الشيت بنفس اليوم بدون إزاحة). */
function dayToDate_(n) {
  return DATE_MEMO_[n] || (DATE_MEMO_[n] = Utilities.parseDate(dayToISO_(n), ssTz_(), 'yyyy-MM-dd'));
}

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

/**
 * rows: صفوف Raw (بدون العناوين). تُرجع {items, total, counts, dq, branchTotals}
 * items فيها كل البوالص: المتأخرة (late = true) وغير المتأخرة (late = false، النوع "غير متأخر").
 * البوليصة المكررة في Raw تُحسب (كل صف يُحتسب) ويُسجَّل التكرار في Data_Quality.
 */
function computeWorklist_(rows, cols, rules, reportDay) {
  const items = [], dq = [], seen = {}, branchTotals = {};
  const counts = { caseLate: 0, coLate: 0, csLate: 0 };
  let total = 0, repPrefix = 0;
  const unknownBranch = {}, unknownStatus = {};

  rows.forEach(r => {
    const awb = normHeader_(r[cols.awb]);
    if (!awb) return;
    const branch = normHeader_(r[cols.branch]);
    if (seen[awb]) dq.push(['بوليصة مكررة', awb, branch, 'تكررت في Raw_Daily — تم احتسابها ضمن الشحنات']);
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
    const late = coLate || csLate || cLate;

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
      late: late, type: late ? flags.join(' + ') : NOT_LATE,
      overdue: late ? Math.max.apply(null, over) : null
    });
  });

  if (repPrefix) dq.push(['أسماء مناديب غير موحدة', '', '', repPrefix + ' صف اسم العهدة فيه يبدأ بـ "ااا" — يفضل توحيد الأسماء في النظام']);
  return { items: items, total: total, counts: counts, dq: dq, branchTotals: branchTotals };
}

/**
 * يكمل بيانات المتأخر (أيام متتالية، آخر تبليغ سابق، الأولوية) ويرتب res.items:
 * المتأخر أولاً بالترتيب المعتمد، ثم غير المتأخر. يُرجع قائمة المتأخر فقط.
 */
function finalizeItems_(res, hist, rules) {
  const lateItems = [], rest = [];
  res.items.forEach(it => {
    it.prev = hist.lastAction[it.awb] || '';
    if (it.late) {
      const p = hist.prevStreak[it.awb];
      it.streak = p ? p + 1 : 1;
      it.priority = priorityOf_(it, rules);
      lateItems.push(it);
    } else {
      it.streak = '';
      it.priority = '';
      rest.push(it);
    }
  });
  sortItems_(lateItems);
  rest.sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0) || ((b.oAge || 0) - (a.oAge || 0)));
  res.items = lateItems.concat(rest);
  return lateItems;
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
 * prior: [{day, map}] مرتبة من الأحدث للأقدم، map[awb] = {late, streak, notif, action, note, time}
 * يُرجع: prevStreak (من آخر يوم سابق، للمتأخر فقط) و lastAction (آخر تبليغ/إجراء سابق لكل بوليصة).
 */
function analysePrior_(prior) {
  const prevStreak = {}, lastAction = {};
  if (prior.length) {
    const m = prior[0].map;
    Object.keys(m).forEach(awb => { if (m[awb].late) prevStreak[awb] = Number(m[awb].streak) || 1; });
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
    if (!it.late || it.streak < 2) return;
    const chain = [];                       // الأيام السابقة المتصلة التي كانت فيها متأخرة (الأحدث أولاً)
    for (let i = 0; i < prior.length; i++) {
      const e = prior[i].map[it.awb];
      if (e && e.late) chain.push(prior[i]); else break;
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

/** يقرأ تاب يوم: awb → {late, streak, notif, action, note, time}. late = الشحنة كانت متأخرة في ذلك اليوم. */
function readDayMap_(sh) {
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, W.ACT_TIME).getValues();
  v.forEach(r => {
    const awb = r[W.AWB - 1];
    if (!awb) return;
    map[awb] = {
      late: normHeader_(r[W.TYPE - 1]) !== NOT_LATE,
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

  // اللوحة الجانبية (للعرض فقط): إجمالي الشحنات وإجمالي كل فرع. المصدر المعتمد = Day_Totals
  sh.getRange(1, SIDE.LABEL_COL, 1, 2).setValues([['إجمالي الشحنات', res.total]]);
  sh.getRange(SIDE.FIRST_ROW - 1, SIDE.LABEL_COL, 1, 2).setValues([['الفرع', 'إجمالي الشحنات']]);
  const bt = sortedBranchTotals_(res.branchTotals);
  if (bt.length) sh.getRange(SIDE.FIRST_ROW, SIDE.LABEL_COL, bt.length, 2).setValues(bt);
  sh.getRange(1, SIDE.LABEL_COL, 1, 2).setFontWeight('bold');
  sh.getRange(SIDE.FIRST_ROW - 1, SIDE.LABEL_COL, 1, 2).setFontWeight('bold').setBackground('#D9E2F3');

  applyDayFormat_(sh, rows.length);
}

function sortedBranchTotals_(branchTotals) {
  return Object.keys(branchTotals).map(k => [k, branchTotals[k]]).sort((a, b) => b[1] - a[1]);
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
  const ty = sh.getRange(2, W.TYPE, maxRows - 1, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('عالية').setBackground('#F8CBAD').setFontColor('#9C0006').setRanges([pr]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('متوسطة').setBackground('#FFE699').setRanges([pr]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(NOT_LATE).setFontColor('#7F7F7F').setRanges([ty]).build()
  ]);
  sh.getRange(2, W.NOTIF, maxRows - 1, 3).setBackground('#FFF2CC');
  sh.getRange(1, 1, Math.max(n + 1, 2), DAY_HEADERS.length).createFilter();
}

/**
 * يخفف التابات التي خرجت من نافذة KEEP_FULL_TABS: يحذف صفوف "غير متأخر" التي لم يُسجَّل
 * عليها نوع تبليغ ولا إجراء ولا ملاحظة. المتأخر وأي صف عليه تسجيل يبقى كما هو.
 * يُرجع أسماء التابات التي تم تخفيفها.
 */
function compactOldTabs_(ss) {
  const done = [];
  listDayTabs_(ss).slice(KEEP_FULL_TABS, KEEP_FULL_TABS + 3).forEach(t => {
    const sh = ss.getSheetByName(t.name);
    const last = sh.getLastRow();
    if (last < 2) return;
    const rng = sh.getRange(2, 1, last - 1, DAY_HEADERS.length);
    const kept = keepRowsOnCompact_(rng.getValues());
    if (!kept.removed) return;
    if (sh.getFilter()) sh.getFilter().remove();
    rng.clearContent();
    if (kept.rows.length) sh.getRange(2, 1, kept.rows.length, DAY_HEADERS.length).setValues(kept.rows);
    const minRows = Math.max(kept.rows.length + 1, 200);     // 200 صفاً على الأقل لحماية اللوحة الجانبية
    if (sh.getMaxRows() > minRows) sh.deleteRows(minRows + 1, sh.getMaxRows() - minRows);
    sh.getRange(1, 1, Math.max(kept.rows.length + 1, 2), DAY_HEADERS.length).createFilter();
    done.push(t.name);
  });
  return done;
}

/** يحذف الصفوف الفارغة الزائدة أسفل بيانات كل تاب يوم (لا يلمس أي صف فيه بيانات). */
function trimDayTabs_(ss) {
  listDayTabs_(ss).forEach(t => {
    const sh = ss.getSheetByName(t.name);
    const need = Math.max(sh.getLastRow(), 200);
    if (sh.getMaxRows() > need + 100) sh.deleteRows(need + 1, sh.getMaxRows() - need);
  });
}

/** دالة نقية: values = صفوف تاب يوم (بدون العناوين). تُرجع {rows: الصفوف الباقية, removed: عدد المحذوف}. */
function keepRowsOnCompact_(values) {
  const rows = [];
  let removed = 0;
  values.forEach(r => {
    if (r[W.AWB - 1] === '' || r[W.AWB - 1] == null) return;
    const used = r[W.NOTIF - 1] || r[W.ACTION - 1] || r[W.NOTE - 1];
    if (normHeader_(r[W.TYPE - 1]) === NOT_LATE && !used) { removed++; return; }
    rows.push(r);
  });
  return { rows: rows, removed: removed };
}

/* ============================== إجمالي الفروع (Day_Totals) ============================== */

function totIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd');
  return normHeader_(v);
}

/**
 * يكتب إجمالي كل فرع ليوم tabName في ورقة Day_Totals (يستبدل صفوف نفس اليوم).
 * أول مرة: يستكمل الأيام السابقة من اللوحة الجانبية في تاباتها (كما هي).
 */
function writeDayTotals_(ss, tabName, branchTotals) {
  let sh = ss.getSheetByName(SH.TOT);
  if (!sh) { sh = ss.insertSheet(SH.TOT, ss.getSheets().length); sh.setRightToLeft(true); }
  let rows = [];
  if (sh.getLastRow() > 1) {
    rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
      .map(r => [totIso_(r[0]), normHeader_(r[1]), Number(r[2]) || 0])
      .filter(r => r[0] && r[1] && r[0] !== tabName);
  }
  const have = {};
  rows.forEach(r => { have[r[0]] = 1; });
  listDayTabs_(ss).forEach(t => {                      // استكمال الأيام السابقة مرة واحدة
    if (t.name === tabName || have[t.name]) return;
    const old = ss.getSheetByName(t.name);
    const n = Math.min(old.getLastRow(), 400);
    if (n < SIDE.FIRST_ROW) return;
    sideTotals_(old.getRange(1, SIDE.LABEL_COL, n, 2).getValues()).forEach(p => rows.push([t.name, p[0], p[1]]));
  });
  sortedBranchTotals_(branchTotals).forEach(p => rows.push([tabName, p[0], p[1]]));
  rows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : b[2] - a[2]));   // الأحدث أولاً ثم الأكبر

  sh.clearContents();
  sh.getRange(1, 1, 1, 3).setValues([TOT_HEADERS]).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
  sh.getRange(2, 1, Math.max(rows.length, 1), 1).setNumberFormat('@');     // اليوم كنص yyyy-mm-dd ليطابق Dashboard!B3
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.setFrozenRows(1);
}

/** دالة نقية: من اللوحة الجانبية [[label,value],...] إلى [[branch,total],...] (تتجاهل الفارغ وصف العناوين). */
function sideTotals_(side) {
  const out = [];
  for (let i = SIDE.FIRST_ROW - 1; i < side.length; i++) {
    const b = normHeader_(side[i][0]);
    if (!b || b === 'الفرع') continue;
    const n = Number(side[i][1]);
    if (!isNaN(n) && side[i][1] !== '') out.push([b, n]);
  }
  return out;
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

/** معادلتا History: للمتابعة = المتأخر فقط، تم التعامل = متأخر سُجِّل له إجراء. دالة نقية. */
function historyFormulas_(tabName, row) {
  const q = "'" + tabName + "'!";
  return [
    '=COUNTIFS(' + q + 'Q2:Q,"?*",' + q + 'Q2:Q,"<>' + NOT_LATE + '")',
    '=COUNTIFS(' + q + 'V2:V,"?*",' + q + 'Q2:Q,"<>' + NOT_LATE + '")',
    '=IFERROR(C' + row + '/B' + row + ',0)',
    '=IFERROR(D' + row + '/C' + row + ',0)'];
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
  sh.getRange(row, 1, 1, 2).setValues([[dayToDate_(reportDay), total]]);
  sh.getRange(row, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(row, 3, 1, 4).setFormulas([historyFormulas_(tabName, row)]);
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

/* ---------- معادلات Dashboard ---------- */

/** مرجع عمود في تاب اليوم المعروض (اسم التاب في Dashboard!B3). */
function dashT_(col) { return 'INDIRECT("\'"&$B$3&"\'!' + col + '$2:' + col + '")'; }   // عمود مفتوح: كل صفوف التاب
/** شرطا "متأخر فقط" على عمود نوع التأخر (يتجاهل "غير متأخر" والصفوف الفارغة). */
function dashLate_() { return dashT_('Q') + ',"?*",' + dashT_('Q') + ',"<>' + NOT_LATE + '"'; }
const DASH_BRANCH_FIRST = 10, DASH_BRANCH_LAST = 39;
const DASH_REGIONS = ['القاهره و الاسكندريه', 'الدلتا و القنال', 'الصعيد'];
// التصميم القديم (الإصدار 3 الأول)
const DASH_OLD_KPI_LABELS = ['إجمالي الشحنات', 'للمتابعة (فريد)', 'حالة متأخرة', 'أوردر متأخر (الشركة)', 'تبليغ خدمة عملاء', 'تم التعامل', 'نسبة التغطية', 'أوردرات متكررة'];
// تصميم الكروت الإدارية السابق (8 كروت) — يُهاجَر تلقائياً إلى الحالي
const DASH_PREV_KPI_LABELS = ['للمتابعة (فريد)', 'أوردر متأخر (الشركة)', 'خدمة عملاء (قبل حد الشركة)', 'حالة فقط',
  'أوردر/خدمة: لم يُبلَّغ بعد', 'أوردر/خدمة: اتبلّغ', 'متكرر بعد التبليغ', 'التحصيل المعرّض (ج.م)'];
// التصميم الحالي (7 كروت)
const DASH_NEW_KPI_LABELS = ['للمتابعة', 'أوردر متأخر (الشركة)', 'خدمة عملاء (قبل حد الشركة)', 'تأخير الحالة',
  'أوردر/خدمة: لم يُبلَّغ بعد', 'أوردر/خدمة: اتبلّغ', 'متكرر بعد التبليغ'];

/** معادلات صف الكروت (الصف 6) للتصميم الحالي (7 كروت بدون تداخل). دالة نقية. */
function dashKpiNew_() {
  const T = dashT_;
  return [
    '=IFERROR(COUNTIFS(' + dashLate_() + '),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*أوردر*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*خدمة*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"حالة"),0)',
    '=B6+C6-F6',
    '=IFERROR(COUNTIFS(' + T('Q') + ',"*أوردر*",' + T('U') + ',"?*")+COUNTIFS(' + T('Q') + ',"*خدمة*",' + T('U') + ',"?*"),0)',
    '=COUNTA(Repeated_Orders!A$2:A$20000)'];
}

/** معادلات صف الكروت (الصف 6) للتصميم القديم الموجود حالياً في الشيت. دالة نقية. */
function dashKpiOld_() {
  const T = dashT_;
  return [
    '=IFERROR(SUMIFS(' + SH.TOT + '!$C$2:$C,' + SH.TOT + '!$A$2:$A,$B$3),0)',
    '=IFERROR(COUNTIFS(' + dashLate_() + '),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*حالة*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*أوردر*"),0)',
    '=IFERROR(COUNTIF(' + T('Q') + ',"*خدمة*"),0)',
    '=IFERROR(COUNTIFS(' + T('V') + ',"?*",' + dashLate_() + '),0)',
    '=IFERROR(F6/B6,0)',
    '=COUNTA(Repeated_Orders!A$2:A$20000)'];
}

/** معادلات جدول الفروع (10 أعمدة) لصف r. الفروع وإجمالياتها من Day_Totals. دالة نقية. */
function dashBranchRow_(r) {
  const T = dashT_, k = r - DASH_BRANCH_FIRST + 1, A = 'A' + r;
  const tot = SH.TOT + '!';
  return [
    '=IFERROR(INDEX(FILTER(' + tot + '$B$2:$B,' + tot + '$A$2:$A=$B$3),' + k + '),"")',
    '=IF(' + A + '="","",IFERROR(INDEX(Rules!$B$13:$B$52,MATCH(' + A + ',Rules!$A$13:$A$52,0)),""))',
    '=IF(' + A + '="","",SUMIFS(' + tot + '$C$2:$C,' + tot + '$A$2:$A,$B$3,' + tot + '$B$2:$B,' + A + '))',
    '=IF(' + A + '="","",COUNTIFS(' + T('C') + ',' + A + ',' + T('Q') + ',"*حالة*"))',
    '=IF(' + A + '="","",COUNTIFS(' + T('C') + ',' + A + ',' + T('Q') + ',"*أوردر*"))',
    '=IF(' + A + '="","",COUNTIFS(' + T('C') + ',' + A + ',' + T('Q') + ',"*خدمة*"))',
    '=IF(' + A + '="","",COUNTIFS(' + T('C') + ',' + A + ',' + dashLate_() + '))',
    '=IF(' + A + '="","",IFERROR(G' + r + '/C' + r + ',0))',
    '=IF(' + A + '="","",COUNTIFS(' + T('C') + ',' + A + ',' + T('V') + ',"?*",' + dashLate_() + '))',
    '=IF(' + A + '="","",IFERROR(I' + r + '/G' + r + ',0))'];
}

/** معادلات صف إقليم (الأعمدة B:E) للصف r. دالة نقية. */
function dashRegionRow_(r) {
  const T = dashT_, A = 'A' + r;
  return [
    '=IFERROR(COUNTIFS(' + T('D') + ',' + A + ',' + dashLate_() + '),0)',
    '=IFERROR(COUNTIFS(' + T('D') + ',' + A + ',' + T('Q') + ',"*حالة*"),0)',
    '=IFERROR(COUNTIFS(' + T('D') + ',' + A + ',' + T('Q') + ',"*أوردر*"),0)',
    '=IFERROR(COUNTIFS(' + T('D') + ',' + A + ',' + T('Q') + ',"*خدمة*"),0)'];
}

/** خلايا Dashboard كقيم/معادلات: [صف، عمود، محتوى، هل معادلة]. دالة نقية قابلة للاختبار. */
function dashboardCells_() {
  const cells = [];
  const put = (r, c, v, f) => cells.push([r, c, v, !!f]);
  put(1, 1, 'لوحة الأوديت اليومية — عمر الحالة وعمر الأوردر (الشركة وخدمة العملاء)');
  put(2, 1, 'اليوم المعروض (اختر من القائمة)');
  put(3, 1, 'اسم التاب'); put(3, 2, '=TEXT(B2,"yyyy-mm-dd")', true);
  // كروت للإدارة: أنواع التأخر بدون تداخل + التبليغ والتصعيد
  const kf = dashKpiNew_();
  DASH_NEW_KPI_LABELS.forEach((l, i) => { put(5, i + 1, l); put(6, i + 1, kf[i], true); });
  put(7, 1, 'الأنواع الثلاثة (أوردر الشركة / خدمة العملاء / تأخير الحالة) لا تتداخل، ومجموعها = للمتابعة. الشحنة التي تجمع أوردراً وحالة تُحسب أوردراً. "لم يُبلَّغ بعد" = أوردر أو خدمة عملاء بلا نوع تبليغ مسجل. الشحنات "غير متأخر" لا تدخل في أي مؤشر.');

  put(8, 1, 'أداء الفروع');
  ['الفرع', 'الإقليم', 'إجمالي الشحنات', 'حالة متأخرة', 'أوردر متأخر (الشركة)', 'تبليغ خدمة عملاء', 'للمتابعة', 'نسبة المتابعة', 'تم التعامل', 'نسبة التغطية']
    .forEach((h, i) => put(9, i + 1, h));
  for (let r = DASH_BRANCH_FIRST; r <= DASH_BRANCH_LAST; r++) {
    dashBranchRow_(r).forEach((f, i) => put(r, i + 1, f, true));
  }
  put(41, 1, 'حسب الإقليم');
  ['الإقليم', 'للمتابعة', 'حالة متأخرة', 'أوردر متأخر (الشركة)', 'تبليغ خدمة عملاء'].forEach((h, i) => put(42, i + 1, h));
  DASH_REGIONS.forEach((rg, k) => {
    const r = 43 + k;
    put(r, 1, rg);
    dashRegionRow_(r).forEach((f, i) => put(r, i + 2, f, true));
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

/**
 * يحدّث معادلات Dashboard الموجود (بدون مسح التنسيق أو History) لتتوافق مع نزول كل البوالص:
 * الكروت، جدول الفروع (من Day_Totals) وجدول الأقاليم. يتعرف على التصميم القديم أو السابق أو الحالي من عناوين الصف 5.
 * التصميم السابق (8 كروت) يُهاجَر للحالي: عناوين جديدة وحذف كارت التحصيل المعرّض.
 * يُرجع true لو تم التحديث، false لو شكل اللوحة غير معروف (لا يغيّر شيئاً).
 */
function patchDashboard_(dash) {
  const labels = dash.getRange(5, 1, 1, 8).getValues()[0].map(normHeader_);
  const same = arr => arr.every((l, i) => labels[i] === normHeader_(l));
  const isOld = same(DASH_OLD_KPI_LABELS);
  const isPrev = same(DASH_PREV_KPI_LABELS);
  const isNew = same(DASH_NEW_KPI_LABELS);
  if (!isOld && !isPrev && !isNew) return false;
  if (normHeader_(dash.getRange(9, 1).getValue()) !== 'الفرع' || normHeader_(dash.getRange(42, 1).getValue()) !== 'الإقليم') return false;

  if (isOld) {
    dash.getRange(6, 1, 1, 8).setFormulas([dashKpiOld_()]);
  } else {
    if (isPrev) {                                   // هجرة: عناوين جديدة وحذف الكارت الثامن
      dash.getRange(5, 1, 1, 7).setValues([DASH_NEW_KPI_LABELS]);
      dash.getRange(5, 8, 2, 1).clearContent();
      dash.getRange('G9').setValue('للمتابعة');
      dash.getRange('B42').setValue('للمتابعة');
      dash.getRange('A7').setValue('الأنواع الثلاثة (أوردر الشركة / خدمة العملاء / تأخير الحالة) لا تتداخل، ومجموعها = للمتابعة. الشحنة التي تجمع أوردراً وحالة تُحسب أوردراً. "لم يُبلَّغ بعد" = أوردر أو خدمة عملاء بلا نوع تبليغ مسجل. الشحنات "غير متأخر" لا تدخل في أي مؤشر.');
    }
    dash.getRange(6, 1, 1, 7).setFormulas([dashKpiNew_()]);
  }
  const br = [];
  for (let r = DASH_BRANCH_FIRST; r <= DASH_BRANCH_LAST; r++) br.push(dashBranchRow_(r));
  dash.getRange(DASH_BRANCH_FIRST, 1, br.length, 10).setFormulas(br);
  const rg = DASH_REGIONS.map((x, k) => dashRegionRow_(43 + k));
  dash.getRange(43, 2, rg.length, 4).setFormulas(rg);
  return true;
}

function patchDashboardMenu() {
  const ss = SpreadsheetApp.getActive();
  const dash = ss.getSheetByName(SH.DASH);
  const ui = SpreadsheetApp.getUi();
  if (!dash) { ui.alert('ورقة Dashboard غير موجودة.'); return; }
  if (!ss.getSheetByName(SH.TOT)) { ui.alert('شغّل 🔄 تحديث مرة واحدة أولاً لإنشاء ورقة Day_Totals.'); return; }
  ui.alert(patchDashboard_(dash) ? 'تم تحديث معادلات Dashboard.' :
    'شكل Dashboard مختلف عن المتوقع (عناوين الصف 5 أو الصف 9 أو الصف 42). لم يتم أي تغيير.');
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
  dash.getRange('A5:G5').setFontWeight('bold').setBackground('#D9E2F3').setHorizontalAlignment('center').setWrap(true);
  dash.setRowHeight(5, 32);
  dash.getRange('A6:G6').setFontWeight('bold').setFontSize(16).setFontColor(HF).setHorizontalAlignment('center').setNumberFormat('#,##0');
  dash.setRowHeight(6, 30);
  dash.getRange('A7').setFontStyle('italic').setFontColor('#7F7F7F').setFontSize(9);
  ['A8', 'A41', 'A47'].forEach(a => dash.getRange(a).setFontWeight('bold').setFontSize(13).setFontColor(HF));
  hdr(dash.getRange('A9:J9')); dash.setRowHeight(9, 32);
  dash.getRange('C10:J39').setNumberFormat('#,##0'); dash.getRange('H10:H39').setNumberFormat('0.0%'); dash.getRange('J10:J39').setNumberFormat('0.0%');
  hdr(dash.getRange('A42:E42')); hdr(dash.getRange('A48:B48'));
  dash.getRange('A10:J39').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A43:E45').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A49:B52').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
  dash.getRange('A5:G6').setBorder(true, true, true, true, true, true, '#BFBFBF', SpreadsheetApp.BorderStyle.SOLID);
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
    'نظام الأوديت اليومي — ARRIVE (الإصدار 3.1: مراجع أوديت واحد، وتاب لكل يوم فيه كل البوالص)', '',
    'التشغيل اليومي',
    '1) امسح Raw_Daily والصق تصدير اليوم (بالعناوين) من A1.',
    '2) القائمة: 🔎 الأوديت اليومي ← 🔄 تحديث. يُنشأ تاب باسم تاريخ اليوم فيه كل البوالص: المتأخرة أولاً، ثم "غير متأخر".',
    '3) في تاب اليوم اختر نوع التبليغ (خدمة عملاء / فروع داخلية / فروع خارجية) والإجراء واكتب الملاحظة (الأعمدة الصفراء).',
    '4) اختيار نوع تبليغ بدون إجراء يكتب "تم التبليغ" تلقائياً، ووقت الإجراء يُسجَّل تلقائياً بعد تفعيله مرة واحدة من القائمة.',
    '5) كل يوم تاب جديد، والتابات القديمة سجل الأيام. إعادة التحديث في نفس اليوم لا تمسح ما كتبته.',
    '6) Repeated_Orders: شحنات ظهرت متأخرة في أيام متتالية مع حالة تبليغها (Rules!B9 يتحكم في عرض المبلَّغ عنها فقط).',
    '7) Dashboard: اختر اليوم من الخلية B2. History: اتجاه الأيام. Day_Totals: إجمالي كل فرع لكل يوم (لا تعدّلها يدوياً).', '',
    'قواعد التأخر (تتعدل في Rules)',
    '• عمر الحالة = تاريخ التقرير − تاريخ آخر حالة، ويُقارن بحد كل حالة شحنة.',
    '• عمر الأوردر = تاريخ التقرير − تاريخ البيك أب، والحد حسب فرع العضو: حد الشركة وحد خدمة العملاء. الإقليم يُضاف تلقائياً.',
    '• التأخر يبدأ عند الحد نفسه (≥). غيّر Rules!B8 إلى "لا" ليبدأ بعد تجاوزه.',
    '• كل المؤشرات (للمتابعة، التغطية، التكرار) تُحسب على المتأخر فقط؛ "غير متأخر" للاطلاع والفلترة.',
    '• البوليصة المكررة في Raw_Daily تُحسب كما هي ويُسجَّل تكرارها في Data_Quality.', '',
    'حجم الملف: آخر ' + KEEP_FULL_TABS + ' تابات تبقى كاملة. التابات الأقدم تُحذف منها تلقائياً صفوف "غير متأخر" التي لم يُسجَّل عليها تبليغ أو إجراء أو ملاحظة.',
    'لا تحذف صفوفاً من تابات الأيام ولا تغيّر أسماءها إن أردت حفظ التكرار (يُقرأ آخر 45 يوماً).'];
  lines.forEach((t, i) => sh.getRange(i + 1, 1).setValue(t));
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 900);
}

function mustSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('الورقة غير موجودة: ' + name);
  return sh;
}


/* ====================================================================
 * ويب آب للداش بورد (يقرأ تابات الأيام ويعرض أعدادًا مجمّعة فقط)
 * ==================================================================== */
const OA = { DEFAULT_DAYS: 60, STATUS_DAYS: 14, CACHE_SEC: 21600, FRESH_DAYS: 2 };

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const need = props.getProperty('DATA_TOKEN');
  if (need && (!e || !e.parameter || e.parameter.token !== need)) return oaJson_({ error: 'unauthorized' });

  const ss = SpreadsheetApp.getActive();
  const nDays = Math.min(Number(e && e.parameter && e.parameter.days) || OA.DEFAULT_DAYS, 180);
  const tabs = listDayTabs_(ss).slice(0, nDays);          // الأحدث أولاً
  const regions = oaRegions_(ss);
  const dayTotals = oaDayTotals_(ss);
  const cache = CacheService.getScriptCache();
  const rows = [], statuses = [];
  let cachedAny = false;

  tabs.forEach((t, i) => {
    const withStatus = i < OA.STATUS_DAYS;
    const key = 'oa4_' + t.name + (withStatus ? '_s' : '');
    let agg = null;
    if (i >= OA.FRESH_DAYS) {                             // الأيام الأقدم تُخزَّن مؤقتًا (آخر يومين دائمًا طازجين)
      const c = cache.get(key);
      if (c) { agg = JSON.parse(c); cachedAny = true; }
    }
    if (!agg) {
      agg = oaAggregateTab_(ss.getSheetByName(t.name), regions, t.name, withStatus, dayTotals[t.name]);
      if (i >= OA.FRESH_DAYS) { try { cache.put(key, JSON.stringify(agg), OA.CACHE_SEC); } catch (err) { /* أكبر من حد الذاكرة المؤقتة */ } }
    }
    Array.prototype.push.apply(rows, agg.rows);
    Array.prototype.push.apply(statuses, agg.statuses);
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.branch < b.branch ? -1 : 1)));

  return oaJson_({
    generated: new Date().toISOString(), rows: rows, statuses: statuses, repeated: oaRepeated_(ss), note: cachedAny ? 'cached' : '',
    tabs: tabs.map(t => t.name),                       // تابات الأيام التي وُجدت (للتشخيص)
    sheets: ss.getSheets().map(sh => sh.getName())     // أسماء كل الأوراق (للتشخيص فقط)
  });
}

function oaJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** الفرع → الإقليم من جدول Rules (A13:B52). */
function oaRegions_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SH.RULES);
  if (!sh) return out;
  sh.getRange(13, 1, 40, 2).getValues().forEach(r => { const b = normHeader_(r[0]); if (b) out[b] = normHeader_(r[1]); });
  return out;
}

/** Day_Totals → { 'yyyy-mm-dd': [[branch,total],...] }. فارغ لو الورقة غير موجودة. */
function oaDayTotals_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SH.TOT);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
    const d = totIso_(r[0]), b = normHeader_(r[1]);
    if (!d || !b) return;
    (out[d] || (out[d] = [])).push([b, Number(r[2]) || 0]);
  });
  return out;
}

/** totals (اختياري): إجماليات الفروع من Day_Totals؛ لو غير موجودة تُقرأ اللوحة الجانبية في التاب. */
function oaAggregateTab_(sh, regions, iso, withStatus, totals) {
  if (!sh || sh.getLastRow() < 1) return { rows: [], statuses: [] };
  const last = sh.getLastRow();
  const main = last > 1 ? sh.getRange(2, 1, last - 1, W.ACT_TIME).getValues() : [];
  let side;
  if (totals && totals.length) {
    side = [];
    for (let i = 0; i < SIDE.FIRST_ROW - 1; i++) side.push(['', '']);
    totals.forEach(p => side.push(p));
  } else {
    side = sh.getRange(1, SIDE.LABEL_COL, Math.min(last, 400), 2).getValues();
  }
  return oaAggregate_(main, side, regions, iso, withStatus);
}

/**
 * دالة نقية قابلة للاختبار.
 * main: صفوف تاب اليوم (بدون العناوين) بترتيب أعمدة W. side: [[label,value],...] يبدأ الفروع من الصف SIDE.FIRST_ROW.
 * صفوف "غير متأخر" لا تدخل في أي مؤشر (تظهر فقط ضمن إجمالي الفرع).
 */
function oaAggregate_(main, side, regions, iso, withStatus) {
  const totals = {};
  sideTotals_(side).forEach(p => { totals[p[0]] = p[1]; });
  const by = {}, st = {};
  const get = b => by[b] || (by[b] = {
    date: iso, branch: b, region: regions[b] || '', total: totals[b] || 0, followup: 0, case_late: 0, order_late: 0,
    cs_late: 0, case_only: 0, case_first: 0, handled: 0, notified: 0, notified_oc: 0, n_cs: 0, n_int: 0, n_ext: 0,
    high: 0, repeated: 0, max_streak: 0, cod: 0, cod_oc: 0, sum_oage: 0, max_oage: 0
  });
  main.forEach(r => {
    if (!r[W.AWB - 1]) return;
    const b = normHeader_(r[W.BRANCH - 1]);
    if (!b) return;
    const type = normHeader_(r[W.TYPE - 1]);
    if (type === NOT_LATE) return;                 // غير متأخر: خارج كل المؤشرات
    const o = get(b);
    if (!o.region) o.region = normHeader_(r[W.REGION - 1]);
    o.followup++;
    const isCase = type.indexOf('حالة') >= 0, isOrder = type.indexOf('أوردر') >= 0, isCs = type.indexOf('خدمة') >= 0;
    const cod = Number(r[W.COD - 1]) || 0;
    const nt = normHeader_(r[W.NOTIF - 1]);
    o.cod += cod;
    if (isCase) o.case_late++;
    if (isOrder) { o.order_late++; const oa = Number(r[W.O_AGE - 1]) || 0; o.sum_oage += oa; if (oa > o.max_oage) o.max_oage = oa; }
    if (isCs) o.cs_late++;
    if (isOrder || isCs) { o.cod_oc += cod; if (nt) o.notified_oc++; }
    if (isCase && !isOrder && !isCs) { o.case_only++; if (Number(r[W.C_AGE - 1]) === Number(r[W.C_THR - 1])) o.case_first++; }
    if (normHeader_(r[W.ACTION - 1])) o.handled++;
    if (nt) o.notified++;
    if (nt.indexOf('خدمة') >= 0) o.n_cs++; else if (nt.indexOf('داخلية') >= 0) o.n_int++; else if (nt.indexOf('خارجية') >= 0) o.n_ext++;
    if (r[W.PRIORITY - 1] === 'عالية') o.high++;
    const sk = Number(r[W.STREAK - 1]) || 1;
    if (sk >= 2) o.repeated++;
    if (sk > o.max_streak) o.max_streak = sk;
    if (withStatus && isCase) { const k = b + '|' + normHeader_(r[W.STATUS - 1]); st[k] = (st[k] || 0) + 1; }
  });
  Object.keys(totals).forEach(b => get(b));   // فروع بلا شحنات متأخرة تظهر بصفر
  const rows = Object.keys(by).map(b => { const o = by[b]; if (o.total < o.followup) o.total = o.followup; return o; });
  const statuses = Object.keys(st).map(k => { const p = k.split('|'); return { date: iso, branch: p[0], status: p.slice(1).join('|'), n: st[k] }; });
  return { rows: rows, statuses: statuses };
}

/** تجميع Repeated_Orders حسب الفرع (آخر تحديث): العدد، المبلَّغ، غير المبلَّغ، أقصى تتابع، نوع آخر تبليغ. */
function oaRepeated_(ss) {
  const sh = ss.getSheetByName(SH.REP);
  if (!sh || sh.getLastRow() < 2) return [];
  return oaRepeatedAgg_(sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues());
}

function oaRepeatedAgg_(values) {
  const by = {};
  values.forEach(r => {
    if (!r[0]) return;
    const b = normHeader_(r[1]);
    const o = by[b] || (by[b] = { branch: b, region: normHeader_(r[2]), count: 0, notified: 0, not_notified: 0, max_streak: 0, t_cs: 0, t_int: 0, t_ext: 0 });
    o.count++;
    if (normHeader_(r[7]) === 'اتبلّغ') o.notified++; else o.not_notified++;
    o.max_streak = Math.max(o.max_streak, Number(r[5]) || 0);
    const nt = String(r[9]);
    if (nt.indexOf('خدمة') >= 0) o.t_cs++; else if (nt.indexOf('داخلية') >= 0) o.t_int++; else if (nt.indexOf('خارجية') >= 0) o.t_ext++;
  });
  return Object.keys(by).map(k => by[k]);
}
