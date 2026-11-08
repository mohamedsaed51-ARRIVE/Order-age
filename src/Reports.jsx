import React, { useMemo, useState } from 'react';
import { REPORTS, buildReport } from './reports/model.js';
import { toHTML } from './reports/render.js';
import { toDocx } from './reports/docx.js';
import { dmy } from './lib.js';
import logoUrl from './assets/logo.js';

function downloadBlob(name, blob) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch { /* ignore */ }
}

/** صفحة التقارير: اختيار التقرير والفترة، معاينة A4، طباعة/PDF، وتحميل Word. */
export default function Reports({ rows, statuses, repeated, th, covMin, dates, demo }) {
  const [id, setId] = useState('exec');
  const [day, setDay] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const def = REPORTS.find((r) => r.id === id);
  const d = day && dates.includes(day) ? day : dates[dates.length - 1] || '';
  const f = from && dates.includes(from) ? from : dates[Math.max(0, dates.length - 14)] || '';
  const t = to && dates.includes(to) ? to : dates[dates.length - 1] || '';

  const doc = useMemo(() => buildReport(id, { rows, statuses, repeated, th, covMin, day: d, from: f, to: t, demo }), [id, rows, statuses, repeated, th, covMin, d, f, t, demo]);
  const html = useMemo(() => toHTML(doc, logoUrl), [doc]);

  const word = async () => {
    setBusy('جارٍ تجهيز ملف Word…');
    try {
      const D = await import('docx');
      const blob = await D.Packer.toBlob(toDocx(doc, D, logoUrl.split(',')[1]));
      downloadBlob(`Order-Age_${id}_${(doc.per || '').replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '')}.docx`, blob);
      setBusy('');
    } catch (e) { setBusy('تعذر تجهيز ملف Word: ' + (e.message || e)); }
  };

  return (
    <div className="page">
      <div className="rp-controls">
        <div className="rp-types">
          {REPORTS.map((r) => (
            <button key={r.id} className={'rp-type' + (r.id === id ? ' on' : '')} onClick={() => setId(r.id)}>
              <b>{r.title}</b><span>{r.desc}</span>
            </button>))}
        </div>
        <div className="fgrid" style={{ marginTop: 12 }}>
          {def.mode === 'day' ? (
            <div className="fgroup"><label htmlFor="rp-day">يوم الأوديت</label>
              <select id="rp-day" value={d} onChange={(e) => setDay(e.target.value)}>{[...dates].reverse().map((x) => <option key={x}>{x}</option>)}</select></div>
          ) : (<>
            <div className="fgroup"><label htmlFor="rp-from">من تاريخ</label>
              <select id="rp-from" value={f} onChange={(e) => setFrom(e.target.value)}>{dates.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="fgroup"><label htmlFor="rp-to">إلى تاريخ</label>
              <select id="rp-to" value={t} onChange={(e) => setTo(e.target.value)}>{[...dates].reverse().map((x) => <option key={x}>{x}</option>)}</select></div>
          </>)}
          <div className="rp-actions">
            <button className="btn" onClick={() => window.print()} disabled={!dates.length}><i className="fa-solid fa-print" /> طباعة / PDF</button>
            <button className="btn sec" onClick={word} disabled={!dates.length || !!busy}><i className="fa-solid fa-file-word" /> تحميل Word</button>
          </div>
        </div>
        <p className="section-sub" style={{ marginTop: 8 }}>
          {demo ? 'بيانات تجريبية غير حقيقية. ' : ''}الفترة المعروضة: {def.mode === 'day' ? dmy(d) : `${dmy(f)} إلى ${dmy(t)}`}.
          الأعداد مجمّعة (يوم × فرع) بدون أرقام بوالص أو عملاء. التوصيات مقترحة وليست قرارات معتمدة. {busy && <b>{busy}</b>}
        </p>
      </div>
      <div className="rp-stage"><section className="rp-page r1" dangerouslySetInnerHTML={{ __html: html }} /></div>
    </div>
  );
}
