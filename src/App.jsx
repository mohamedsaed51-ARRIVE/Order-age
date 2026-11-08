import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChartBox from './ChartBox.jsx';
import Reports from './Reports.jsx';
import { N, fi, fp, sgn, sum, levelOf, LEVELS, toCsv, download, loadCfg, saveCfg, demoData, withRates, missingWorkDays } from './lib.js';

const ENV_URL = import.meta.env.VITE_DATA_URL;
const ENV_TOKEN = import.meta.env.VITE_DATA_TOKEN;
// حدود العرض (نسبة الأوردرات المتأخرة: الأقل أفضل). للعرض فقط وليست سياسة معتمدة.
const DEFAULTS = { url: '', refreshMin: 15, excellent: 2, good: 4, bad: 6, covMin: 50 };
const PAGE = 15;
const EMPTY = { rows: [], statuses: [], repeated: [] };

function useData(url, refreshMin, demo) {
  const [s, set] = useState({ status: 'idle', data: EMPTY, at: null });
  const run = useCallback(() => {
    if (demo) { const d = demoData(); set({ status: 'ok', data: { ...d, rows: d.rows.map(withRates) }, at: new Date(), generated: 'demo' }); return; }
    if (!url) { set({ status: 'nourl', data: EMPTY, at: null }); return; }
    const u = ENV_TOKEN ? url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(ENV_TOKEN) : url;
    set((p) => ({ ...p, status: p.data.rows.length ? 'refreshing' : 'loading' }));
    fetch(u).then((r) => r.json()).then((j) => {
      if (j.error) throw new Error(j.error);
      set({ status: 'ok', data: { rows: (j.rows || []).map(withRates), statuses: j.statuses || [], repeated: j.repeated || [] }, at: new Date(), generated: j.generated, note: j.note, meta: { hasRows: Array.isArray(j.rows), keys: Object.keys(j), tabs: j.tabs, sheets: j.sheets } });
    }).catch((e) => set((p) => ({ ...p, status: 'error', msg: String(e.message || e) })));
  }, [url, demo]);
  useEffect(() => { run(); }, [run]);
  useEffect(() => {
    if (demo || !refreshMin || !url) return undefined;
    const id = setInterval(run, refreshMin * 60000);
    return () => clearInterval(id);
  }, [run, refreshMin, url, demo]);
  return { ...s, reload: run };
}

function Delta({ cur, prev, lowerBetter, pp }) {
  if (prev == null) return <span className="d muted">لا يوجد يوم سابق</span>;
  const d = cur - prev;
  const c = Math.abs(d) < 0.05 ? 'muted' : (lowerBetter ? d < 0 : d > 0) ? 'ok' : 'bad';
  return <span className={'d ' + c}><span dir="ltr">{pp ? sgn(d) + ' نقطة' : (d > 0 ? '+' : '') + fi(d)}</span> عن اليوم السابق</span>;
}
const Badge = ({ lv }) => <span className={'chip ' + LEVELS[lv].cls}><i className={'fa-solid ' + LEVELS[lv].icon} />{LEVELS[lv].label}</span>;
const Heading = ({ tag, title, sub }) => (
  <div><div className="section-heading"><span className="tag">{tag}</span><h2>{title}</h2></div>{sub && <p className="section-sub">{sub}</p>}</div>
);

export default function App() {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULTS, ...loadCfg('oa_cfg2', {}) }));
  const [theme, setTheme] = useState(() => loadCfg('oa_theme', 'light'));
  const [demoOn, setDemoOn] = useState(() => new URLSearchParams(location.search).get('demo') === '1');
  const [view, setView] = useState(() => (new URLSearchParams(location.search).get('view') === 'reports' ? 'reports' : 'dash'));
  const [showSet, setShowSet] = useState(false);
  const url = cfg.url || ENV_URL || '';
  const { status, data, at, msg, generated, note, meta, reload } = useData(url, cfg.refreshMin, demoOn);
  const { rows, statuses, repeated } = data;

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); saveCfg('oa_theme', theme); }, [theme]);

  const dates = useMemo(() => [...new Set(rows.map((r) => r.date))].sort(), [rows]);
  const allBranches = useMemo(() => [...new Set(rows.map((r) => r.branch))].sort(), [rows]);
  const allRegions = useMemo(() => [...new Set(rows.map((r) => r.region).filter(Boolean))].sort(), [rows]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [region, setRegion] = useState('');
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ k: 'date', dir: -1 });
  const [cmp, setCmp] = useState({ on: false, a: '', b: '' });
  const [copied, setCopied] = useState('');
  const th = { excellent: +cfg.excellent, good: +cfg.good, bad: +cfg.bad };
  const covMin = +cfg.covMin;

  useEffect(() => { setFrom(''); setTo(''); }, [rows.length]);
  const dFrom = from || dates[Math.max(0, dates.length - 14)] || '';
  const dTo = to || dates[dates.length - 1] || '';

  const branchOk = (r) => (!region || r.region === region) && (!sel.length || sel.includes(r.branch)) && (!q || r.branch.includes(q));
  const inRange = rows.filter((r) => r.date >= dFrom && r.date <= dTo && branchOk(r));
  const rangeDates = [...new Set(inRange.map((r) => r.date))].sort();
  const snap = rangeDates[rangeDates.length - 1] || '';
  const S = snap || '—';
  const prevDate = [...new Set(rows.filter(branchOk).map((r) => r.date))].sort().filter((d) => d < snap).pop();
  const snapRows = inRange.filter((r) => r.date === snap);
  const prevRows = prevDate ? rows.filter((r) => r.date === prevDate && branchOk(r)) : null;
  const T = sum(snapRows), P = prevRows ? sum(prevRows) : null;
  const prevBy = new Map((prevRows || []).map((r) => [r.branch, r]));

  const reset = () => { setFrom(''); setTo(''); setRegion(''); setSel([]); setQ(''); setPage(0); };
  const exportCsv = () => download('order-age.csv', toCsv(inRange, [
    { h: 'التاريخ', k: 'date' }, { h: 'الفرع', k: 'branch' }, { h: 'الإقليم', k: 'region' }, { h: 'إجمالي الشحنات', k: 'total' },
    { h: 'أوردر متأخر (الشركة)', k: 'order_late' }, { h: 'خدمة عملاء', k: 'cs_late' }, { h: 'حالة فقط', k: 'case_only' }, { h: 'للمتابعة', k: 'followup' },
    { h: 'اتبلّغ (أوردر/خدمة)', k: 'notified_oc' }, { h: 'لم يُبلَّغ', k: 'unnotified' }, { h: 'نسبة الأوردرات المتأخرة %', k: 'rate' }, { h: 'نسبة التبليغ %', k: 'noti' },
    { h: 'تحصيل معرّض', k: 'cod_oc' }, { h: 'أولوية عالية', k: 'high' }, { h: 'متكرر', k: 'repeated' }]));
  const fullscreen = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* ignore */ } };

  /* ---------- الهيدر ---------- */
  const header = (
    <>
      <div className="top"><div className="top-inner">
        <div className="brand"><h1>Order Age</h1><p>لوحة أوديت الأوردرات المتأخرة — ARRIVE — الإدارة المالية والتدقيق الداخلي</p></div>
        <div className="hbtns">
          <div className="nav2">
            <button className={'hbtn' + (view === 'dash' ? ' on' : '')} onClick={() => setView('dash')}><i className="fa-solid fa-gauge-high" />لوحة المتابعة</button>
            <button className={'hbtn' + (view === 'reports' ? ' on' : '')} onClick={() => setView('reports')}><i className="fa-solid fa-file-lines" />التقارير</button>
          </div>
          <button className="hbtn" onClick={() => reload()} disabled={status === 'loading' || status === 'refreshing'}><i className={'fa-solid fa-rotate' + (status === 'refreshing' ? ' fa-spin' : '')} />تحديث</button>
          {view === 'dash' && <button className="hbtn" onClick={() => setCmp((c) => ({ ...c, on: !c.on, a: c.a || prevDate || dates[0] || '', b: c.b || snap || '' }))}><i className="fa-solid fa-right-left" />وضع المقارنة</button>}
          {view === 'dash' && <button className="hbtn" onClick={exportCsv}><i className="fa-solid fa-file-csv" />تصدير</button>}
          <button className="hbtn" onClick={() => setShowSet(true)}><i className="fa-solid fa-gear" />إعدادات</button>
          <button className="hbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><i className={'fa-solid ' + (theme === 'dark' ? 'fa-sun' : 'fa-moon')} />{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</button>
        </div>
      </div></div>
      {demoOn && <div className="demo"><i className="fa-solid fa-flask" /> وضع تجريبي: البيانات المعروضة غير حقيقية ولا تعبّر عن أي فرع</div>}
    </>
  );
  const modal = showSet && <Settings cfg={cfg} url={url} onClose={() => setShowSet(false)} onSave={(c) => { setCfg(c); saveCfg('oa_cfg2', c); setShowSet(false); }} />;

  /* ---------- رسالة الحالة (تظهر أعلى الصفحة؛ اللوحة كلها تظهر دائمًا حتى لو فاضية) ---------- */
  let banner = null;
  if (status === 'nourl' || status === 'idle') {
    banner = (<div className="panel"><h3><i className="fa-solid fa-plug-circle-xmark warn" /> لم يتم ضبط مصدر البيانات بعد</h3>
      <p>افتح «إعدادات» وأضف رابط Apps Script (ينتهي بـ <b className="fi">/exec</b>)، أو أضف متغير البيئة <b className="fi">VITE_DATA_URL</b> في Vercel.</p>
      <p><button className="btn" onClick={() => setShowSet(true)}>إعدادات</button> <button className="btn sec" onClick={() => setDemoOn(true)}>معاينة ببيانات تجريبية</button></p></div>);
  } else if (status === 'loading') {
    banner = <div className="alert s-progress"><i className="fa-solid fa-spinner fa-spin" /><span>جارٍ تحميل البيانات…</span></div>;
  } else if (status === 'error' && !rows.length) {
    banner = (<div className="panel"><h3 className="bad"><i className="fa-solid fa-circle-exclamation" /> تعذر تحميل البيانات</h3><p>{msg}</p>
      <p>تأكد أن الويب آب منشور بالوصول «أي شخص» وأن الرابط ينتهي بـ /exec.</p><p><button className="btn" onClick={() => reload()}>إعادة المحاولة الآن</button></p></div>);
  } else if (!rows.length) {
    const m = meta || {};
    let why = 'الويب آب رد بنجاح لكن بدون أي صفوف.';
    let todo = 'في الشيت: الصق تصدير اليوم في Raw_Daily ثم من القائمة «الأوديت اليومي» اختر «تحديث» لإنشاء تاب باسم تاريخ اليوم (مثل 2026-11-04).';
    if (m.hasRows === false) {
      why = 'الرد ليس بصيغة Order Age (لا يحتوي على rows). غالبًا الويب آب منشور من نسخة قديمة أو من كود آخر.';
      todo = 'تأكد من لصق OrdersAuditWebApp.gs (أو الملف الموحد) ثم: نشر ← إدارة عمليات النشر ← تعديل ← إصدار جديد ← نشر.';
    } else if (Array.isArray(m.tabs) && !m.tabs.length) {
      why = 'الويب آب لم يجد أي تاب يوم (اسمه بصيغة yyyy-mm-dd).';
    } else if (m.hasRows && !Array.isArray(m.tabs)) {
      todo += ' وإن كان لديك تاب يوم بالفعل فغالبًا نسخة النشر قديمة: اعمل «إصدار جديد» للنشر بعد لصق آخر كود.';
    }
    banner = (<div className="panel"><h3 className="warn"><i className="fa-solid fa-triangle-exclamation" /> لا توجد بيانات للعرض بعد</h3>
      <p>{why}</p><p>{todo}</p>
      <details><summary>تفاصيل تشخيصية</summary><pre>{JSON.stringify({ keys: m.keys, tabs: m.tabs, sheets: m.sheets, generated }, null, 1)}</pre></details>
      <p><button className="btn" onClick={() => reload()}>إعادة التحميل</button> <button className="btn sec" onClick={() => setDemoOn(true)}>معاينة ببيانات تجريبية</button></p></div>);
  }

  if (view === 'reports') {
    return (<>{header}{modal}<div className="page">{banner}</div>
      <Reports rows={rows} statuses={statuses} repeated={repeated} th={th} covMin={covMin} dates={dates} demo={demoOn} /></>);
  }

  /* ---------- حسابات ---------- */
  const board = snapRows.map((r) => {
    const p = prevBy.get(r.branch);
    return { ...r, lv: levelOf(r.rate, th), d: p ? r.rate - p.rate : null };
  }).sort((a, b) => b.rate - a.rate || b.oc - a.oc);

  const repF = repeated.filter(branchOk);
  const repAgg = repF.reduce((a, r) => ({ count: a.count + N(r.count), notified: a.notified + N(r.notified), not_notified: a.not_notified + N(r.not_notified) }), { count: 0, notified: 0, not_notified: 0 });

  const alerts = [];
  board.forEach((r) => {
    if (r.lv === 'critical') alerts.push({ c: 's-violation', i: 'fa-circle-exclamation', t: `${r.branch}: نسبة الأوردرات المتأخرة ${fp(r.rate)} أعلى من ${th.bad}%` });
    if (r.d != null && r.d >= 1) alerts.push({ c: 's-action', i: 'fa-arrow-trend-up', t: `${r.branch}: ارتفعت نسبة الأوردرات المتأخرة ${r.d.toFixed(1)} نقطة عن اليوم السابق` });
    if (r.unnotified >= 10 && r.noti < covMin) alerts.push({ c: 's-violation', i: 'fa-bell', t: `${r.branch}: ${fi(r.unnotified)} أوردر/خدمة عملاء لم يُبلَّغ بعد (التبليغ ${fp(r.noti)})` });
  });
  if (T.oc && T.noti < covMin) alerts.push({ c: 's-action', i: 'fa-clipboard-question', t: `نسبة تبليغ الأوردر وخدمة العملاء ${fp(T.noti)} أقل من ${covMin}% في ${S}` });
  if (repAgg.not_notified > 0) alerts.push({ c: 's-violation', i: 'fa-repeat', t: `${fi(repAgg.not_notified)} أوردر متكرر لم يُبلَّغ عنه` });
  const recent = dates.slice(Math.max(0, dates.indexOf(snap) - 14), dates.indexOf(snap));
  const missing = [...new Set(rows.filter((r) => recent.includes(r.date)).map((r) => r.branch))].filter((b) => (!sel.length || sel.includes(b)) && !snapRows.some((r) => r.branch === b));
  if (missing.length) alerts.push({ c: 's-action', i: 'fa-eye-slash', t: `فروع ظهرت في الأيام السابقة وغائبة عن ${S}: ${missing.join('، ')}` });
  const gapDays = [];
  for (let i = 1; i < dates.length; i++) gapDays.push(...missingWorkDays(dates[i - 1], dates[i]));
  if (gapDays.length) alerts.push({ c: 's-progress', i: 'fa-calendar-xmark', t: `أيام عمل بلا تاب أوديت (الجمعة إجازة ولا تُحسب): ${gapDays.join('، ')}` });

  const actions = board.filter((r) => r.lv === 'critical' || r.lv === 'attention').sort((a, b) => b.oc - a.oc).map((r) => {
    const reasons = [`${fi(r.oc)} أوردر/خدمة عملاء (${fp(r.rate)})`];
    const acts = [r.lv === 'critical' ? 'طلب خطة تصحيح وموعد تقفيل من الفرع' : 'متابعة الأوردرات المتأخرة مع الفرع'];
    if (r.unnotified) { reasons.push(`${fi(r.unnotified)} لم يُبلَّغ بعد`); acts.push('استكمال التبليغ وتسجيله في الشيت'); }
    if (N(r.cod_oc)) reasons.push(`تحصيل معرّض ${fi(r.cod_oc)} ج.م`);
    if (N(r.high)) reasons.push(`${fi(r.high)} أولوية عالية`);
    return { ...r, reasons, acts };
  });
  const copyActions = async () => {
    const txt = `ملخص أوديت الأوردرات ${S}\n` + actions.map((a) => `- ${a.branch}: ${a.reasons.join('، ')} | المقترح: ${a.acts.join('، ')} | المسؤول: [  ] | الموعد: [  ]`).join('\n');
    try { await navigator.clipboard.writeText(txt); setCopied('تم النسخ'); } catch { setCopied('تعذر النسخ'); }
    setTimeout(() => setCopied(''), 2500);
  };

  const big = board.filter((r) => N(r.total) >= 100);
  const worst = big.slice(0, 3), best = [...big].reverse().slice(0, 3);
  const top3Share = T.oc ? [...board].sort((a, b) => b.oc - a.oc).slice(0, 3).reduce((s, r) => s + r.oc, 0) / T.oc * 100 : 0;
  const riser = board.filter((r) => r.d != null).sort((a, b) => a.d - b.d)[0];
  const dropper = board.filter((r) => r.d != null).sort((a, b) => b.d - a.d)[0];
  const regAgg = allRegions.map((g) => ({ region: g, ...sum(snapRows.filter((r) => r.region === g)) })).filter((x) => x.total > 0);
  const stMap = {}; statuses.filter((s) => s.date === snap && branchOk(s)).forEach((s) => { stMap[s.status] = (stMap[s.status] || 0) + N(s.n); });
  const stTop = Object.entries(stMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const insights = [];
  if (worst[0]) insights.push(`أعلى نسبة أوردرات متأخرة في ${S}: ${worst[0].branch} (${fp(worst[0].rate)}).`);
  if (T.oc) insights.push(`أعلى 3 فروع في (أوردر + خدمة عملاء) تمثل ${top3Share.toFixed(0)}% من الإجمالي.`);
  if (T.order_late) insights.push(`متوسط عمر الأوردر المتأخر ${T.avg_oage.toFixed(1)} يوم، وأقدم أوردر ${fi(T.max_oage)} يوم.`);
  if (regAgg.length > 1) { const w = [...regAgg].sort((a, b) => b.rate - a.rate)[0]; insights.push(`أعلى إقليم في نسبة الأوردرات المتأخرة: ${w.region} (${fp(w.rate)}).`); }
  if (T.case_only && T.case_first / T.case_only >= 0.5) insights.push(`${fp(T.case_first / T.case_only * 100)} من «حالة فقط» عمر حالتها يساوي حدها بالضبط (أول يوم)، فراجع حدود الحالات.`);
  if (riser && riser.d < 0) insights.push(`أكبر تحسن: ${riser.branch} (${sgn(riser.d)} نقطة).`);
  if (dropper && dropper.d > 0) insights.push(`أكبر تراجع: ${dropper.branch} (${sgn(dropper.d)} نقطة).`);
  if (stTop[0]) insights.push(`أكثر حالة تأخراً: ${stTop[0][0]} (${fi(stTop[0][1])} شحنة).`);

  /* مخططات */
  const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#0837C9';
  const byOc = [...board].sort((a, b) => b.oc - a.oc);
  const byUn = [...board].sort((a, b) => b.unnotified - a.unnotified);
  const overall = rangeDates.map((d) => +sum(inRange.filter((r) => r.date === d)).rate.toFixed(2));
  const notiTrend = rangeDates.map((d) => +sum(inRange.filter((r) => r.date === d)).noti.toFixed(1));
  const lineCols = [cv('--chart-2'), cv('--status-action'), cv('--status-violation')];
  const trendSets = [{ label: 'الإجمالي', data: overall, borderColor: cv('--chart-1'), backgroundColor: cv('--chart-1'), tension: .25, borderWidth: 3, pointRadius: 3 }].concat(
    worst.map((w, i) => ({ label: w.branch, data: rangeDates.map((d) => { const r = inRange.find((x) => x.date === d && x.branch === w.branch); return r ? +r.rate.toFixed(2) : null; }), borderColor: lineCols[i], backgroundColor: lineCols[i], tension: .25, borderWidth: 2, pointRadius: 2, spanGaps: true })));

  /* جدول السجل */
  const histCols = [['date', 'التاريخ'], ['branch', 'الفرع'], ['region', 'الإقليم'], ['total', 'الشحنات'], ['order_late', 'أوردر'], ['cs_late', 'خدمة عملاء'], ['case_only', 'حالة فقط'], ['unnotified', 'لم يُبلَّغ'], ['noti', 'التبليغ'], ['rate', 'نسبة الأوردرات المتأخرة'], ['cod_oc', 'تحصيل معرّض']];
  const txt = ['branch', 'region', 'date'];
  const hist = [...inRange].sort((a, b) => { const x = txt.includes(sort.k) ? a[sort.k] : N(a[sort.k]); const y = txt.includes(sort.k) ? b[sort.k] : N(b[sort.k]); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  const pages = Math.max(1, Math.ceil(hist.length / PAGE));
  const pg = Math.min(page, pages - 1);

  /* المقارنة */
  const cmpSum = (d) => sum(rows.filter((r) => r.date === d && branchOk(r)));
  const A = cmp.on ? cmpSum(cmp.a) : null, B = cmp.on ? cmpSum(cmp.b) : null;

  const connLabel = status === 'error' ? 'خطأ في الاتصال' : demoOn ? 'تجريبي' : status === 'refreshing' ? 'جارٍ التحديث' : (status === 'nourl' || status === 'idle') ? 'غير مضبوط' : status === 'loading' ? 'جارٍ التحميل' : 'متصل';
  const connCls = status === 'error' ? 's-violation' : (demoOn || status === 'nourl' || status === 'idle') ? 's-action' : 's-success';

  return (
    <>
      {header}{modal}
      <div className="page">
        {banner}
        <div className="meta">
          <span className={'chip ' + connCls}><span className="dot" />{connLabel}</span>
          <span>آخر تحديث للبيانات: <b className="fi">{generated && generated !== 'demo' ? generated.slice(0, 16).replace('T', ' ') + ' UTC' : at ? at.toLocaleString('en-GB') : '—'}</b></span>
          <span>يوم الأوديت المعروض: <b className="fi">{S}</b></span>
          <span>الأيام: <b className="fi">{dates.length}</b></span>
          <span>الفروع: <b className="fi">{allBranches.length}</b></span>
          <span>الأعداد من تابات الأيام في الشيت (مجمّعة بدون بيانات شحنات)</span>
        </div>
        {note === 'cached' && <div className="alert s-progress"><i className="fa-solid fa-bolt" /><span>بعض الأيام القديمة معروضة من الذاكرة المؤقتة.</span></div>}

        <div className="control">
          <div>المعروض بعد الفلاتر: <b className="fi">{fi(inRange.length)}</b> صف
            {alerts.length > 0 && <span className="chip s-violation" style={{ marginInlineStart: 10 }}><i className="fa-solid fa-bell" />{alerts.length} تنبيه</span>}
          </div>
          <div className="qa">
            <button className="qa-btn" onClick={() => setView('reports')}><i className="fa-solid fa-file-lines" />التقارير</button>
            <button className="qa-btn" onClick={() => reload()}><i className="fa-solid fa-rotate" />تحديث</button>
            <button className="qa-btn" onClick={reset}><i className="fa-solid fa-filter-circle-xmark" />إعادة تصفية</button>
            <button className="qa-btn" onClick={exportCsv}><i className="fa-solid fa-file-csv" />تصدير CSV</button>
            <button className="qa-btn" onClick={() => window.print()}><i className="fa-solid fa-print" />طباعة</button>
            <button className="qa-btn" onClick={fullscreen}><i className="fa-solid fa-expand" />ملء الشاشة</button>
          </div>
        </div>

        <div className="filters">
          <div className="fgrid">
            <div className="fgroup"><label htmlFor="f-from">من تاريخ</label><select id="f-from" value={dFrom} onChange={(e) => { setFrom(e.target.value); setPage(0); }}>{dates.map((d) => <option key={d}>{d}</option>)}</select></div>
            <div className="fgroup"><label htmlFor="f-to">إلى تاريخ</label><select id="f-to" value={dTo} onChange={(e) => { setTo(e.target.value); setPage(0); }}>{[...dates].reverse().map((d) => <option key={d}>{d}</option>)}</select></div>
            <div className="fgroup"><label htmlFor="f-reg">الإقليم</label><select id="f-reg" value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }}><option value="">كل الأقاليم</option>{allRegions.map((g) => <option key={g}>{g}</option>)}</select></div>
            <div className="fgroup"><label htmlFor="f-q">بحث بالفرع</label><input id="f-q" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="اسم الفرع" /></div>
          </div>
          <div className="fgroup" style={{ marginTop: 10 }}><label>الفروع</label>
            <div className="multi">{allBranches.map((b) => <button key={b} className={sel.includes(b) ? 'on' : ''} onClick={() => { setSel(sel.includes(b) ? sel.filter((x) => x !== b) : [...sel, b]); setPage(0); }}>{b}</button>)}</div></div>
          <div className="active-filters">
            {(from || to) && <span className="afchip">الفترة: {dFrom} ← {dTo}<button aria-label="إزالة" onClick={() => { setFrom(''); setTo(''); }}>✕</button></span>}
            {region && <span className="afchip">الإقليم: {region}<button aria-label="إزالة" onClick={() => setRegion('')}>✕</button></span>}
            {sel.map((b) => <span className="afchip" key={b}>{b}<button aria-label="إزالة" onClick={() => setSel(sel.filter((x) => x !== b))}>✕</button></span>)}
            {q && <span className="afchip">بحث: {q}<button aria-label="إزالة" onClick={() => setQ('')}>✕</button></span>}
          </div>
        </div>

        <Heading tag="اليوم" title={`الصورة العامة — ‎${S}‎`} sub="الأنواع الثلاثة لا تتداخل: الشحنة تُحسب في نوع واحد (أوردر الشركة، ثم خدمة العملاء، ثم حالة فقط)، ومجموعها = للمتابعة." />
        <div className="kpi-row">
          <div className="kpi"><span className="l">للمتابعة (فريد)</span><span className="v">{fi(T.followup)}</span>
            <span className="d muted">{fp(T.fu_rate)} من {fi(T.total)} شحنة</span><br /><Delta cur={T.followup} prev={P && P.followup} lowerBetter /></div>
          <div className="kpi accent-bad"><span className="l">أوردر متأخر (الشركة)</span><span className="v">{fi(T.order_late)}</span>
            <span className="d muted">{T.order_late ? `متوسط العمر ${T.avg_oage.toFixed(1)} يوم · أقدم ${fi(T.max_oage)} يوم` : 'لا يوجد'}</span><br /><Delta cur={T.order_late} prev={P && P.order_late} lowerBetter /></div>
          <div className="kpi accent-teal"><span className="l">خدمة عملاء (قبل حد الشركة)</span><span className="v">{fi(T.cs_late)}</span>
            <span className="d muted">بين حد خدمة العملاء وحد الشركة</span><br /><Delta cur={T.cs_late} prev={P && P.cs_late} lowerBetter /></div>
          <div className="kpi accent-warn"><span className="l">حالة فقط</span><span className="v">{fi(T.case_only)}</span>
            <span className="d muted">منها {fi(T.case_first)} عند الحد نفسه (أول يوم)</span><br /><Delta cur={T.case_only} prev={P && P.case_only} lowerBetter /></div>
        </div>
        <Heading tag="تبليغ" title="التبليغ والتصعيد" sub="أوردر الشركة وخدمة العملاء هما المطلوب تبليغهما؛ «لم يُبلَّغ بعد» = بلا نوع تبليغ مسجل في تاب اليوم." />
        <div className="kpi-row">
          <div className="kpi accent-bad"><span className="l">أوردر/خدمة: لم يُبلَّغ بعد</span><span className="v">{fi(T.unnotified)}</span>
            <span className="d muted">من {fi(T.oc)} مطلوب تبليغها</span><br /><Delta cur={T.unnotified} prev={P && P.unnotified} lowerBetter /></div>
          <div className={'kpi ' + (T.noti >= covMin ? 'accent-ok' : 'accent-bad')}><span className="l">نسبة التبليغ</span><span className="v">{fp(T.noti)}</span>
            <span className="d muted">{fi(T.notified_oc)} اتبلّغ من {fi(T.oc)}</span><br /><Delta cur={T.noti} prev={P && P.noti} lowerBetter={false} pp /></div>
          <div className="kpi"><span className="l">أوردرات متكررة (آخر تحديث)</span><span className="v">{fi(repAgg.count)}</span>
            <span className="d muted">{fi(repAgg.notified)} اتبلّغ · {fi(repAgg.not_notified)} لم يُبلَّغ</span></div>
          <div className="kpi accent-bad"><span className="l">التحصيل المعرّض (ج.م)</span><span className="v">{fi(T.cod_oc)}</span>
            <span className="d muted">لأوردرات الشركة وخدمة العملاء</span><br /><Delta cur={T.cod_oc} prev={P && P.cod_oc} lowerBetter /></div>
        </div>

        <Heading tag="أداء" title="صحة الفروع" sub={`حسب نسبة الأوردرات المتأخرة = (أوردر + خدمة عملاء) ÷ شحنات الفرع، الأقل أفضل: ممتاز ≤ ${th.excellent}% — جيد ≤ ${th.good}% — يحتاج انتباه ≤ ${th.bad}% — حرج أعلى من ذلك (حدود للعرض وليست سياسة معتمدة)`} />
        <div className="panel tscroll"><table>
          <thead><tr><th>الفرع</th><th>الإقليم</th><th>الشحنات</th><th>أوردر</th><th>خدمة عملاء</th><th>حالة فقط</th><th>لم يُبلَّغ</th><th>التبليغ</th><th>نسبة الأوردرات المتأخرة</th><th>التغيير (نقطة)</th><th>تحصيل معرّض</th><th>المستوى</th></tr></thead>
          <tbody>{board.length === 0 && <tr><td colSpan={12} className="muted">لا توجد بيانات</td></tr>}{board.map((r) => (
            <tr key={r.branch}><td>{r.branch}</td><td className="muted">{r.region}</td><td className="n">{fi(r.total)}</td><td className="n">{fi(r.order_late)}</td><td className="n">{fi(r.cs_late)}</td><td className="n">{fi(r.case_only)}</td>
              <td className={'n ' + (r.unnotified ? 'bad' : '')}>{fi(r.unnotified)}</td><td className="n">{r.oc ? fp(r.noti) : '—'}</td><td className="n"><b>{fp(r.rate)}</b></td>
              <td className={'n ' + (r.d == null ? 'muted' : r.d < 0 ? 'ok' : r.d > 0 ? 'bad' : 'muted')} dir="ltr" style={{ textAlign: 'right' }}>{r.d == null ? '—' : sgn(r.d)}</td>
              <td className="n">{fi(r.cod_oc)}</td><td><Badge lv={r.lv} /></td></tr>))}</tbody>
        </table></div>

        <Heading tag="اتجاهات" title="الاتجاهات والتوزيعات" />
        <div className="panel-grid">
          <div className="panel"><h3>اتجاه نسبة الأوردرات المتأخرة</h3><p className="panel-sub">الإجمالي وأعلى 3 فروع في {S}</p>
            <div className="chart-wrap tall"><ChartBox type="line" theme={theme} labels={rangeDates} datasets={trendSets} pct /></div></div>
          <div className="panel"><h3>اتجاه نسبة التبليغ</h3><p className="panel-sub">أوردر/خدمة اتبلّغ ÷ المطلوب تبليغها</p>
            <div className="chart-wrap tall"><ChartBox type="line" theme={theme} legend={false} labels={rangeDates} datasets={[{ label: 'التبليغ', data: notiTrend, borderColor: cv('--status-success'), backgroundColor: cv('--status-success'), tension: .25, borderWidth: 3, pointRadius: 3 }]} pct /></div></div>
          <div className="panel"><h3>أنواع التأخر حسب الفرع</h3><p className="panel-sub">أوردر الشركة / خدمة العملاء / حالة فقط (بدون تداخل)</p>
            <div className="chart-wrap tall"><ChartBox type="bar" theme={theme} horizontal stacked labels={byOc.map((r) => r.branch)} datasets={[
              { label: 'أوردر (الشركة)', data: byOc.map((r) => N(r.order_late)), backgroundColor: cv('--status-violation') },
              { label: 'خدمة عملاء', data: byOc.map((r) => N(r.cs_late)), backgroundColor: cv('--chart-2') },
              { label: 'حالة فقط', data: byOc.map((r) => N(r.case_only)), backgroundColor: cv('--status-action') }]} /></div></div>
          <div className="panel"><h3>توزيع أنواع التأخر</h3><p className="panel-sub">إجمالي {S}</p>
            <div className="chart-wrap"><ChartBox type="doughnut" theme={theme} labels={['أوردر (الشركة)', 'خدمة عملاء', 'حالة فقط']} datasets={[{ data: [T.order_late, T.cs_late, T.case_only], backgroundColor: [cv('--status-violation'), cv('--chart-2'), cv('--status-action')], borderWidth: 0 }]} /></div></div>
          <div className="panel"><h3>لم يُبلَّغ بعد حسب الفرع</h3><p className="panel-sub">أوردر + خدمة عملاء بلا تبليغ مسجل</p>
            <div className="chart-wrap"><ChartBox type="bar" theme={theme} legend={false} labels={byUn.map((r) => r.branch)} datasets={[{ label: 'لم يُبلَّغ', data: byUn.map((r) => r.unnotified), backgroundColor: cv('--status-violation') }]} /></div></div>
          <div className="panel"><h3>نسبة الأوردرات المتأخرة حسب الإقليم</h3><p className="panel-sub">{S}</p>
            <div className="chart-wrap"><ChartBox type="bar" theme={theme} legend={false} pct labels={regAgg.map((x) => x.region)} datasets={[{ label: 'النسبة', data: regAgg.map((x) => +x.rate.toFixed(2)), backgroundColor: cv('--chart-1') }]} /></div></div>
          <div className="panel"><h3>أكثر الحالات تأخراً</h3><p className="panel-sub">{stTop.length ? `تأخر الحالة — ${S}` : 'بيانات الحالات متاحة لآخر 14 يوم فقط'}</p>
            <div className="chart-wrap">{stTop.length ? <ChartBox type="bar" theme={theme} horizontal legend={false} labels={stTop.map((x) => x[0])} datasets={[{ label: 'شحنات', data: stTop.map((x) => x[1]), backgroundColor: cv('--chart-3') }]} /> : <p className="muted">لا توجد حالات متأخرة لهذا اليوم/الفلاتر.</p>}</div></div>
          <div className="panel"><h3>التبليغات المسجلة — {S}</h3><p className="panel-sub">حسب نوع التبليغ (كل الشحنات)</p>
            <div className="chart-wrap"><ChartBox type="doughnut" theme={theme} labels={['خدمة عملاء', 'فروع داخلية', 'فروع خارجية']} datasets={[{ data: [T.n_cs, T.n_int, T.n_ext], backgroundColor: [cv('--chart-2'), cv('--chart-1'), cv('--chart-4')], borderWidth: 0 }]} /></div></div>
        </div>

        <Heading tag="تصعيد" title="الأوردرات المتكررة" sub="شحنة ظهرت متأخرة في أيام متتالية، من آخر تحديث للشيت." />
        <div className="panel tscroll">
          {repF.length ? <table>
            <thead><tr><th>الفرع</th><th>متكرر</th><th>اتبلّغ</th><th>لم يُبلَّغ</th><th>أقصى تتابع</th></tr></thead>
            <tbody>{[...repF].sort((a, b) => N(b.count) - N(a.count)).map((r) => (
              <tr key={r.branch}><td>{r.branch}</td><td className="n">{fi(r.count)}</td><td className="n">{fi(r.notified)}</td><td className={'n ' + (N(r.not_notified) ? 'bad' : '')}>{fi(r.not_notified)}</td><td className="n">{fi(r.max_streak)} يوم</td></tr>))}</tbody>
          </table> : <p className="muted">لا توجد أوردرات متكررة حالياً (تحتاج يومين متتاليين على الأقل).</p>}
        </div>

        <Heading tag="استثناءات" title="مركز التنبيهات" sub="محسوبة آليًا من البيانات" />
        <div className="panel">{alerts.length === 0 ? <p className={rows.length ? 'ok' : 'muted'}><i className="fa-solid fa-circle-check" /> {rows.length ? 'لا توجد تنبيهات في هذه الفترة' : 'لا توجد بيانات لحساب التنبيهات'}</p> :
          alerts.map((a, i) => <div className={'alert ' + a.c} key={i}><i className={'fa-solid ' + a.i} /><span>{a.t}</span></div>)}</div>

        <Heading tag="إجراءات" title="مركز الإجراءات" sub="إجراءات مقترحة من قواعد عامة وليست قرارات معتمدة. المسؤول والموعد تحددهما الإدارة." />
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="qa-btn" onClick={copyActions}><i className="fa-solid fa-copy" />{copied || 'نسخ ملخص الإجراءات'}</button></div>
          {actions.length === 0 && <p className={rows.length ? 'ok' : 'muted'}>{rows.length ? `لا توجد فروع فوق الحدود في ${S}.` : 'لا توجد بيانات.'}</p>}
          {actions.map((a, i) => (
            <div className={'act ' + a.lv} key={a.branch}>
              <div className="h"><b>{i + 1}. {a.branch}</b><Badge lv={a.lv} /></div>
              <div className="reasons">{a.reasons.map((x) => <span key={x}>{x}</span>)}</div>
              <div className="muted">المقترح: {a.acts.join('، ')}</div>
            </div>))}
        </div>

        <Heading tag="رؤى" title="رؤى للإدارة" sub="مبنية على قواعد آلية وليست ذكاءً اصطناعيًا" />
        <div className="panel-grid">
          <div className="panel"><h3>أبرز الملاحظات</h3>{insights.length ? insights.map((t) => <div className="insight" key={t}><i className="fa-solid fa-lightbulb" /><span>{t}</span></div>) : <p className="muted">لا توجد بيانات.</p>}</div>
          <div className="panel"><h3>أعلى وأقل نسبة أوردرات متأخرة</h3><p className="panel-sub">فروع 100 شحنة فأكثر</p>
            <b className="warn">الأعلى (الأسوأ)</b>{worst.map((r) => <div className="perf" key={r.branch}><span>{r.branch}</span><b className="n bad">{fp(r.rate)}</b></div>)}
            <b className="ok" style={{ display: 'block', marginTop: 8 }}>الأقل (الأفضل)</b>{best.map((r) => <div className="perf" key={r.branch}><span>{r.branch}</span><b className="n ok">{fp(r.rate)}</b></div>)}</div>
        </div>

        {cmp.on && (<>
          <Heading tag="Compare" title="وضع المقارنة" sub="قارن يومين بنفس الفلاتر الحالية" />
          <div className="panel">
            <div className="fgrid">
              <div className="fgroup"><label htmlFor="c-a">اليوم الأول</label><select id="c-a" value={cmp.a} onChange={(e) => setCmp({ ...cmp, a: e.target.value })}>{dates.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div className="fgroup"><label htmlFor="c-b">اليوم الثاني</label><select id="c-b" value={cmp.b} onChange={(e) => setCmp({ ...cmp, b: e.target.value })}>{dates.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div><button className="qa-btn" onClick={() => setCmp({ ...cmp, a: cmp.b, b: cmp.a })}><i className="fa-solid fa-right-left" />تبديل</button> <button className="qa-btn" onClick={() => setCmp({ ...cmp, on: false })}>إغلاق</button></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="cmp-row"><b>المؤشر</b><b className="fi">{cmp.a}</b><b className="fi">{cmp.b}</b></div>
              {[['إجمالي الشحنات', 'total', false, false], ['للمتابعة', 'followup', true, false], ['أوردر متأخر (الشركة)', 'order_late', true, false], ['خدمة عملاء', 'cs_late', true, false], ['حالة فقط', 'case_only', true, false], ['لم يُبلَّغ بعد', 'unnotified', true, false], ['نسبة التبليغ', 'noti', false, true], ['نسبة الأوردرات المتأخرة', 'rate', true, true], ['التحصيل المعرّض', 'cod_oc', true, false]].map(([l, k, lb, isPct]) => {
                const d = B[k] - A[k]; const good = lb ? d < 0 : d > 0;
                return <div className="cmp-row" key={k}><span>{l}</span><span className="n">{isPct ? fp(A[k]) : fi(A[k])}</span>
                  <span className="n">{isPct ? fp(B[k]) : fi(B[k])} <small className={d === 0 || k === 'total' ? 'muted' : good ? 'ok' : 'bad'} dir="ltr">({isPct ? sgn(d) + ' نقطة' : (d > 0 ? '+' : '') + fi(d)})</small></span></div>;
              })}
            </div>
          </div>
        </>)}

        <Heading tag="سجل" title="سجل الأوديت اليومي" sub="كل يوم وفرع ضمن الفلاتر" />
        <div className="panel">
          <div className="tscroll"><table>
            <thead><tr>{histCols.map(([k, h]) => <th key={k} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : -1 })}>{h}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
            <tbody>{hist.length === 0 && <tr><td colSpan={11} className="muted">لا توجد بيانات</td></tr>}{hist.slice(pg * PAGE, pg * PAGE + PAGE).map((r) => (
              <tr key={r.date + r.branch}><td className="n">{r.date}</td><td>{r.branch}</td><td className="muted">{r.region}</td><td className="n">{fi(r.total)}</td><td className="n">{fi(r.order_late)}</td><td className="n">{fi(r.cs_late)}</td><td className="n">{fi(r.case_only)}</td><td className="n">{fi(r.unnotified)}</td><td className="n">{r.oc ? fp(r.noti) : '—'}</td><td className="n">{fp(r.rate)}</td><td className="n">{fi(r.cod_oc)}</td></tr>))}</tbody>
          </table></div>
          <div className="pager"><span>صفحة {pg + 1} من {pages} — {fi(hist.length)} صف</span>
            <span><button className="qa-btn" disabled={pg === 0} onClick={() => setPage(pg - 1)}>السابق</button> <button className="qa-btn" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>التالي</button></span></div>
        </div>

        <div className="foot">
          <b>التعريفات:</b> عمر الحالة = تاريخ التقرير − تاريخ آخر حالة، مقارنًا بحد كل حالة شحنة. عمر الأوردر = تاريخ التقرير − تاريخ البيك أب، مقارنًا بحد الشركة وحد خدمة العملاء لفرع العضو؛ و«خدمة العملاء» نافذة من حد خدمة العملاء حتى قبل حد الشركة وتختفي بعده. الأنواع (أوردر الشركة / خدمة العملاء / حالة فقط) لا تتداخل. نسبة الأوردرات المتأخرة = (أوردر + خدمة عملاء) ÷ شحنات الفرع. نسبة التبليغ = (أوردر/خدمة اتبلّغ) ÷ (أوردر + خدمة). التحصيل المعرّض = مبلغ التحصيل لأوردرات الشركة وخدمة العملاء. الحدود في ورقة Rules بالشيت. مستويات الصحة ومقترحات الإجراءات للعرض وتحتاج اعتماد الإدارة.
        </div>
      </div>
    </>
  );
}

function Settings({ cfg, url, onSave, onClose }) {
  const [c, setC] = useState({ ...cfg });
  const set = (k, v) => setC({ ...c, [k]: v });
  return (
    <div className="modal-bg" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="إعدادات مصدر البيانات">
      <h3>إعدادات مصدر البيانات</h3>
      <div className="fgroup"><label htmlFor="s-url">رابط Apps Script (ينتهي بـ /exec)</label><input id="s-url" dir="ltr" value={c.url} placeholder={url || 'https://script.google.com/macros/s/…/exec'} onChange={(e) => set('url', e.target.value.trim())} /></div>
      <div className="fgroup"><label htmlFor="s-ref">التحديث التلقائي</label><select id="s-ref" value={c.refreshMin} onChange={(e) => set('refreshMin', +e.target.value)}>{[[0, 'إيقاف'], [5, 'كل 5 دقائق'], [15, 'كل 15 دقيقة'], [30, 'كل 30 دقيقة'], [60, 'كل ساعة']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="fgrid">
        <div className="fgroup"><label htmlFor="s-e">ممتاز حتى %</label><input id="s-e" type="number" min="0" max="100" step="0.5" value={c.excellent} onChange={(e) => set('excellent', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-g">جيد حتى %</label><input id="s-g" type="number" min="0" max="100" step="0.5" value={c.good} onChange={(e) => set('good', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-b">يحتاج انتباه حتى %</label><input id="s-b" type="number" min="0" max="100" step="0.5" value={c.bad} onChange={(e) => set('bad', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-c">حد نسبة التبليغ الأدنى %</label><input id="s-c" type="number" min="0" max="100" value={c.covMin} onChange={(e) => set('covMin', +e.target.value)} /></div>
      </div>
      <p className="muted" style={{ fontSize: '.8rem' }}>الحدود على «نسبة الأوردرات المتأخرة» (الأقل أفضل). الإعدادات تُحفظ في هذا المتصفح فقط، وهي للعرض وليست سياسة معتمدة.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn sec" onClick={onClose}>إلغاء</button><button className="btn" onClick={() => onSave(c)}>حفظ والاتصال</button></div>
    </div></div>
  );
}
