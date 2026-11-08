import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChartBox from './ChartBox.jsx';
import { N, fi, fp, sgn, sum, levelOf, LEVELS, toCsv, download, loadCfg, saveCfg, demoData, withRates, missingWorkDays } from './lib.js';

const ENV_URL = import.meta.env.VITE_DATA_URL;
const ENV_TOKEN = import.meta.env.VITE_DATA_TOKEN;
// حدود العرض (نسبة المتابعة: الأقل أفضل). للعرض فقط وليست سياسة معتمدة.
const DEFAULTS = { url: '', refreshMin: 15, excellent: 5, good: 10, bad: 20, covMin: 50 };
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
      set({ status: 'ok', data: { rows: (j.rows || []).map(withRates), statuses: j.statuses || [], repeated: j.repeated || [] }, at: new Date(), generated: j.generated, note: j.note });
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
  const c = d === 0 ? 'muted' : (lowerBetter ? d < 0 : d > 0) ? 'ok' : 'bad';
  return <span className={'d ' + c}><span dir="ltr">{pp ? sgn(d) + ' نقطة' : (d > 0 ? '+' : '') + fi(d)}</span> عن اليوم السابق</span>;
}
const Badge = ({ lv }) => <span className={'chip ' + LEVELS[lv].cls}><i className={'fa-solid ' + LEVELS[lv].icon} />{LEVELS[lv].label}</span>;
const Heading = ({ tag, title, sub }) => (
  <div><div className="section-heading"><span className="tag">{tag}</span><h2>{title}</h2></div>{sub && <p className="section-sub">{sub}</p>}</div>
);

export default function App() {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULTS, ...loadCfg('oa_cfg', {}) }));
  const [theme, setTheme] = useState(() => loadCfg('oa_theme', 'light'));
  const [demoOn, setDemoOn] = useState(() => new URLSearchParams(location.search).get('demo') === '1');
  const [showSet, setShowSet] = useState(false);
  const url = cfg.url || ENV_URL || '';
  const { status, data, at, msg, generated, note, reload } = useData(url, cfg.refreshMin, demoOn);
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

  useEffect(() => { setFrom(''); setTo(''); }, [rows.length]);
  const dFrom = from || dates[Math.max(0, dates.length - 14)] || '';
  const dTo = to || dates[dates.length - 1] || '';

  const branchOk = (r) => (!region || r.region === region) && (!sel.length || sel.includes(r.branch)) && (!q || r.branch.includes(q));
  const inRange = rows.filter((r) => r.date >= dFrom && r.date <= dTo && branchOk(r));
  const rangeDates = [...new Set(inRange.map((r) => r.date))].sort();
  const snap = rangeDates[rangeDates.length - 1];
  const prevDate = [...new Set(rows.filter(branchOk).map((r) => r.date))].sort().filter((d) => d < snap).pop();
  const snapRows = inRange.filter((r) => r.date === snap);
  const prevRows = prevDate ? rows.filter((r) => r.date === prevDate && branchOk(r)) : null;
  const T = sum(snapRows), P = prevRows ? sum(prevRows) : null;
  const prevBy = new Map((prevRows || []).map((r) => [r.branch, r]));

  const reset = () => { setFrom(''); setTo(''); setRegion(''); setSel([]); setQ(''); setPage(0); };
  const exportCsv = () => download('orders-audit.csv', toCsv(inRange, [
    { h: 'التاريخ', k: 'date' }, { h: 'الفرع', k: 'branch' }, { h: 'الإقليم', k: 'region' }, { h: 'إجمالي الشحنات', k: 'total' },
    { h: 'للمتابعة', k: 'followup' }, { h: 'نسبة المتابعة %', k: 'rate' }, { h: 'حالة متأخرة', k: 'case_late' }, { h: 'أوردر متأخر (الشركة)', k: 'order_late' },
    { h: 'تبليغ خدمة عملاء', k: 'cs_late' }, { h: 'تم التعامل', k: 'handled' }, { h: 'نسبة التغطية %', k: 'cov' }, { h: 'أولوية عالية', k: 'high' }, { h: 'متكرر', k: 'repeated' }]));
  const fullscreen = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch { /* ignore */ } };

  /* ---------- الهيدر وحالات ما قبل العرض ---------- */
  const header = (
    <>
      <div className="top"><div className="top-inner">
        <div className="brand"><h1>Order Age</h1><p>لوحة أوديت الأوردرات المتأخرة — ARRIVE — الإدارة المالية والتدقيق الداخلي</p></div>
        <div className="hbtns">
          <button className="hbtn" onClick={() => reload()} disabled={status === 'loading' || status === 'refreshing'}><i className={'fa-solid fa-rotate' + (status === 'refreshing' ? ' fa-spin' : '')} />تحديث</button>
          <button className="hbtn" onClick={() => setCmp((c) => ({ ...c, on: !c.on, a: c.a || prevDate || dates[0] || '', b: c.b || snap || '' }))}><i className="fa-solid fa-right-left" />وضع المقارنة</button>
          <button className="hbtn" onClick={exportCsv}><i className="fa-solid fa-file-csv" />تصدير</button>
          <button className="hbtn" onClick={() => setShowSet(true)}><i className="fa-solid fa-gear" />إعدادات</button>
          <button className="hbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><i className={'fa-solid ' + (theme === 'dark' ? 'fa-sun' : 'fa-moon')} />{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</button>
        </div>
      </div></div>
      {demoOn && <div className="demo"><i className="fa-solid fa-flask" /> وضع تجريبي: البيانات المعروضة غير حقيقية ولا تعبّر عن أي فرع</div>}
    </>
  );
  const modal = showSet && <Settings cfg={cfg} url={url} onClose={() => setShowSet(false)} onSave={(c) => { setCfg(c); saveCfg('oa_cfg', c); setShowSet(false); }} />;

  if (status === 'nourl' || status === 'idle') {
    return (<>{header}{modal}<div className="empty"><h2>لم يتم ضبط مصدر البيانات بعد</h2>
      <p>افتح «إعدادات» وأضف رابط Apps Script (ينتهي بـ <b className="fi">/exec</b>)، أو أضف متغير البيئة في Vercel:</p>
      <pre>VITE_DATA_URL=https://script.google.com/macros/s/XXXX/exec</pre>
      <button className="btn" onClick={() => setDemoOn(true)}>معاينة ببيانات تجريبية</button></div></>);
  }
  if (status === 'loading') return <>{header}{modal}<div className="empty muted">جارٍ تحميل البيانات…</div></>;
  if (status === 'error' && !rows.length) return <>{header}{modal}<div className="empty"><h2 className="bad">تعذر تحميل البيانات</h2><p>{msg}</p><button className="btn" onClick={() => reload()}>إعادة المحاولة الآن</button></div></>;
  if (!rows.length) return <>{header}{modal}<div className="empty"><p>لا توجد بيانات بعد. شغّل «تحديث» في الشيت لإنشاء تاب اليوم.</p></div></>;

  /* ---------- حسابات ---------- */
  const board = snapRows.map((r) => {
    const p = prevBy.get(r.branch);
    return { ...r, lv: levelOf(r.rate, th), d: p ? r.rate - p.rate : null };
  }).sort((a, b) => b.rate - a.rate);

  const alerts = [];
  board.forEach((r) => {
    if (r.lv === 'critical') alerts.push({ c: 's-violation', i: 'fa-circle-exclamation', t: `${r.branch}: نسبة المتابعة ${fp(r.rate)} أعلى من ${th.bad}%` });
    if (r.d != null && r.d >= 3) alerts.push({ c: 's-action', i: 'fa-arrow-trend-up', t: `${r.branch}: ارتفعت نسبة المتابعة ${r.d.toFixed(1)} نقطة عن اليوم السابق` });
    if (N(r.high) > 0 && r.cov < +cfg.covMin) alerts.push({ c: 's-violation', i: 'fa-bell', t: `${r.branch}: ${fi(r.high)} شحنة أولوية عالية والتغطية ${fp(r.cov)} فقط` });
  });
  if (T.followup && T.cov < +cfg.covMin) alerts.push({ c: 's-action', i: 'fa-clipboard-question', t: `تغطية التبليغات الإجمالية ${fp(T.cov)} أقل من ${cfg.covMin}% في ${snap}` });
  const recent = dates.slice(Math.max(0, dates.indexOf(snap) - 14), dates.indexOf(snap));
  const missing = [...new Set(rows.filter((r) => recent.includes(r.date)).map((r) => r.branch))].filter((b) => (!sel.length || sel.includes(b)) && !snapRows.some((r) => r.branch === b));
  if (missing.length) alerts.push({ c: 's-action', i: 'fa-eye-slash', t: `فروع ظهرت في الأيام السابقة وغائبة عن ${snap}: ${missing.join('، ')}` });
  const repF = repeated.filter(branchOk);
  const repNot = repF.reduce((s, r) => s + N(r.not_notified), 0);
  if (repNot > 0) alerts.push({ c: 's-violation', i: 'fa-repeat', t: `${fi(repNot)} أوردر متكرر لم يُبلَّغ عنه` });
  const gapDays = [];
  for (let i = 1; i < dates.length; i++) gapDays.push(...missingWorkDays(dates[i - 1], dates[i]));
  if (gapDays.length) alerts.push({ c: 's-progress', i: 'fa-calendar-xmark', t: `أيام عمل بلا تاب أوديت (الجمعة إجازة ولا تُحسب): ${gapDays.join('، ')}` });

  const actions = board.filter((r) => r.lv === 'critical' || r.lv === 'attention').sort((a, b) => b.followup - a.followup).map((r) => {
    const reasons = [`${fi(r.followup)} شحنة للمتابعة (${fp(r.rate)})`, `${fi(r.case_late)} حالة متأخرة`];
    const acts = [r.lv === 'critical' ? 'طلب خطة تصحيح وموعد تقفيل من الفرع' : 'متابعة الشحنات المتأخرة مع الفرع'];
    if (N(r.order_late)) { reasons.push(`${fi(r.order_late)} أوردر متجاوز لحد الشركة`); acts.push('تبليغ الفرع بالأوردرات المتجاوزة لحد الشركة'); }
    if (N(r.cs_late)) { reasons.push(`${fi(r.cs_late)} تبليغ خدمة عملاء`); acts.push('تبليغ خدمة العملاء'); }
    if (N(r.high)) reasons.push(`${fi(r.high)} أولوية عالية`);
    return { ...r, reasons, acts };
  });
  const copyActions = async () => {
    const txt = `ملخص أوديت الأوردرات ${snap}\n` + actions.map((a) => `- ${a.branch}: ${a.reasons.join('، ')} | المقترح: ${a.acts.join('، ')} | المسؤول: [  ] | الموعد: [  ]`).join('\n');
    try { await navigator.clipboard.writeText(txt); setCopied('تم النسخ'); } catch { setCopied('تعذر النسخ'); }
    setTimeout(() => setCopied(''), 2500);
  };

  const big = board.filter((r) => N(r.total) >= 100);
  const worst = big.slice(0, 3), best = [...big].reverse().slice(0, 3);
  const totF = N(T.followup);
  const top3Share = totF ? [...board].sort((a, b) => N(b.followup) - N(a.followup)).slice(0, 3).reduce((s, r) => s + N(r.followup), 0) / totF * 100 : 0;
  const riser = board.filter((r) => r.d != null).sort((a, b) => a.d - b.d)[0];     // أكبر انخفاض في النسبة = أكبر تحسن
  const dropper = board.filter((r) => r.d != null).sort((a, b) => b.d - a.d)[0];   // أكبر ارتفاع = أكبر تراجع
  const regAgg = allRegions.map((g) => { const x = sum(snapRows.filter((r) => r.region === g)); return { region: g, ...x }; }).filter((x) => x.total > 0);
  const snapStatuses = statuses.filter((s) => s.date === snap && branchOk(s));
  const stMap = {}; snapStatuses.forEach((s) => { stMap[s.status] = (stMap[s.status] || 0) + N(s.n); });
  const stTop = Object.entries(stMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const insights = [];
  if (worst[0]) insights.push(`أعلى نسبة متابعة في ${snap}: ${worst[0].branch} (${fp(worst[0].rate)}).`);
  if (totF) insights.push(`أكثر 3 فروع في عدد الشحنات للمتابعة تمثل ${top3Share.toFixed(0)}% من الإجمالي.`);
  if (regAgg.length > 1) { const w = [...regAgg].sort((a, b) => b.rate - a.rate)[0]; insights.push(`أعلى إقليم في نسبة المتابعة: ${w.region} (${fp(w.rate)}).`); }
  if (riser && riser.d < 0) insights.push(`أكبر تحسن: ${riser.branch} (${sgn(riser.d)} نقطة).`);
  if (dropper && dropper.d > 0) insights.push(`أكبر تراجع: ${dropper.branch} (${sgn(dropper.d)} نقطة).`);
  if (stTop[0]) insights.push(`أكثر حالة تأخراً: ${stTop[0][0]} (${fi(stTop[0][1])} شحنة).`);

  /* مخططات */
  const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#0837C9';
  const byF = [...board].sort((a, b) => b.followup - a.followup);
  const overall = rangeDates.map((d) => +sum(inRange.filter((r) => r.date === d)).rate.toFixed(1));
  const covTrend = rangeDates.map((d) => +sum(inRange.filter((r) => r.date === d)).cov.toFixed(1));
  const weak = worst.map((w) => w.branch);
  const lineCols = [cv('--chart-2'), cv('--status-action'), cv('--status-violation')];
  const trendSets = [{ label: 'الإجمالي', data: overall, borderColor: cv('--chart-1'), backgroundColor: cv('--chart-1'), tension: .25, borderWidth: 3, pointRadius: 3 }].concat(
    weak.map((b, i) => ({ label: b, data: rangeDates.map((d) => { const r = inRange.find((x) => x.date === d && x.branch === b); return r ? +r.rate.toFixed(1) : null; }), borderColor: lineCols[i], backgroundColor: lineCols[i], tension: .25, borderWidth: 2, pointRadius: 2, spanGaps: true })));

  /* جدول السجل */
  const histCols = [['date', 'التاريخ'], ['branch', 'الفرع'], ['region', 'الإقليم'], ['total', 'الشحنات'], ['followup', 'للمتابعة'], ['rate', 'نسبة المتابعة'], ['case_late', 'حالة'], ['order_late', 'أوردر'], ['cs_late', 'خدمة عملاء'], ['cov', 'التغطية'], ['high', 'أولوية عالية']];
  const hist = [...inRange].sort((a, b) => { const x = ['branch', 'region', 'date'].includes(sort.k) ? a[sort.k] : N(a[sort.k]); const y = ['branch', 'region', 'date'].includes(sort.k) ? b[sort.k] : N(b[sort.k]); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  const pages = Math.max(1, Math.ceil(hist.length / PAGE));
  const pg = Math.min(page, pages - 1);

  /* المقارنة */
  const cmpSum = (d) => sum(rows.filter((r) => r.date === d && branchOk(r)));
  const A = cmp.on ? cmpSum(cmp.a) : null, B = cmp.on ? cmpSum(cmp.b) : null;

  const connLabel = status === 'error' ? 'خطأ في الاتصال' : demoOn ? 'تجريبي' : status === 'refreshing' ? 'جارٍ التحديث' : 'متصل';
  const connCls = status === 'error' ? 's-violation' : demoOn ? 's-action' : 's-success';
  const typeTot = [T.case_late, T.order_late, T.cs_late];

  return (
    <>
      {header}{modal}
      <div className="page">
        <div className="meta">
          <span className={'chip ' + connCls}><span className="dot" />{connLabel}</span>
          <span>آخر تحديث للبيانات: <b className="fi">{generated && generated !== 'demo' ? generated.slice(0, 16).replace('T', ' ') + ' UTC' : at ? at.toLocaleString('en-GB') : '—'}</b></span>
          <span>يوم الأوديت المعروض: <b className="fi">{snap}</b></span>
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

        {!snapRows.length ? <div className="panel"><p>لا توجد بيانات تطابق الفلاتر الحالية.</p></div> : (<>
        <Heading tag="اليوم" title={`المؤشرات الرئيسية — ‎${snap}‎`} sub="الشحنة الواحدة قد تظهر في أكثر من نوع تأخر (حالة، أوردر، خدمة عملاء)، لذلك مجموع الأنواع أكبر من «للمتابعة»." />
        <div className="kpi-row">
          <div className="kpi"><span className="l">شحنات التقرير</span><span className="v">{fi(T.total)}</span><Delta cur={T.total} prev={P && P.total} lowerBetter={false} /></div>
          <div className={'kpi ' + (T.rate <= th.good ? 'accent-ok' : T.rate <= th.bad ? 'accent-warn' : 'accent-bad')}><span className="l">للمتابعة (فريد)</span><span className="v">{fi(T.followup)}</span>
            <span className="d muted">{fp(T.rate)} من الشحنات</span><br /><Delta cur={T.rate} prev={P && P.rate} lowerBetter pp /></div>
          <div className="kpi accent-warn"><span className="l">حالة متأخرة</span><span className="v">{fi(T.case_late)}</span><Delta cur={T.case_late} prev={P && P.case_late} lowerBetter /></div>
          <div className="kpi accent-bad"><span className="l">أوردر متأخر (الشركة)</span><span className="v">{fi(T.order_late)}</span><Delta cur={T.order_late} prev={P && P.order_late} lowerBetter /></div>
          <div className="kpi accent-teal"><span className="l">تبليغ خدمة عملاء</span><span className="v">{fi(T.cs_late)}</span><Delta cur={T.cs_late} prev={P && P.cs_late} lowerBetter /></div>
          <div className={'kpi ' + (T.cov >= +cfg.covMin ? 'accent-ok' : 'accent-bad')}><span className="l">نسبة التغطية</span><span className="v">{fp(T.cov)}</span>
            <span className="d muted">{fi(T.handled)} من {fi(T.followup)} سُجل لها إجراء</span><br /><Delta cur={T.cov} prev={P && P.cov} lowerBetter={false} pp /></div>
          <div className="kpi accent-bad"><span className="l">أولوية عالية</span><span className="v">{fi(T.high)}</span><Delta cur={T.high} prev={P && P.high} lowerBetter /></div>
          <div className="kpi"><span className="l">متأخرة بأيام متتالية</span><span className="v">{fi(T.repeated)}</span><span className="d muted">ظهرت متأخرة في يومين أو أكثر</span></div>
        </div>

        <Heading tag="أداء" title="صحة الفروع" sub={`حسب نسبة المتابعة (الأقل أفضل): ممتاز ≤ ${th.excellent}% — جيد ≤ ${th.good}% — يحتاج انتباه ≤ ${th.bad}% — حرج أعلى من ذلك (حدود للعرض وليست سياسة معتمدة)`} />
        <div className="panel tscroll"><table>
          <thead><tr><th>الفرع</th><th>الإقليم</th><th>الشحنات</th><th>للمتابعة</th><th>نسبة المتابعة</th><th>التغيير (نقطة)</th><th>حالة</th><th>أوردر</th><th>خدمة عملاء</th><th>التغطية</th><th>أولوية عالية</th><th>المستوى</th></tr></thead>
          <tbody>{board.map((r) => (
            <tr key={r.branch}><td>{r.branch}</td><td className="muted">{r.region}</td><td className="n">{fi(r.total)}</td><td className="n">{fi(r.followup)}</td><td className="n"><b>{fp(r.rate)}</b></td>
              <td className={'n ' + (r.d == null ? 'muted' : r.d < 0 ? 'ok' : r.d > 0 ? 'bad' : 'muted')} dir="ltr" style={{ textAlign: 'right' }}>{r.d == null ? '—' : sgn(r.d)}</td>
              <td className="n">{fi(r.case_late)}</td><td className="n">{fi(r.order_late)}</td><td className="n">{fi(r.cs_late)}</td><td className="n">{fp(r.cov)}</td><td className="n">{fi(r.high)}</td><td><Badge lv={r.lv} /></td></tr>))}</tbody>
        </table></div>

        <Heading tag="اتجاهات" title="الاتجاهات والتوزيعات" />
        <div className="panel-grid">
          <div className="panel"><h3>اتجاه نسبة المتابعة</h3><p className="panel-sub">الإجمالي وأعلى 3 فروع في {snap}</p>
            <div className="chart-wrap tall"><ChartBox type="line" theme={theme} labels={rangeDates} datasets={trendSets} pct /></div></div>
          <div className="panel"><h3>اتجاه نسبة التغطية</h3><p className="panel-sub">الشحنات التي سُجل لها إجراء ÷ للمتابعة</p>
            <div className="chart-wrap tall"><ChartBox type="line" theme={theme} legend={false} labels={rangeDates} datasets={[{ label: 'التغطية', data: covTrend, borderColor: cv('--status-success'), backgroundColor: cv('--status-success'), tension: .25, borderWidth: 3, pointRadius: 3 }]} pct /></div></div>
          <div className="panel"><h3>أنواع التأخر حسب الفرع</h3><p className="panel-sub">حالة / أوردر الشركة / خدمة عملاء</p>
            <div className="chart-wrap tall"><ChartBox type="bar" theme={theme} horizontal labels={byF.map((r) => r.branch)} datasets={[
              { label: 'حالة', data: byF.map((r) => N(r.case_late)), backgroundColor: cv('--status-action') },
              { label: 'أوردر (الشركة)', data: byF.map((r) => N(r.order_late)), backgroundColor: cv('--status-violation') },
              { label: 'خدمة عملاء', data: byF.map((r) => N(r.cs_late)), backgroundColor: cv('--chart-2') }]} /></div></div>
          <div className="panel"><h3>توزيع أنواع التأخر</h3><p className="panel-sub">إجمالي {snap} (قد تتداخل الأنواع)</p>
            <div className="chart-wrap"><ChartBox type="doughnut" theme={theme} labels={['حالة', 'أوردر (الشركة)', 'خدمة عملاء']} datasets={[{ data: typeTot, backgroundColor: [cv('--status-action'), cv('--status-violation'), cv('--chart-2')], borderWidth: 0 }]} /></div></div>
          <div className="panel"><h3>نسبة المتابعة حسب الإقليم</h3><p className="panel-sub">{snap}</p>
            <div className="chart-wrap"><ChartBox type="bar" theme={theme} legend={false} pct labels={regAgg.map((x) => x.region)} datasets={[{ label: 'نسبة المتابعة', data: regAgg.map((x) => +x.rate.toFixed(1)), backgroundColor: cv('--chart-1') }]} /></div></div>
          <div className="panel"><h3>أكثر الحالات تأخراً</h3><p className="panel-sub">{stTop.length ? `عدد الشحنات المتأخرة في الحالة — ${snap}` : 'بيانات الحالات متاحة لآخر 14 يوم فقط'}</p>
            <div className="chart-wrap">{stTop.length ? <ChartBox type="bar" theme={theme} horizontal legend={false} labels={stTop.map((x) => x[0])} datasets={[{ label: 'شحنات', data: stTop.map((x) => x[1]), backgroundColor: cv('--chart-3') }]} /> : <p className="muted">لا توجد حالات متأخرة لهذا اليوم/الفلاتر.</p>}</div></div>
        </div>

        <Heading tag="تبليغ" title="التبليغات والأوردرات المتكررة" sub="التبليغات المسجلة في تاب اليوم، وآخر قائمة للأوردرات المتكررة (من آخر تحديث)." />
        <div className="panel-grid">
          <div className="panel"><h3>التبليغات المسجلة — {snap}</h3>
            <div className="chart-wrap"><ChartBox type="doughnut" theme={theme} labels={['خدمة عملاء', 'فروع داخلية', 'فروع خارجية']} datasets={[{ data: [T.n_cs, T.n_int, T.n_ext], backgroundColor: [cv('--chart-2'), cv('--chart-1'), cv('--chart-4')], borderWidth: 0 }]} /></div></div>
          <div className="panel tscroll"><h3>الأوردرات المتكررة حسب الفرع</h3>
            {repF.length ? <table>
              <thead><tr><th>الفرع</th><th>متكرر</th><th>اتبلّغ</th><th>لم يُبلَّغ</th><th>أقصى تتابع</th></tr></thead>
              <tbody>{[...repF].sort((a, b) => N(b.count) - N(a.count)).map((r) => (
                <tr key={r.branch}><td>{r.branch}</td><td className="n">{fi(r.count)}</td><td className="n">{fi(r.notified)}</td><td className={'n ' + (N(r.not_notified) ? 'bad' : '')}>{fi(r.not_notified)}</td><td className="n">{fi(r.max_streak)} يوم</td></tr>))}</tbody>
            </table> : <p className="muted">لا توجد أوردرات متكررة حالياً (تحتاج يومين متتاليين على الأقل).</p>}</div>
        </div>

        <Heading tag="استثناءات" title="مركز التنبيهات" sub="محسوبة آليًا من البيانات" />
        <div className="panel">{alerts.length === 0 ? <p className="ok"><i className="fa-solid fa-circle-check" /> لا توجد تنبيهات في هذه الفترة</p> :
          alerts.map((a, i) => <div className={'alert ' + a.c} key={i}><i className={'fa-solid ' + a.i} /><span>{a.t}</span></div>)}</div>

        <Heading tag="إجراءات" title="مركز الإجراءات" sub="إجراءات مقترحة من قواعد عامة وليست قرارات معتمدة. المسؤول والموعد تحددهما الإدارة." />
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="qa-btn" onClick={copyActions}><i className="fa-solid fa-copy" />{copied || 'نسخ ملخص الإجراءات'}</button></div>
          {actions.length === 0 && <p className="ok">لا توجد فروع فوق الحدود في {snap}.</p>}
          {actions.map((a, i) => (
            <div className={'act ' + a.lv} key={a.branch}>
              <div className="h"><b>{i + 1}. {a.branch}</b><Badge lv={a.lv} /></div>
              <div className="reasons">{a.reasons.map((x) => <span key={x}>{x}</span>)}</div>
              <div className="muted">المقترح: {a.acts.join('، ')}</div>
            </div>))}
        </div>

        <Heading tag="رؤى" title="رؤى للإدارة" sub="مبنية على قواعد آلية وليست ذكاءً اصطناعيًا" />
        <div className="panel-grid">
          <div className="panel"><h3>أبرز الملاحظات</h3>{insights.map((t) => <div className="insight" key={t}><i className="fa-solid fa-lightbulb" /><span>{t}</span></div>)}</div>
          <div className="panel"><h3>أعلى وأقل نسبة متابعة</h3><p className="panel-sub">فروع 100 شحنة فأكثر</p>
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
              {[['إجمالي الشحنات', 'total', false, false], ['للمتابعة', 'followup', true, false], ['نسبة المتابعة', 'rate', true, true], ['حالة متأخرة', 'case_late', true, false], ['أوردر متأخر', 'order_late', true, false], ['تبليغ خدمة عملاء', 'cs_late', true, false], ['نسبة التغطية', 'cov', false, true], ['أولوية عالية', 'high', true, false]].map(([l, k, lb, isPct]) => {
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
            <tbody>{hist.slice(pg * PAGE, pg * PAGE + PAGE).map((r) => (
              <tr key={r.date + r.branch}><td className="n">{r.date}</td><td>{r.branch}</td><td className="muted">{r.region}</td><td className="n">{fi(r.total)}</td><td className="n">{fi(r.followup)}</td><td className="n">{fp(r.rate)}</td><td className="n">{fi(r.case_late)}</td><td className="n">{fi(r.order_late)}</td><td className="n">{fi(r.cs_late)}</td><td className="n">{fp(r.cov)}</td><td className="n">{fi(r.high)}</td></tr>))}</tbody>
          </table></div>
          <div className="pager"><span>صفحة {pg + 1} من {pages} — {fi(hist.length)} صف</span>
            <span><button className="qa-btn" disabled={pg === 0} onClick={() => setPage(pg - 1)}>السابق</button> <button className="qa-btn" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>التالي</button></span></div>
        </div>
        </>)}

        <div className="foot">
          <b>التعريفات:</b> عمر الحالة = تاريخ التقرير − تاريخ آخر حالة، مقارنًا بحد كل حالة شحنة. عمر الأوردر = تاريخ التقرير − تاريخ البيك أب، مقارنًا بحد الشركة وحد خدمة العملاء لفرع العضو. «للمتابعة» = شحنة متأخرة بأي نوع (مرة واحدة). نسبة المتابعة = للمتابعة ÷ شحنات الفرع (الأقل أفضل). نسبة التغطية = الشحنات التي سُجل لها إجراء ÷ للمتابعة. الحدود في ورقة Rules بالشيت. مستويات الصحة ومقترحات الإجراءات للعرض وتحتاج اعتماد الإدارة.
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
        <div className="fgroup"><label htmlFor="s-e">ممتاز حتى %</label><input id="s-e" type="number" min="0" max="100" value={c.excellent} onChange={(e) => set('excellent', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-g">جيد حتى %</label><input id="s-g" type="number" min="0" max="100" value={c.good} onChange={(e) => set('good', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-b">يحتاج انتباه حتى %</label><input id="s-b" type="number" min="0" max="100" value={c.bad} onChange={(e) => set('bad', +e.target.value)} /></div>
        <div className="fgroup"><label htmlFor="s-c">حد التغطية الأدنى %</label><input id="s-c" type="number" min="0" max="100" value={c.covMin} onChange={(e) => set('covMin', +e.target.value)} /></div>
      </div>
      <p className="muted" style={{ fontSize: '.8rem' }}>الإعدادات تُحفظ في هذا المتصفح فقط. حدود المستويات للعرض وليست سياسة معتمدة.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn sec" onClick={onClose}>إلغاء</button><button className="btn" onClick={() => onSave(c)}>حفظ والاتصال</button></div>
    </div></div>
  );
}
