/** تصيير كتل التقرير إلى Word (نفس تصميم تقارير المطابقة). يُستدعى بـ import('docx') عند الطلب. */
import { isNum } from './render.js';

const LRM = '‎';
export function toDocx(doc, D, logoB64) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, ImageRun, Footer, PageNumber, VerticalAlign, TableLayoutType } = D;
  const NAVY = '17365D', INK = '1B2A3A', RED = 'B4442A', TEAL = '0F766E', GRAY = '5B6B7B', LINE = 'C9D6E2';
  const W = 10466;
  const bin = Uint8Array.from(atob(logoB64), (c) => c.charCodeAt(0));
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Arial', size: o.sz || 18, bold: !!o.b, color: o.color || INK, rightToLeft: true });
  const fix = (s) => { s = String(s ?? ''); return isNum(s) && s.trim() !== '' ? LRM + s : s; };
  const para = (t, o = {}) => new Paragraph({ bidirectional: true, alignment: o.al || AlignmentType.START, spacing: { before: o.before || 0, after: o.after ?? 0, line: o.line }, border: o.border, keepNext: o.keepNext, children: Array.isArray(t) ? t : [run(t, o)] });
  const bd1 = (c) => ({ style: BorderStyle.SINGLE, size: 4, space: 0, color: c });
  const bAll = (c) => ({ top: bd1(c), bottom: bd1(c), left: bd1(c), right: bd1(c) });
  const none = { style: BorderStyle.NONE, size: 0, space: 0, color: 'FFFFFF' };
  const noB = { top: none, bottom: none, left: none, right: none };
  const out = [];

  doc.blocks.forEach((b) => {
    if (b.t === 'head') {
      const head = new Table({
        visuallyRightToLeft: true, width: { size: W, type: WidthType.DXA }, columnWidths: [W - 1500, 1500], layout: TableLayoutType.FIXED,
        borders: { ...noB, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ children: [
          new TableCell({ width: { size: W - 1500, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' }, verticalAlign: VerticalAlign.CENTER, margins: { top: 120, bottom: 120, left: 160, right: 160 }, borders: noB,
            children: [para(b.title, { sz: 36, b: 1, color: 'FFFFFF', al: AlignmentType.CENTER, after: 40 }), para(b.l1, { sz: 22, color: 'FFFFFF', al: AlignmentType.CENTER, after: 20 }), para(b.l2, { sz: 20, color: 'DCE6F0', al: AlignmentType.CENTER })] }),
          new TableCell({ width: { size: 1500, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' }, verticalAlign: VerticalAlign.CENTER, borders: noB,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: bin, transformation: { width: 84, height: 24 } })] })] })] })]
      });
      out.push(head, new Paragraph({ spacing: { before: 0, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, space: 1, color: TEAL } }, children: [] }));
    } else if (b.t === 'src') out.push(para(b.text, { sz: 16, color: GRAY, al: AlignmentType.CENTER, after: 60 }));
    else if (b.t === 'h') out.push(para(b.text, { sz: 26, b: 1, color: NAVY, before: 240, after: 100, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 12, space: 3, color: TEAL } } }));
    else if (b.t === 'p') out.push(para(b.text, { sz: 21, after: 80, line: 300, al: AlignmentType.BOTH }));
    else if (b.t === 'note') out.push(para(b.text, { sz: 16, color: GRAY, before: 60, after: 60 }));
    else if (b.t === 'kpis') {
      const cw = Math.floor((W - 3 * 120) / 4), cells = [], tone = { navy: [NAVY, 'EAF0F6'], red: [RED, 'FBE9E3'], teal: [TEAL, 'EAF0F6'] };
      b.cards.forEach((c, i) => {
        const [col, fill] = tone[c.tone] || tone.navy;
        const kids = [para(c.label, { sz: 17, b: 1, color: NAVY, al: AlignmentType.CENTER, after: 60, line: 240 }), para(fix(c.value), { sz: 40, b: 1, color: col, al: AlignmentType.CENTER, after: 20 })];
        if (c.pct) kids.push(para(fix(c.pct), { sz: 26, b: 1, color: col, al: AlignmentType.CENTER, after: 20 }));
        kids.push(para(c.sub, { sz: 15, color: GRAY, al: AlignmentType.CENTER, line: 220 }));
        cells.push(new TableCell({ width: { size: cw, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill, color: 'auto' }, margins: { top: 100, bottom: 100, left: 80, right: 80 }, borders: { top: { style: BorderStyle.SINGLE, size: 24, space: 0, color: col }, bottom: none, left: none, right: none }, children: kids }));
        if (i < b.cards.length - 1) cells.push(new TableCell({ width: { size: 120, type: WidthType.DXA }, borders: noB, children: [new Paragraph({ children: [] })] }));
      });
      out.push(new Table({ visuallyRightToLeft: true, width: { size: W, type: WidthType.DXA }, columnWidths: [cw, 120, cw, 120, cw, 120, cw], layout: TableLayoutType.FIXED, borders: { ...noB, insideHorizontal: none, insideVertical: none }, rows: [new TableRow({ cantSplit: true, children: cells })] }),
        new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else if (b.t === 'table') {
      const tw = b.w.reduce((a, x) => a + x, 0); const cw = b.w.map((x) => Math.round((x / tw) * W)); cw[cw.length - 1] += W - cw.reduce((a, x) => a + x, 0);
      const cell = (txt, i, o) => new TableCell({ width: { size: cw[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined, margins: { top: 50, bottom: 50, left: 70, right: 70 }, borders: bAll(o.bc || LINE),
        children: [para(fix(txt), { sz: o.sz || 18, b: o.b, color: o.color, al: isNum(String(txt)) || o.center ? AlignmentType.CENTER : AlignmentType.START })] });
      const head = new TableRow({ tableHeader: true, cantSplit: true, children: b.cols.map((c, i) => cell(c, i, { fill: NAVY, color: 'FFFFFF', b: 1, sz: 17, center: 1, bc: NAVY })) });
      const body = b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.c.map((x, i) => cell(x, i, r.total ? { fill: 'D6E4F0', b: 1, color: NAVY } : r.hl ? { fill: 'FBE9E3', color: RED, b: i < 2 } : { fill: ri % 2 ? 'F5F8FB' : 'FFFFFF' })) }));
      out.push(new Table({ visuallyRightToLeft: true, width: { size: W, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED, rows: [head, ...body] }));
    }
  });

  return new Document({
    creator: 'إدارة المراجعة – ARRIVE', title: doc.title, styles: { default: { document: { run: { font: 'Arial', size: 18 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 900, left: 720, header: 708, footer: 400 } }, bidi: true },
      footers: { default: new Footer({ children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 4, space: 4, color: LINE } },
        children: [run(doc.footer + '  |  صفحة ', { sz: 16, color: GRAY }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: GRAY, rightToLeft: true }), run(' من ', { sz: 16, color: GRAY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 16, color: GRAY, rightToLeft: true })] })] }) },
      children: out
    }]
  });
}
