/**
 * نماذج التقارير (بنفس بنية وتصميم تقارير المطابقة): كل تقرير = مستند من «كتل» (blocks):
 *   head · src · h · p · note · kpis · table
 * تُصيَّر الكتل إلى HTML (A4) أو Word عبر render.js و docx.js.
 * كل الأعداد مجمّعة (يوم × فرع)؛ لا توجد أرقام بوالص أو عملاء أو مناديب.
 */
import { fi as N, sum, weekStart, dmy, missingWorkDays } from './../lib.js';

const P = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const D1 = (v) => Number(v).toFixed(1);
const ORD = ['أولًا', 'ثانيًا', 'ثالثًا', 'رابعًا', 'خامسًا', 'سادسًا', 'سابعًا', 'ثامنًا', 'تاسعًا', 'عاشرًا'];
const AUTHOR = 'إعداد: إدارة المراجعة – ARRIVE';
const NO_DEC = 'التوصيات مقترحة من التحليل وليست قرارات معتمدة، والمسؤول والموعد غير محددين في المصدر.';

export const REPORTS = [
  { id: 'exec', title: 'التقرير التنفيذي اليومي', mode: 'day', desc: 'ملخص للإدارة عن يوم أوديت واحد: المؤشرات، الأقاليم، أعلى الفروع، التبليغات، المتكرر، الحالات، المقارنة باليوم السابق، والتوصيات' },
  { id: 'branches', title: 'تقرير أداء الفروع', mode: 'period', desc: 'ترتيب الفروع خلال فترة (متوسطات يومية) ومقارنتها بالفترة السابقة، والتوزيع الأسبوعي، وأسوأ أيام الفروع' },
  { id: 'notify', title: 'تقرير التبليغات والتصعيد', mode: 'period', desc: 'التبليغات المسجلة حسب النوع والفرع والأسبوع، ونسبة تبليغ الأوردر وخدمة العملاء، والمتكرر، والفروع الأقل تبليغًا' }
];

function mk(title, line1, per, srcText, goal) {
  const B = [];
  let i = 0;
  B.push({ t: 'head', title, l1: line1, l2: AUTHOR });
  B.push({ t: 'src', text: srcText });
  B.push({ t: 'h', text: 'الهدف من التقرير' });
  B.push({ t: 'p', text: goal });
  return {
    B, per,
    h: (text) => B.push({ t: 'h', text: `${ORD[i++]}: ${text}` }),
    done: () => ({ title, blocks: B, footer: `إدارة المراجعة – ARRIVE  |  ${title} – ${per}`, per })
  };
}
function tableQ(D, Q) {
  D.h('ملاحظات جودة البيانات');
  D.B.push({ t: 'table', w: [5, 19, 46, 30], cols: ['م', 'البند', 'التفصيل', 'المعالجة في التقرير'], rows: Q.map((x, k) => ({ c: [N(k + 1), ...x] })) });
}
function tableRec(D, R) {
  D.h('التوصيات المقترحة');
  if (!R.length) R.push(['لا توجد ملاحظات تستدعي إجراءً من الأرقام الحالية', 'الاستمرار في المتابعة اليومية', 'منخفضة']);
  D.B.push({ t: 'table', w: [5, 30, 30, 13, 10, 12], cols: ['م', 'الملاحظة', 'الإجراء المقترح', 'الجهة المسؤولة', 'الأولوية (مقترحة)', 'الموعد'], rows: R.map((x, k) => ({ c: [N(k + 1), x[0], x[1], 'يُحدد من الإدارة', x[2], 'يُحدد من الإدارة'] })) });
  D.B.push({ t: 'note', text: NO_DEC });
}
const groupBy = (rows, f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return [...m]; };
const emptyDoc = (title, why) => ({ title, footer: `إدارة المراجعة – ARRIVE  |  ${title}`, per: '', blocks: [{ t: 'head', title, l1: '—', l2: AUTHOR }, { t: 'h', text: 'لا توجد بيانات' }, { t: 'p', text: why }] });
const defsNote = 'الأنواع الثلاثة (أوردر الشركة / خدمة العملاء / حالة فقط) لا تتداخل: الشحنة التي تجمع أوردرًا وحالة تُحسب أوردرًا. «خدمة العملاء» نافذة بين حد خدمة العملاء وحد الشركة وتختفي بعد تجاوز حد الشركة. «لم يُبلَّغ بعد» = أوردر أو خدمة عملاء بلا نوع تبليغ مسجل. نسبة الأوردرات المتأخرة = (أوردر + خدمة عملاء) ÷ شحنات التصدير.';

/* ======================= 1) التقرير التنفيذي اليومي ======================= */
export function execReport(ctx) {
  const { rows, statuses, repeated, th, covMin } = ctx;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const day = dates.includes(ctx.day) ? ctx.day : dates[dates.length - 1];
  if (!day) return emptyDoc('التقرير التنفيذي اليومي', 'لا توجد أيام أوديت في البيانات المحمّلة.');
  const prevD = dates.filter((d) => d < day).pop();
  const today = rows.filter((r) => r.date === day), prevRows = prevD ? rows.filter((r) => r.date === prevD) : null;
  const T = sum(today), Pv = prevRows ? sum(prevRows) : null;
  const rep = repeated.reduce((a, r) => ({ count: a.count + (+r.count || 0), notified: a.notified + (+r.notified || 0), not_notified: a.not_notified + (+r.not_notified || 0) }), { count: 0, notified: 0, not_notified: 0 });
  const per = dmy(day);
  const D = mk('التقرير التنفيذي لأوديت الأوردرات المتأخرة', `تاريخ الأوديت: ${per}`, per,
    `المصدر: تابات الأوديت اليومية في الشيت — ${N(today.length)} فرعًا، ${N(T.total)} شحنة في تصدير ${per}`,
    `إطلاع الإدارة على الشحنات المتأخرة في عمر الأوردر (الشركة وخدمة العملاء) وعمر الحالة بتاريخ ${per}، وبيان ما تم تبليغه منها وما لم يُبلَّغ بعد، وتحديد الفروع والأقاليم الأعلى تأخرًا، والأوردرات المتكررة، والتحصيل المعرّض، لمساعدة الإدارة على التصعيد واتخاذ القرار.`);
  const B = D.B;

  D.h('المؤشرات الرئيسية');
  B.push({ t: 'kpis', cards: [
    { label: 'شحنات للمتابعة (فريد)', value: N(T.followup), pct: P(T.followup, T.total), sub: `من ${N(T.total)} شحنة في التصدير`, tone: 'navy' },
    { label: 'أوردر متأخر (الشركة)', value: N(T.order_late), pct: P(T.order_late, T.total), sub: `متوسط العمر ${D1(T.avg_oage)} يوم | أقدم ${N(T.max_oage)} يوم`, tone: 'red' },
    { label: 'خدمة عملاء (قبل حد الشركة)', value: N(T.cs_late), pct: P(T.cs_late, T.total), sub: 'بين حد خدمة العملاء وحد الشركة', tone: 'teal' },
    { label: 'حالة فقط', value: N(T.case_only), pct: P(T.case_only, T.total), sub: `منها ${N(T.case_first)} عند الحد نفسه (أول يوم)`, tone: 'navy' }] });
  B.push({ t: 'kpis', cards: [
    { label: 'أوردر/خدمة لم يُبلَّغ بعد', value: N(T.unnotified), pct: P(T.unnotified, T.oc), sub: `من ${N(T.oc)} مطلوب تبليغها`, tone: 'red' },
    { label: 'أوردر/خدمة اتبلّغ', value: N(T.notified_oc), pct: P(T.notified_oc, T.oc), sub: 'نسبة التبليغ', tone: 'teal' },
    { label: 'أوردرات متكررة (آخر تحديث)', value: N(rep.count), sub: `${N(rep.notified)} اتبلّغ | ${N(rep.not_notified)} لم يُبلَّغ`, tone: 'navy' },
    { label: 'التحصيل المعرّض (ج.م)', value: N(T.cod_oc), sub: `لأوردرات الشركة وخدمة العملاء | تحصيل كل المتابعة ${N(T.cod)}`, tone: 'red' }] });
  B.push({ t: 'note', text: defsNote });

  D.h('التوزيع حسب الإقليم');
  const regs = groupBy(today, (r) => r.region || 'غير محدد').map(([k, v]) => [k, sum(v)]).sort((a, b) => b[1].rate - a[1].rate);
  B.push({ t: 'table', w: [24, 11, 11, 12, 11, 12, 15], cols: ['الإقليم', 'الشحنات', 'أوردر الشركة', 'خدمة عملاء', 'حالة فقط', 'للمتابعة', 'نسبة الأوردرات المتأخرة'],
    rows: [...regs.map(([k, s]) => ({ c: [k, N(s.total), N(s.order_late), N(s.cs_late), N(s.case_only), N(s.followup), P(s.oc, s.total)], hl: s.rate > th.bad ? 'red' : null })),
      { c: ['الإجمالي', N(T.total), N(T.order_late), N(T.cs_late), N(T.case_only), N(T.followup), P(T.oc, T.total)], total: 1 }] });
  B.push({ t: 'note', text: `المظلل: إقليم نسبة الأوردرات المتأخرة فيه أعلى من ${th.bad}% (حد للعرض وليس سياسة معتمدة).` });

  D.h('الفروع الأعلى في الأوردرات المتأخرة');
  const brs = today.filter((r) => r.oc > 0).sort((a, b) => b.oc - a.oc || b.rate - a.rate).slice(0, 10);
  B.push({ t: 'table', w: [15, 17, 9, 9, 10, 10, 10, 11, 12], cols: ['الفرع', 'الإقليم', 'الشحنات', 'أوردر الشركة', 'خدمة عملاء', 'لم يُبلَّغ', 'نسبة التبليغ', 'نسبة الأوردرات المتأخرة', 'التحصيل المعرّض'],
    rows: brs.length ? [...brs.map((r) => ({ c: [r.branch, r.region || '—', N(r.total), N(r.order_late), N(r.cs_late), N(r.unnotified), P(r.notified_oc, r.oc), P(r.oc, r.total), N(r.cod_oc)], hl: r.rate > th.bad ? 'red' : null })),
      { c: ['الإجمالي', '', N(T.total), N(T.order_late), N(T.cs_late), N(T.unnotified), P(T.notified_oc, T.oc), P(T.oc, T.total), N(T.cod_oc)], total: 1 }] : [{ c: ['لا توجد أوردرات أو خدمة عملاء متأخرة', '', '', '', '', '', '', '', ''] }] });
  B.push({ t: 'note', text: `أعلى 10 فروع حسب (أوردر + خدمة عملاء). المظلل: نسبة الأوردرات المتأخرة أعلى من ${th.bad}%.` });

  D.h('التبليغات المسجلة');
  const tn = T.n_cs + T.n_int + T.n_ext;
  B.push({ t: 'table', w: [50, 25, 25], cols: ['نوع التبليغ', 'عدد التبليغات المسجلة', 'النسبة'], rows: [
    { c: ['تبليغ خدمة عملاء', N(T.n_cs), P(T.n_cs, tn)] }, { c: ['تبليغ فروع داخلية', N(T.n_int), P(T.n_int, tn)] }, { c: ['تبليغ فروع خارجية', N(T.n_ext), P(T.n_ext, tn)] },
    { c: ['الإجمالي', N(tn), tn ? '100.0%' : '—'], total: 1 }] });
  B.push({ t: 'note', text: `التبليغات حسب عمود «نوع التبليغ» في تاب اليوم لكل الشحنات (وليس الأوردر وخدمة العملاء فقط). منها ${N(T.notified_oc)} على أوردر/خدمة عملاء من أصل ${N(T.oc)} مطلوب تبليغها.` });

  D.h('الأوردرات المتكررة');
  const repF = [...repeated].sort((a, b) => (+b.count || 0) - (+a.count || 0)).slice(0, 10);
  B.push({ t: 'table', w: [28, 18, 18, 18, 18], cols: ['الفرع', 'متكرر', 'اتبلّغ', 'لم يُبلَّغ', 'أقصى تتابع (يوم)'],
    rows: repF.length ? [...repF.map((r) => ({ c: [r.branch, N(r.count), N(r.notified), N(r.not_notified), N(r.max_streak)], hl: +r.not_notified > 0 ? 'red' : null })),
      { c: ['الإجمالي', N(rep.count), N(rep.notified), N(rep.not_notified), ''], total: 1 }] : [{ c: ['لا توجد أوردرات متكررة حاليًا', '', '', '', ''] }] });
  B.push({ t: 'note', text: 'المتكرر = شحنة ظهرت متأخرة في أيام متتالية، وتُحسب من آخر تحديث للشيت وليس من اليوم المختار. المظلل: فروع بها متكرر لم يُبلَّغ عنه.' });

  D.h('أكثر الحالات تأخرًا');
  const sd = statuses.filter((s) => s.date === day);
  const stm = new Map(); sd.forEach((s) => stm.set(s.status, (stm.get(s.status) || 0) + (+s.n || 0)));
  const stTop = [...stm].sort((a, b) => b[1] - a[1]).slice(0, 10), stTot = [...stm.values()].reduce((a, b) => a + b, 0);
  B.push({ t: 'table', w: [50, 25, 25], cols: ['حالة الشحنة', 'عدد الشحنات المتأخرة', 'النسبة من تأخر الحالة'],
    rows: stTop.length ? [...stTop.map(([k, v]) => ({ c: [k, N(v), P(v, stTot)] })), { c: ['الإجمالي (كل الحالات)', N(stTot), stTot ? '100.0%' : '—'], total: 1 }] : [{ c: ['لا توجد بيانات حالات لهذا اليوم', '', ''] }] });
  B.push({ t: 'note', text: 'تأخر الحالة للشحنات التي تجاوزت حد حالتها (من جدول Rules). بيانات الحالات متاحة لآخر 14 يومًا فقط.' });

  D.h('المقارنة باليوم السابق');
  if (Pv) {
    const items = [['شحنات للمتابعة', 'followup', true], ['أوردر متأخر (الشركة)', 'order_late', true], ['خدمة عملاء', 'cs_late', true], ['حالة فقط', 'case_only', true],
      ['لم يُبلَّغ بعد', 'unnotified', true], ['نسبة التبليغ', 'noti', false, true], ['التحصيل المعرّض (ج.م)', 'cod_oc', true]];
    B.push({ t: 'table', w: [30, 17, 17, 16, 20], cols: ['المؤشر', dmy(prevD), per, 'الفرق', 'الاتجاه'], rows: items.map(([l, k, lb, pp]) => {
      const d = T[k] - Pv[k]; const better = lb ? d < 0 : d > 0;
      return { c: [l, pp ? P(Pv[k], 100) : N(Pv[k]), pp ? P(T[k], 100) : N(T[k]), (d > 0 ? '+' : '') + (pp ? D1(d) + ' نقطة' : N(d)), d === 0 ? 'ثابت' : better ? 'تحسن' : 'تراجع'] };
    }) });
    B.push({ t: 'note', text: `المقارنة بين ${per} و${dmy(prevD)} (أقرب يوم أوديت سابق في البيانات). الاتجاه: انخفاض الأعداد تحسن، وارتفاع نسبة التبليغ تحسن.` });
  } else B.push({ t: 'p', text: 'لا يوجد يوم أوديت سابق للمقارنة في البيانات المحمّلة.' });

  const Q = [];
  const gaps = []; for (let k = 1; k < dates.length; k++) if (dates[k] <= day) gaps.push(...missingWorkDays(dates[k - 1], dates[k]));
  if (gaps.length) Q.push(['أيام عمل بلا تاب أوديت', `لا توجد بيانات للأيام: ${gaps.slice(-6).map(dmy).join('، ')} (الجمعة إجازة ولا تُحسب)`, 'لم تُحتسب']);
  if (T.case_only && T.case_first / T.case_only >= 0.5) Q.push(['تأخر الحالة عند الحد نفسه', `${N(T.case_first)} من ${N(T.case_only)} شحنة «حالة فقط» (${P(T.case_first, T.case_only)}) عمر حالتها يساوي حدها بالضبط، أي أول يوم تأخر`, 'عُرضت كما هي؛ يُراجع الحد مع SOP']);
  if (!sd.length) Q.push(['بيانات الحالات', 'غير متاحة لهذا اليوم (تُجمّع لآخر 14 يومًا فقط)', 'جدول الحالات فارغ']);
  Q.push(['تجميع الأعداد', 'كل الأرقام مجمّعة (يوم × فرع) من تابات الشيت، ولا تتضمن أرقام بوالص أو عملاء أو مناديب', 'بالتصميم']);
  Q.push(['بداية التأخر', 'التأخر يبدأ عند الحد نفسه (≥) حسب إعداد Rules!B8', 'يتغير بتغيير الإعداد في الشيت']);
  tableQ(D, Q);

  const R = [];
  if (T.unnotified > 0) {
    const g = [...today].filter((r) => r.unnotified > 0).sort((a, b) => b.unnotified - a.unnotified).slice(0, 3).map((r) => `${r.branch} (${N(r.unnotified)})`).join('، ');
    R.push([`${N(T.unnotified)} أوردر/خدمة عملاء لم يُبلَّغ بعد من ${N(T.oc)} (${P(T.unnotified, T.oc)})، أعلاها: ${g}`, 'استكمال تبليغ الفروع وخدمة العملاء اليوم وتسجيل نوع التبليغ في الشيت', 'عالية']);
  }
  const hotB = today.filter((r) => r.rate > th.bad).sort((a, b) => b.rate - a.rate);
  if (hotB.length) R.push([`فروع نسبة الأوردرات المتأخرة فيها أعلى من ${th.bad}%: ${hotB.slice(0, 4).map((r) => `${r.branch} (${P(r.oc, r.total)})`).join('، ')}`, 'طلب خطة تصحيح وموعد تقفيل من هذه الفروع', 'عالية']);
  if (rep.not_notified > 0) R.push([`${N(rep.not_notified)} أوردر متكرر لم يُبلَّغ عنه`, 'تبليغ فوري وتصعيد للمسؤول المباشر', 'عالية']);
  else if (rep.count > 0) R.push([`${N(rep.count)} أوردر متكرر رغم التبليغ`, 'تصعيد للإدارة بدل تكرار التبليغ نفسه', 'متوسطة']);
  if (T.oc && T.noti < covMin) R.push([`نسبة تبليغ الأوردر وخدمة العملاء ${P(T.notified_oc, T.oc)} أقل من ${covMin}%`, 'رفع نسبة التبليغ اليومية وتسجيلها أولًا بأول', 'متوسطة']);
  if (T.case_only && T.case_first / T.case_only >= 0.5) R.push([`${P(T.case_first, T.case_only)} من «حالة فقط» عند الحد نفسه (أول يوم)`, 'مراجعة حدود عمر الحالة في SOP للحالات القصيرة (يوم واحد) قبل تعميمها', 'متوسطة']);
  tableRec(D, R);
  return D.done();
}

/* ======================= 2) تقرير أداء الفروع (فترة) ======================= */
export function branchesReport(ctx) {
  const { rows, th, covMin } = ctx;
  const all = [...new Set(rows.map((r) => r.date))].sort();
  if (!all.length) return emptyDoc('تقرير أداء الفروع', 'لا توجد أيام أوديت في البيانات المحمّلة.');
  const from = ctx.from && all.includes(ctx.from) ? ctx.from : all[Math.max(0, all.length - 14)];
  const to = ctx.to && all.includes(ctx.to) ? ctx.to : all[all.length - 1];
  const dts = all.filter((d) => d >= from && d <= to), nd = dts.length;
  const cur = rows.filter((r) => r.date >= from && r.date <= to);
  const before = all.filter((d) => d < from).slice(-nd), prev = before.length ? rows.filter((r) => before.includes(r.date)) : [];
  const per = `${dmy(from)} إلى ${dmy(to)}`;
  const dayAvg = (k, arr = cur, n = nd) => (n ? arr.reduce((s, r) => s + (+r[k] || 0), 0) / n : 0);
  const D = mk('تقرير أداء الفروع — أوديت الأوردرات المتأخرة', `الفترة: ${per}`, per,
    `المصدر: تابات الأوديت اليومية في الشيت — ${N(nd)} يوم أوديت، ${N(new Set(cur.map((r) => r.branch)).size)} فرعًا`,
    `ترتيب الفروع حسب الأوردرات المتأخرة (أوردر الشركة وخدمة العملاء) وتأخر الحالة خلال الفترة ${per}، ومقارنتها بالفترة السابقة، وبيان التوزيع الأسبوعي وأسوأ أيام الفروع، لتحديد الفروع التي تحتاج تدخل الإدارة.`);
  const B = D.B;
  const tot = sum(cur);

  D.h('المؤشرات الرئيسية');
  B.push({ t: 'kpis', cards: [
    { label: 'أيام الأوديت في الفترة', value: N(nd), sub: per, tone: 'navy' },
    { label: 'متوسط أوردر الشركة المتأخر يوميًا', value: D1(dayAvg('order_late')), sub: `إجمالي المتأخر عبر الأيام: ${N(tot.order_late)}`, tone: 'red' },
    { label: 'متوسط خدمة العملاء يوميًا', value: D1(dayAvg('cs_late')), sub: `إجمالي عبر الأيام: ${N(tot.cs_late)}`, tone: 'teal' },
    { label: 'نسبة تبليغ الأوردر وخدمة العملاء', value: P(tot.notified_oc, tot.oc), sub: `${N(tot.notified_oc)} اتبلّغ من ${N(tot.oc)} (مجموع الأيام)`, tone: 'navy' }] });
  B.push({ t: 'note', text: 'المتوسطات = إجمالي الأيام ÷ عدد أيام الأوديت. الشحنة المتأخرة عدة أيام تُحسب في كل يوم، لذلك لا تُعرض الإجماليات كعدد شحنات فريدة. ' + defsNote });

  D.h('ترتيب الفروع (متوسط يومي)');
  const brs = groupBy(cur, (r) => r.branch).map(([k, v]) => { const s = sum(v); const d = v.length; return { k, region: v[0].region || '—', s, d, over: v.filter((r) => r.rate > th.bad).length }; }).sort((a, b) => b.s.rate - a.s.rate);
  B.push({ t: 'table', w: [14, 15, 8, 9, 9, 9, 10, 10, 8, 8], cols: ['الفرع', 'الإقليم', 'الأيام', 'متوسط الشحنات', 'متوسط أوردر الشركة', 'متوسط خدمة عملاء', 'متوسط حالة فقط', 'نسبة الأوردرات المتأخرة', 'نسبة التبليغ', 'أيام فوق الحد'],
    rows: [...brs.map(({ k, region, s, d, over }) => ({ c: [k, region, N(d), N(Math.round(s.total / d)), D1(s.order_late / d), D1(s.cs_late / d), D1(s.case_only / d), P(s.oc, s.total), P(s.notified_oc, s.oc), N(over)], hl: s.rate > th.bad ? 'red' : null })),
      { c: ['الإجمالي (متوسط يومي)', '', N(nd), N(Math.round(dayAvg('total'))), D1(dayAvg('order_late')), D1(dayAvg('cs_late')), D1(dayAvg('case_only')), P(tot.oc, tot.total), P(tot.notified_oc, tot.oc), ''], total: 1 }] });
  B.push({ t: 'note', text: `نسبة الأوردرات المتأخرة = (أوردر + خدمة عملاء) ÷ شحنات التصدير على مستوى الفترة. المظلل: الفروع فوق ${th.bad}%. «أيام فوق الحد» = عدد الأيام التي تجاوزت فيها نسبة الفرع ${th.bad}%.` });

  D.h('المقارنة بالفترة السابقة');
  if (prev.length) {
    const pm = new Map(groupBy(prev, (r) => r.branch).map(([k, v]) => [k, sum(v)]));
    const cmp = brs.map(({ k, s }) => { const p = pm.get(k); return { k, now: s.rate, was: p ? p.rate : null }; }).filter((x) => x.was != null);
    cmp.sort((a, b) => (b.now - b.was) - (a.now - a.was));
    B.push({ t: 'table', w: [30, 20, 20, 15, 15], cols: ['الفرع', `نسبة الفترة السابقة`, 'نسبة الفترة الحالية', 'الفرق (نقطة)', 'الاتجاه'],
      rows: cmp.map((x) => { const d = x.now - x.was; return { c: [x.k, P(x.was, 100), P(x.now, 100), (d > 0 ? '+' : '') + D1(d), Math.abs(d) < 0.05 ? 'ثابت' : d < 0 ? 'تحسن' : 'تراجع'], hl: d >= 1 ? 'red' : null }; }) });
    B.push({ t: 'note', text: `الفترة السابقة: ${dmy(before[0])} إلى ${dmy(before[before.length - 1])} (${N(before.length)} يوم أوديت). المظلل: ارتفاع نسبة الفرع نقطة مئوية فأكثر.` });
  } else B.push({ t: 'p', text: 'لا توجد بيانات لفترة سابقة مساوية للمقارنة.' });

  D.h('التوزيع الأسبوعي');
  const wks = groupBy(cur, (r) => weekStart(r.date)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  B.push({ t: 'table', w: [22, 10, 14, 14, 14, 14, 12], cols: ['الأسبوع (يبدأ السبت)', 'الأيام', 'متوسط أوردر الشركة', 'متوسط خدمة عملاء', 'متوسط حالة فقط', 'نسبة الأوردرات المتأخرة', 'نسبة التبليغ'],
    rows: wks.map(([k, v]) => { const s = sum(v); const d = new Set(v.map((r) => r.date)).size; return { c: [`من ${dmy(k)}`, N(d), D1(s.order_late / d), D1(s.cs_late / d), D1(s.case_only / d), P(s.oc, s.total), P(s.notified_oc, s.oc)] }; }) });
  B.push({ t: 'note', text: 'الأسبوع من السبت إلى الجمعة، وتاريخ الأسبوع = أول يوم فيه. الأسبوع الأول والأخير قد يكونان جزئيين حسب حدود الفترة.' });

  D.h('أعلى عشر مرات لفرع في يوم');
  const top = [...cur].filter((r) => r.oc > 0).sort((a, b) => b.oc - a.oc || b.rate - a.rate).slice(0, 10);
  B.push({ t: 'table', w: [5, 14, 18, 17, 12, 12, 11, 11], cols: ['م', 'التاريخ', 'الفرع', 'الإقليم', 'أوردر الشركة', 'خدمة عملاء', 'نسبة الأوردرات المتأخرة', 'لم يُبلَّغ'],
    rows: top.length ? top.map((r, k) => ({ c: [N(k + 1), dmy(r.date), r.branch, r.region || '—', N(r.order_late), N(r.cs_late), P(r.oc, r.total), N(r.unnotified)] })) : [{ c: ['', 'لا توجد بيانات', '', '', '', '', '', ''] }] });
  B.push({ t: 'note', text: 'الترتيب حسب (أوردر + خدمة عملاء) في اليوم الواحد.' });

  const Q = [];
  const gaps = []; for (let k = 1; k < dts.length; k++) gaps.push(...missingWorkDays(dts[k - 1], dts[k]));
  if (gaps.length) Q.push(['أيام عمل بلا تاب أوديت', `لا توجد بيانات للأيام: ${gaps.map(dmy).join('، ')} (الجمعة إجازة ولا تُحسب)`, 'لم تُحتسب في المتوسطات']);
  if (nd < 5) Q.push(['فترة قصيرة', `الفترة ${N(nd)} أيام أوديت فقط، فالمتوسطات حساسة ليوم واحد`, 'يُفضّل أسبوع فأكثر']);
  Q.push(['المتوسطات اليومية', 'الشحنة المتأخرة لعدة أيام تُحسب في كل يوم، فلا تُجمع الأيام كعدد شحنات فريدة', 'اعتُمدت المتوسطات']);
  Q.push(['تجميع الأعداد', 'أعداد مجمّعة (يوم × فرع)؛ لا توجد أرقام بوالص أو عملاء أو مناديب', 'بالتصميم']);
  tableQ(D, Q);

  const R = [];
  const hotB = brs.filter((x) => x.s.rate > th.bad);
  if (hotB.length) R.push([`فروع نسبة الأوردرات المتأخرة فيها أعلى من ${th.bad}% خلال الفترة: ${hotB.slice(0, 4).map((x) => `${x.k} (${P(x.s.oc, x.s.total)})`).join('، ')}`, 'طلب خطة تصحيح ومتابعة أسبوعية لهذه الفروع', 'عالية']);
  const lowN = brs.filter((x) => x.s.oc >= 20 && x.s.noti < covMin);
  if (lowN.length) R.push([`فروع نسبة تبليغ الأوردر وخدمة العملاء فيها أقل من ${covMin}%: ${lowN.slice(0, 4).map((x) => `${x.k} (${P(x.s.notified_oc, x.s.oc)})`).join('، ')}`, 'رفع نسبة التبليغ وتسجيله يوميًا في الشيت', 'متوسطة']);
  if (prev.length) { const pm = new Map(groupBy(prev, (r) => r.branch).map(([k, v]) => [k, sum(v)])); const worse = brs.filter((x) => pm.get(x.k) && x.s.rate - pm.get(x.k).rate >= 1); if (worse.length) R.push([`فروع ارتفعت نسبتها نقطة فأكثر عن الفترة السابقة: ${worse.slice(0, 4).map((x) => x.k).join('، ')}`, 'متابعة أسباب التراجع مع الفروع', 'متوسطة']); }
  tableRec(D, R);
  return D.done();
}

/* ======================= 3) تقرير التبليغات والتصعيد (فترة) ======================= */
export function notifyReport(ctx) {
  const { rows, repeated, th, covMin } = ctx;
  const all = [...new Set(rows.map((r) => r.date))].sort();
  if (!all.length) return emptyDoc('تقرير التبليغات والتصعيد', 'لا توجد أيام أوديت في البيانات المحمّلة.');
  const from = ctx.from && all.includes(ctx.from) ? ctx.from : all[Math.max(0, all.length - 14)];
  const to = ctx.to && all.includes(ctx.to) ? ctx.to : all[all.length - 1];
  const cur = rows.filter((r) => r.date >= from && r.date <= to), nd = new Set(cur.map((r) => r.date)).size;
  const per = `${dmy(from)} إلى ${dmy(to)}`, tot = sum(cur);
  const tn = tot.n_cs + tot.n_int + tot.n_ext;
  const rep = repeated.reduce((a, r) => ({ count: a.count + (+r.count || 0), notified: a.notified + (+r.notified || 0), not_notified: a.not_notified + (+r.not_notified || 0) }), { count: 0, notified: 0, not_notified: 0 });
  const D = mk('تقرير التبليغات والتصعيد — أوديت الأوردرات المتأخرة', `الفترة: ${per}`, per,
    `المصدر: التبليغات المسجلة في تابات الأوديت اليومية — ${N(nd)} يوم أوديت`,
    `قياس ما تم تبليغه خلال الفترة ${per} (خدمة العملاء، الفروع الداخلية، الفروع الخارجية)، ونسبة تبليغ الأوردر وخدمة العملاء، والفروع الأقل تبليغًا، والأوردرات المتكررة بعد التبليغ، لمتابعة التزام الفروع وتحديد ما يحتاج تصعيدًا.`);
  const B = D.B;

  D.h('المؤشرات الرئيسية');
  B.push({ t: 'kpis', cards: [
    { label: 'إجمالي التبليغات المسجلة', value: N(tn), sub: `خلال ${N(nd)} يوم أوديت`, tone: 'navy' },
    { label: 'تبليغ خدمة عملاء', value: N(tot.n_cs), pct: P(tot.n_cs, tn), sub: 'من إجمالي التبليغات', tone: 'teal' },
    { label: 'تبليغ فروع داخلية / خارجية', value: `${N(tot.n_int)} / ${N(tot.n_ext)}`, sub: `${P(tot.n_int, tn)} داخلية | ${P(tot.n_ext, tn)} خارجية`, tone: 'navy' },
    { label: 'نسبة تبليغ الأوردر وخدمة العملاء', value: P(tot.notified_oc, tot.oc), sub: `${N(tot.notified_oc)} اتبلّغ من ${N(tot.oc)} (مجموع الأيام)`, tone: tot.oc && tot.noti < covMin ? 'red' : 'teal' }] });
  B.push({ t: 'note', text: 'كل تبليغ يُحسب مرة لكل يوم تاب؛ فالشحنة المبلَّغ عنها في يومين تُعد تبليغين. «أوردر/خدمة» = أوردر الشركة أو خدمة العملاء (الأنواع المطلوب تبليغها).' });

  D.h('التبليغات حسب الفرع');
  const brs = groupBy(cur, (r) => r.branch).map(([k, v]) => ({ k, region: v[0].region || '—', s: sum(v) })).sort((a, b) => b.s.unnotified - a.s.unnotified);
  B.push({ t: 'table', w: [16, 17, 10, 10, 10, 11, 13, 13], cols: ['الفرع', 'الإقليم', 'خدمة عملاء', 'فروع داخلية', 'فروع خارجية', 'أوردر/خدمة مطلوب', 'اتبلّغ', 'نسبة التبليغ'],
    rows: [...brs.map(({ k, region, s }) => ({ c: [k, region, N(s.n_cs), N(s.n_int), N(s.n_ext), N(s.oc), N(s.notified_oc), P(s.notified_oc, s.oc)], hl: s.oc >= 20 && s.noti < covMin ? 'red' : null })),
      { c: ['الإجمالي', '', N(tot.n_cs), N(tot.n_int), N(tot.n_ext), N(tot.oc), N(tot.notified_oc), P(tot.notified_oc, tot.oc)], total: 1 }] });
  B.push({ t: 'note', text: `مرتب حسب الأكثر تركًا بلا تبليغ. المظلل: فروع نسبة تبليغها أقل من ${covMin}% (وعندها 20 أوردر/خدمة فأكثر عبر الأيام).` });

  D.h('التوزيع الأسبوعي للتبليغات');
  const wks = groupBy(cur, (r) => weekStart(r.date)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  B.push({ t: 'table', w: [22, 10, 14, 14, 14, 13, 13], cols: ['الأسبوع (يبدأ السبت)', 'الأيام', 'خدمة عملاء', 'فروع داخلية', 'فروع خارجية', 'أوردر/خدمة مطلوب', 'نسبة التبليغ'],
    rows: wks.map(([k, v]) => { const s = sum(v); return { c: [`من ${dmy(k)}`, N(new Set(v.map((r) => r.date)).size), N(s.n_cs), N(s.n_int), N(s.n_ext), N(s.oc), P(s.notified_oc, s.oc)] }; }) });
  B.push({ t: 'note', text: 'الأسبوع من السبت إلى الجمعة، وتاريخ الأسبوع = أول يوم فيه.' });

  D.h('الأوردرات المتكررة حسب الفرع');
  const repF = [...repeated].sort((a, b) => (+b.count || 0) - (+a.count || 0)).slice(0, 12);
  B.push({ t: 'table', w: [24, 15, 15, 15, 15, 16], cols: ['الفرع', 'متكرر', 'اتبلّغ', 'لم يُبلَّغ', 'أقصى تتابع (يوم)', 'تبليغ خدمة عملاء'],
    rows: repF.length ? [...repF.map((r) => ({ c: [r.branch, N(r.count), N(r.notified), N(r.not_notified), N(r.max_streak), N(r.t_cs)], hl: +r.not_notified > 0 ? 'red' : null })),
      { c: ['الإجمالي', N(rep.count), N(rep.notified), N(rep.not_notified), '', ''], total: 1 }] : [{ c: ['لا توجد أوردرات متكررة حاليًا', '', '', '', '', ''] }] });
  B.push({ t: 'note', text: 'المتكرر من آخر تحديث للشيت (شحنة متأخرة في أيام متتالية)، وليس مقيدًا بالفترة المختارة. المظلل: فروع بها متكرر لم يُبلَّغ عنه.' });

  const Q = [];
  if (!tn) Q.push(['لا توجد تبليغات مسجلة', 'عمود «نوع التبليغ» فارغ في تابات الفترة', 'قد يعني عدم التسجيل وليس عدم التبليغ']);
  Q.push(['مصدر التبليغ', 'يعتمد على ما يسجله المراجع في عمود «نوع التبليغ» بتاب اليوم، ولا يوجد دليل خارجي عليه', 'احتُسب كما هو مسجل']);
  Q.push(['تجميع الأعداد', 'أعداد مجمّعة (يوم × فرع)؛ لا توجد أرقام بوالص أو عملاء أو مناديب', 'بالتصميم']);
  tableQ(D, Q);

  const R = [];
  const low = brs.filter((x) => x.s.oc >= 20 && x.s.noti < covMin);
  if (low.length) R.push([`فروع نسبة تبليغها أقل من ${covMin}%: ${low.slice(0, 4).map((x) => `${x.k} (${P(x.s.notified_oc, x.s.oc)})`).join('، ')}`, 'متابعة سبب ترك الأوردرات بلا تبليغ وإلزام التسجيل اليومي', 'عالية']);
  if (rep.not_notified > 0) R.push([`${N(rep.not_notified)} أوردر متكرر لم يُبلَّغ عنه`, 'تبليغ فوري وتصعيد للمسؤول المباشر', 'عالية']);
  if (rep.notified > 0) R.push([`${N(rep.notified)} أوردر ما زال متأخرًا رغم التبليغ`, 'تصعيد للإدارة بدل تكرار التبليغ نفسه، وتحديد جهة الحل', 'متوسطة']);
  if (tn && tot.n_ext > tot.n_int) R.push([`التبليغات الخارجية (${N(tot.n_ext)}) أكثر من الداخلية (${N(tot.n_int)})`, 'مراجعة سبب كثرة التبليغات الخارجية وجهات الحل', 'منخفضة']);
  tableRec(D, R);
  return D.done();
}

export function buildReport(id, ctx) {
  const doc = id === 'branches' ? branchesReport(ctx) : id === 'notify' ? notifyReport(ctx) : execReport(ctx);
  if (ctx.demo) {   // وضع المعاينة: علّم المستند صراحةً أنه بيانات تجريبية غير حقيقية
    const src = doc.blocks.find((b) => b.t === 'src');
    if (src) src.text = 'بيانات تجريبية غير حقيقية — ' + src.text;
    doc.footer += '  |  بيانات تجريبية';
  }
  return doc;
}
