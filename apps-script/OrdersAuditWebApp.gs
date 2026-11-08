/**
 * ويب آب للوحة أوديت الأوردرات المتأخرة — يقرأ تابات الأيام (yyyy-mm-dd) ويعرض أعدادًا مجمّعة فقط
 * (حسب اليوم والفرع). لا يعرض أرقام بوالص ولا عملاء ولا مناديب.
 *
 * يعتمد على OrdersAuditSheet.gs (نفس مشروع Apps Script): الثوابت W و SIDE و DAY_TAB_RE ودوال listDayTabs_ و normHeader_.
 * النشر: نشر ← نشر كتطبيق ويب ← تنفيذ باسمي ← الوصول: أي شخص (ثم New version بعد أي تعديل).
 * اختياري: خصائص السكريبت ← DATA_TOKEN لطلب ?token=  (ليس حماية حقيقية — انظر README).
 * معاملات اختيارية: ?days=60 (عدد الأيام، الأقصى 180).
 */
const OA = { DEFAULT_DAYS: 60, STATUS_DAYS: 14, CACHE_SEC: 21600, FRESH_DAYS: 2 };

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const need = props.getProperty('DATA_TOKEN');
  if (need && (!e || !e.parameter || e.parameter.token !== need)) return oaJson_({ error: 'unauthorized' });

  const ss = SpreadsheetApp.getActive();
  const nDays = Math.min(Number(e && e.parameter && e.parameter.days) || OA.DEFAULT_DAYS, 180);
  const tabs = listDayTabs_(ss).slice(0, nDays);          // الأحدث أولاً
  const regions = oaRegions_(ss);
  const cache = CacheService.getScriptCache();
  const rows = [], statuses = [];
  let cachedAny = false;

  tabs.forEach((t, i) => {
    const withStatus = i < OA.STATUS_DAYS;
    const key = 'oa2_' + t.name + (withStatus ? '_s' : '');
    let agg = null;
    if (i >= OA.FRESH_DAYS) {                             // الأيام الأقدم تُخزَّن مؤقتًا (آخر يومين دائمًا طازجين)
      const c = cache.get(key);
      if (c) { agg = JSON.parse(c); cachedAny = true; }
    }
    if (!agg) {
      agg = oaAggregateTab_(ss.getSheetByName(t.name), regions, t.name, withStatus);
      if (i >= OA.FRESH_DAYS) { try { cache.put(key, JSON.stringify(agg), OA.CACHE_SEC); } catch (err) { /* أكبر من حد الذاكرة المؤقتة */ } }
    }
    Array.prototype.push.apply(rows, agg.rows);
    Array.prototype.push.apply(statuses, agg.statuses);
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.branch < b.branch ? -1 : 1)));

  return oaJson_({ generated: new Date().toISOString(), rows: rows, statuses: statuses, repeated: oaRepeated_(ss), note: cachedAny ? 'cached' : '' });
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

function oaAggregateTab_(sh, regions, iso, withStatus) {
  if (!sh || sh.getLastRow() < 1) return { rows: [], statuses: [] };
  const last = sh.getLastRow();
  const main = last > 1 ? sh.getRange(2, 1, last - 1, W.ACT_TIME).getValues() : [];
  const side = sh.getRange(1, SIDE.LABEL_COL, last, 2).getValues();
  return oaAggregate_(main, side, regions, iso, withStatus);
}

/**
 * دالة نقية قابلة للاختبار.
 * main: صفوف تاب اليوم (بدون العناوين) بترتيب أعمدة W. side: اللوحة الجانبية [[label,value],...] (الصف 1 = إجمالي الشحنات).
 */
function oaAggregate_(main, side, regions, iso, withStatus) {
  const totals = {};
  for (let i = SIDE.FIRST_ROW - 1; i < side.length; i++) {
    const b = normHeader_(side[i][0]);
    if (b) totals[b] = Number(side[i][1]) || 0;
  }
  const by = {}, st = {};
  const get = b => by[b] || (by[b] = {
    date: iso, branch: b, region: regions[b] || '', total: totals[b] || 0, followup: 0, case_late: 0, order_late: 0,
    cs_late: 0, handled: 0, n_cs: 0, n_int: 0, n_ext: 0, high: 0, repeated: 0, max_streak: 0
  });
  main.forEach(r => {
    if (!r[W.AWB - 1]) return;
    const b = normHeader_(r[W.BRANCH - 1]);
    if (!b) return;
    const o = get(b);
    if (!o.region) o.region = normHeader_(r[W.REGION - 1]);
    o.followup++;
    const type = String(r[W.TYPE - 1]);
    const isCase = type.indexOf('حالة') >= 0;
    if (isCase) o.case_late++;
    if (type.indexOf('أوردر') >= 0) o.order_late++;
    if (type.indexOf('خدمة') >= 0) o.cs_late++;
    if (normHeader_(r[W.ACTION - 1])) o.handled++;
    const nt = String(r[W.NOTIF - 1]);
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
