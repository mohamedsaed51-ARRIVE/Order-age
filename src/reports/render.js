/** تصيير كتل التقرير إلى HTML بصفحة A4 (نفس تصميم تقارير المطابقة). */
export const isNum = (s) => /^[\d.,%+\-\s()—/]+$/.test(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toHTML(doc, logo) {
  const toneC = { navy: '#17365D', red: '#B4442A', teal: '#0F766E' };
  return doc.blocks.map((b) => {
    if (b.t === 'head') return `<div class="r1-head"><div class="r1-ht"><h1>${esc(b.title)}</h1><div>${esc(b.l1)}</div><div>${esc(b.l2)}</div></div><div class="r1-lg"><img src="${logo}" alt="ARRIVE"></div></div><div class="r1-line"></div>`;
    if (b.t === 'src') return `<div class="r1-src">${esc(b.text)}</div>`;
    if (b.t === 'h') return `<h2 class="r1-h">${esc(b.text)}</h2>`;
    if (b.t === 'p') return `<p class="r1-p">${esc(b.text)}</p>`;
    if (b.t === 'note') return `<div class="r1-note">${esc(b.text)}</div>`;
    if (b.t === 'kpis') return `<div class="r1-kpis">${b.cards.map((c) => `<div class="r1-k ${c.tone}" style="--kc:${toneC[c.tone]}"><div class="r1-kl">${esc(c.label)}</div><div class="r1-kv num">${esc(c.value)}</div>${c.pct ? `<div class="r1-kp num">${esc(c.pct)}</div>` : ''}<div class="r1-ks">${esc(c.sub)}</div></div>`).join('')}</div>`;
    if (b.t === 'table') {
      const tw = b.w.reduce((a, x) => a + x, 0);
      return `<table class="r1-t"><colgroup>${b.w.map((x) => `<col style="width:${(x / tw) * 100}%">`).join('')}</colgroup><thead><tr>${b.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr class="${r.total ? 'tot' : ''}${r.hl ? ' hl' : ''}">${r.c.map((x) => `<td class="${isNum(String(x)) ? 'num c' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    return '';
  }).join('') + `<div class="r1-foot">${esc(doc.footer)}</div>`;
}
