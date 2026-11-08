export const N = (v) => (v == null || v === '' ? 0 : +v);
export const fi = (v) => Number(v).toLocaleString('en-US');
export const fp = (v) => Number(v).toFixed(1) + '%';
export const sgn = (d, f = 1) => (d > 0 ? '+' : '') + d.toFixed(f);

// مفاتيح الأعداد في كل صف (يوم × فرع) كما يرسلها الويب آب
export const KEYS = ['total', 'followup', 'case_late', 'order_late', 'cs_late', 'case_only', 'case_first', 'handled', 'notified', 'notified_oc',
  'n_cs', 'n_int', 'n_ext', 'high', 'repeated', 'cod', 'cod_oc', 'sum_oage'];

/**
 * تجميع صفوف (يوم × فرع). التعريفات:
 *  oc          = أوردر الشركة + خدمة العملاء (الأنواع المطلوب تبليغها) — لا تتداخل
 *  rate        = نسبة الأوردرات المتأخرة = oc ÷ شحنات الفرع (الأقل أفضل)
 *  fu_rate     = نسبة المتابعة = للمتابعة ÷ شحنات الفرع (تشمل «حالة فقط»)
 *  noti        = نسبة التبليغ = (أوردر/خدمة اتبلّغ) ÷ oc (الأعلى أفضل)
 *  unnotified  = oc − اتبلّغ
 */
export function derive(t) {
  t.oc = N(t.order_late) + N(t.cs_late);
  t.rate = t.total ? (t.oc / t.total) * 100 : 0;
  t.fu_rate = t.total ? (N(t.followup) / t.total) * 100 : 0;
  t.noti = t.oc ? (N(t.notified_oc) / t.oc) * 100 : 0;
  t.unnotified = Math.max(0, t.oc - N(t.notified_oc));
  t.avg_oage = N(t.order_late) ? N(t.sum_oage) / N(t.order_late) : 0;
  return t;
}
export function sum(rows) {
  const t = {};
  KEYS.forEach((k) => { t[k] = 0; });
  t.max_oage = 0;
  rows.forEach((r) => { KEYS.forEach((k) => { t[k] += N(r[k]); }); if (N(r.max_oage) > t.max_oage) t.max_oage = N(r.max_oage); });
  return derive(t);
}
export const withRates = (r) => derive({ ...r });

// مستويات الصحة حسب نسبة الأوردرات المتأخرة (الأقل أفضل). الحدود افتراضية للعرض وليست سياسة معتمدة.
export const LEVELS = {
  excellent: { label: 'ممتاز', icon: 'fa-circle-check', cls: 's-success' },
  good: { label: 'جيد', icon: 'fa-circle-info', cls: 's-progress' },
  attention: { label: 'يحتاج انتباه', icon: 'fa-triangle-exclamation', cls: 's-action' },
  critical: { label: 'حرج', icon: 'fa-circle-exclamation', cls: 's-violation' }
};
export function levelOf(rate, th) {
  if (rate <= th.excellent) return 'excellent';
  if (rate <= th.good) return 'good';
  if (rate <= th.bad) return 'attention';
  return 'critical';
}

export function toCsv(rows, cols) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return '﻿' + [cols.map((c) => esc(c.h)).join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c.k])).join(','))).join('\n');
}
export function download(name, text) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  } catch { /* ignore */ }
}

export function loadCfg(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } }
export function saveCfg(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

// الجمعة إجازة: لا تُحسب يومًا ناقصًا (0 = الأحد ... 5 = الجمعة)
export const OFF_DAY = 5;
export const isOff = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === OFF_DAY;
export const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
export function missingWorkDays(a, b) {
  const out = [];
  for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (!isOff(d)) out.push(d);
  return out;
}
export const dmy = (d) => (d ? d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) : '—');
// بداية الأسبوع السبت
export const weekStart = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };

/* ---------------- بيانات تجريبية للمعاينة فقط (غير حقيقية) ---------------- */
const DEMO_BRANCHES = [
  ['فرع أ', 'القاهره و الاسكندريه', .02], ['فرع ب', 'القاهره و الاسكندريه', .045], ['فرع ج', 'القاهره و الاسكندريه', .015],
  ['فرع د', 'القاهره و الاسكندريه', .06], ['فرع هـ', 'القاهره و الاسكندريه', .03], ['فرع و', 'القاهره و الاسكندريه', .075],
  ['فرع ز', 'الدلتا و القنال', .025], ['فرع ح', 'الدلتا و القنال', .05], ['فرع ط', 'الدلتا و القنال', .035],
  ['فرع ي', 'الدلتا و القنال', .012], ['فرع ك', 'الصعيد', .07], ['فرع ل', 'الصعيد', .04]
];
const DEMO_STATUSES = ['قيد التوصيل', 'تأجيل', 'في الطريق للتاجر', 'تم استلام - فرع المنطقة', 'مشكلة في التسليم', 'مرتجعات الي الرئيسي', 'تم الارتجاع للفرع', 'المحاولة الثانية'];

export function demoData() {
  let s = 20261108;
  const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rows = [], statuses = [];
  for (let d = 0; d < 14; d++) {
    const dt = addDays('2026-10-22', d);
    if (isOff(dt)) continue;
    DEMO_BRANCHES.forEach(([branch, region, base]) => {
      const total = 300 + Math.floor(rnd() * 500);
      const oc = Math.max(0, Math.round(total * (base + (rnd() - .5) * .02 + d * .0006)));
      const order = Math.round(oc * (.25 + rnd() * .15)), cs = oc - order;
      const caseOnly = Math.round(total * (.08 + rnd() * .08)), caseFirst = Math.round(caseOnly * (.7 + rnd() * .15));
      const followup = oc + caseOnly;
      const notifiedOc = Math.round(oc * Math.min(1, .25 + d * .05 + rnd() * .2));
      const notified = notifiedOc + Math.round(caseOnly * .05);
      const avgAge = 17 + Math.round(rnd() * 6);
      rows.push({ date: dt, branch, region, total, followup, case_late: caseOnly + Math.round(order * .15), order_late: order, cs_late: cs,
        case_only: caseOnly, case_first: caseFirst, handled: notified, notified, notified_oc: notifiedOc,
        n_cs: Math.round(notified * .4), n_int: Math.round(notified * .4), n_ext: notified - Math.round(notified * .4) * 2,
        high: Math.round(oc * .15), repeated: Math.round(followup * .2), max_streak: 1 + d % 5,
        cod: followup * 420, cod_oc: oc * 520, sum_oage: order * avgAge, max_oage: avgAge + 10 + Math.round(rnd() * 20) });
      if (d >= 7) {
        let left = caseOnly;
        DEMO_STATUSES.forEach((st, i) => { const n = i === DEMO_STATUSES.length - 1 ? left : Math.round(caseOnly * (.3 / (i + 1))); left -= n; if (n > 0) statuses.push({ date: dt, branch, status: st, n }); });
      }
    });
  }
  const last = rows.filter((r) => r.date === rows[rows.length - 1].date);
  const repeated = last.map((r) => ({ branch: r.branch, region: r.region, count: r.repeated, notified: Math.round(r.repeated * .6), not_notified: r.repeated - Math.round(r.repeated * .6), max_streak: r.max_streak, t_cs: Math.round(r.repeated * .2), t_int: Math.round(r.repeated * .3), t_ext: Math.round(r.repeated * .1) }));
  return { rows, statuses, repeated };
}
