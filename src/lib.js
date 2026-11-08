export const N = (v) => (v == null || v === '' ? 0 : +v);
export const fi = (v) => Number(v).toLocaleString('en-US');
export const fp = (v) => Number(v).toFixed(1) + '%';
export const sgn = (d, f = 1) => (d > 0 ? '+' : '') + d.toFixed(f);

// مفاتيح الأعداد في كل صف (يوم × فرع) كما يرسلها الويب آب
export const KEYS = ['total', 'followup', 'case_late', 'order_late', 'cs_late', 'handled', 'n_cs', 'n_int', 'n_ext', 'high', 'repeated'];

export function sum(rows) {
  const t = {};
  KEYS.forEach((k) => { t[k] = 0; });
  rows.forEach((r) => KEYS.forEach((k) => { t[k] += N(r[k]); }));
  t.rate = t.total ? (t.followup / t.total) * 100 : 0;      // نسبة المتابعة (الأقل أفضل)
  t.cov = t.followup ? (t.handled / t.followup) * 100 : 0;  // نسبة التغطية (الأعلى أفضل)
  return t;
}

// مستويات الصحة حسب نسبة المتابعة (الأقل أفضل). الحدود افتراضية للعرض وليست سياسة معتمدة.
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

// يضيف النسب لكل صف بعد التحميل
export const withRates = (r) => ({ ...r, rate: N(r.total) ? (N(r.followup) / N(r.total)) * 100 : 0, cov: N(r.followup) ? (N(r.handled) / N(r.followup)) * 100 : 0 });

/* ---------------- بيانات تجريبية للمعاينة فقط (غير حقيقية) ---------------- */
const DEMO_BRANCHES = [
  ['فرع أ', 'القاهره و الاسكندريه', .1], ['فرع ب', 'القاهره و الاسكندريه', .16], ['فرع ج', 'القاهره و الاسكندريه', .07],
  ['فرع د', 'القاهره و الاسكندريه', .22], ['فرع هـ', 'القاهره و الاسكندريه', .12], ['فرع و', 'القاهره و الاسكندريه', .27],
  ['فرع ز', 'الدلتا و القنال', .09], ['فرع ح', 'الدلتا و القنال', .18], ['فرع ط', 'الدلتا و القنال', .13],
  ['فرع ي', 'الدلتا و القنال', .05], ['فرع ك', 'الصعيد', .24], ['فرع ل', 'الصعيد', .15]
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
      const fol = Math.round(total * Math.max(0.01, base + (rnd() - .5) * .06 + d * .002));
      const cs = Math.round(fol * (.15 + rnd() * .15));
      const order = Math.round(fol * (.05 + rnd() * .08));
      const kase = Math.max(0, fol - Math.round(fol * .12));
      const handled = Math.round(fol * Math.min(1, .3 + d * .04 + rnd() * .2));
      const high = Math.round(fol * (.04 + rnd() * .05));
      rows.push({ date: dt, branch, region, total, followup: fol, case_late: kase, order_late: order, cs_late: cs, handled,
        n_cs: Math.round(handled * .4), n_int: Math.round(handled * .4), n_ext: Math.round(handled * .1), high, repeated: Math.round(fol * .3), max_streak: 1 + d % 5 });
      if (d >= 7) {
        let left = kase;
        DEMO_STATUSES.forEach((st, i) => { const n = i === DEMO_STATUSES.length - 1 ? left : Math.round(kase * (.3 / (i + 1))); left -= n; if (n > 0) statuses.push({ date: dt, branch, status: st, n }); });
      }
    });
  }
  const last = rows.filter((r) => r.date === rows[rows.length - 1].date);
  const repeated = last.map((r) => ({ branch: r.branch, region: r.region, count: r.repeated, notified: Math.round(r.repeated * .6), not_notified: Math.round(r.repeated * .4), max_streak: r.max_streak, t_cs: Math.round(r.repeated * .2), t_int: Math.round(r.repeated * .3), t_ext: Math.round(r.repeated * .1) }));
  return { rows, statuses, repeated };
}
