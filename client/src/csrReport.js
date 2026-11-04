// Monthly driver remittance & collection report for one CSR (manager), in the same layout as the
// company's AT_CSR_<MONTH> workbook: a <MONTH> sheet, a SUMMARY sheet and a DEFAULT DETAIL sheet,
// with the same formulas so the file keeps working when it is edited in Excel.

import { buildStatement, dueThroughNow } from './statement.js';
import { DEPARTMENTS, REASONS, reasonInfo } from './reasons.js';

const MONEY = { daily: 1, adjustment: 1 };
const monthEnd = month => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)); return d.toISOString().slice(0, 10); };
const sumBy = (arr, f) => arr.reduce((n, x) => n + (Number(f(x)) || 0), 0);

/**
 * Works out one row per driver contract that ran during the month, plus one default row per day off.
 * A pay day counts as worked when it has no day off and money came in for it (as on the daily breakdown).
 */
export function csrData({ contracts, payments, offDays, month, today }) {
  const from = `${month}-01`, to = monthEnd(month);
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const payBy = {}, offBy = {};
  payments.forEach(p => { (payBy[p.contract_id] = payBy[p.contract_id] || []).push(p); });
  offDays.forEach(o => { (offBy[o.contract_id] = offBy[o.contract_id] || []).push(o); });

  const rows = [], defaults = [];
  contracts
    .filter(c => c.start_date && c.start_date <= to && c.start_date <= yesterday)
    .filter(c => { const stop = [c.ended_on, c.end_date].filter(Boolean).sort()[0]; return !stop || stop >= from; })
    .sort((a, b) => String(a.driver_name || '').localeCompare(String(b.driver_name || '')) || a.id - b.id)
    .forEach(c => {
      const pays = payBy[c.id] || [], offs = offBy[c.id] || [];
      const st = buildStatement(c, pays, today, offs, dueThroughNow());
      // Yesterday's work isn't counted until its 9pm deadline has passed (unless it's already paid).
      const days = st.days.filter(d => d.pay && !d.future && d.date >= from && d.date <= to && d.status !== 'due_tonight');
      const name = String(c.driver_name || '').toUpperCase();
      const reg = String(c.reg_number || '').toUpperCase();
      const batch = c.batch || (c.type === 'daily_hire' ? 'EV' : '');
      const carType = String(c.make || '').toUpperCase();
      let worked = 0;
      days.forEach(d => {
        // Worked: money came in for the day (part payments too – the shortfall shows in the revenue columns).
        if (!d.off && (d.status === 'paid' || d.status === 'part' || d.status === 'part_tonight')) { worked++; return; }
        if (d.off) {
          const r = reasonInfo(d.off.reason);
          defaults.push({ date: d.date, name, reg, batch, carType, dept: r.dept, reason: r.report, remarks: d.off.note || '' });
        } else if (d.status === 'excused') {
          defaults.push({ date: d.date, name, reg, batch, carType, dept: '', reason: '', remarks: `Excused: ${d.excused}` });
        }
      });
      rows.push({
        contract_id: c.id, name, reg, batch, carType, rate: Number(c.daily_rate) || 0,
        expectedDays: days.length, workedDays: worked,
        remitted: sumBy(pays.filter(p => p.type === 'daily' && p.work_date >= from && p.work_date <= to), p => p.amount),
        finalCost: c.type === 'work_and_pay' && c.contract_value ? Number(c.contract_value) : null,
        accumulated: sumBy(pays.filter(p => MONEY[p.type] && (p.type === 'adjustment' || p.work_date <= to)), p => p.amount),
      });
    });
  defaults.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
  const unexplained = rows.reduce((n, r) => n + r.expectedDays - r.workedDays, 0) - defaults.length;
  return { rows, defaults, unexplained, from, to };
}

// ---------- workbook ----------

const NAVY = '#1F4E78', BLUE = '#2F5597', LIGHT = '#DDEBF7', GREY = '#F2F2F2', BORDER = '#A6A6A6';
const MONEY_FMT = '#,##0.00', PCT1 = '0.0%', PCT0 = '0%';
const f = (formula, extra) => ({ type: 'Formula', value: formula, borderColor: BORDER, ...extra });
const n = (v, extra) => (v == null || v === '' ? { value: null, borderColor: BORDER, ...extra, format: undefined } : { type: Number, value: v, borderColor: BORDER, ...extra });
const t = (v, extra) => ({ type: String, value: v == null ? '' : String(v), borderColor: BORDER, ...extra });
const head = v => ({ type: String, value: v, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: BLUE, wrap: true, align: 'center', alignVertical: 'center', borderColor: BORDER });
const label = (v, extra) => ({ type: String, value: v, fontWeight: 'bold', ...extra });
const DD = "'DEFAULT DETAIL'";
const DD_LAST = 2000;

/** The sheets for write-excel-file. */
export function csrWorkbook({ rows, defaults }, { csrName, month }) {
  const monthName = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }).toUpperCase();
  const year = month.slice(0, 4);
  const M = monthName; // sheet name, e.g. OCTOBER
  const counts = {};
  rows.forEach(r => { counts[r.rate] = (counts[r.rate] || 0) + 1; });
  const mainRate = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]) || 400;
  const first = 4, last = Math.max(first, first + rows.length - 1), total = last + 1;

  // ----- <MONTH> sheet -----
  const main = [];
  main.push([{ type: String, value: 'MONTHLY DRIVER REMITTANCE & COLLECTION REPORT', fontWeight: 'bold', fontSize: 16, textColor: NAVY, align: 'center', alignVertical: 'center', columnSpan: 12, height: 30 }]);
  main.push([label('CSR NAME', { height: 22, alignVertical: 'center' }), { type: String, value: (csrName || '').toUpperCase(), fontWeight: 'bold', columnSpan: 4 }, null, null, null, null, null,
    label('DAILY RATE'), { type: Number, value: mainRate, fontWeight: 'bold', format: MONEY_FMT }]);
  main.push(['S/N', 'DRIVER NAME', 'CAR TYPE', 'BATCH TYPE (1ST/2ND/3RD)', 'CAR REGISTRATION NUMBER', 'EXPECTED DAYS TO WORK', 'TOTAL DAYS WORKED', 'DIFFERENCE',
    'TOTAL EXPECTED REVENUE', 'ACTUAL REMITTED REVENUE', 'DIFFERENCE', 'COLLECTION RATE', '', 'FINAL COST', 'ACCUMULATED REMITTANCES', 'BALANCE', '% PAID',
    'DAYS EXPLAINED (DEFAULT DETAIL)', 'UNEXPLAINED DAYS'].map((v, i) => (i === 12 ? null : { ...head(v), height: i === 0 ? 39 : undefined })));
  rows.forEach((r, i) => {
    const x = first + i;
    const ratePct = r.expectedDays && r.rate ? r.remitted / (r.expectedDays * r.rate) : null;
    const rateColor = ratePct == null ? undefined : ratePct >= 0.95 ? '#C6EFCE' : ratePct >= 0.8 ? '#FFEB9C' : '#FFC7CE';
    main.push([
      n(i + 1, { align: 'center' }), t(r.name), t(r.carType), t(r.batch, { align: 'center' }), t(r.reg),
      n(r.expectedDays, { align: 'center' }), n(r.workedDays, { align: 'center' }), f(`=F${x}-G${x}`, { align: 'center' }),
      f(r.rate === mainRate ? `=F${x}*$I$2` : `=F${x}*${r.rate}`, { format: MONEY_FMT }),
      n(r.remitted, { format: MONEY_FMT }), f(`=I${x}-J${x}`, { format: MONEY_FMT }),
      f(`=IF(I${x}>0,J${x}/I${x},"")`, { format: PCT1, backgroundColor: rateColor }), null,
      n(r.finalCost, { format: MONEY_FMT }), n(r.accumulated, { format: MONEY_FMT }),
      f(`=IF(N${x}>0,N${x}-O${x},"")`, { format: MONEY_FMT }), f(`=IF(N${x}>0,O${x}/N${x},"")`, { format: PCT0 }),
      f(`=COUNTIFS(${DD}!$C$4:$C$${DD_LAST},$B${x},${DD}!$D$4:$D$${DD_LAST},$E${x})`, { align: 'center' }),
      f(`=MAX(0,N(H${x})-R${x})`, { align: 'center' }),
    ]);
  });
  if (!rows.length) main.push([t('', {}), t('No drivers with a contract in this month')]);
  const tot = { fontWeight: 'bold', backgroundColor: LIGHT };
  const S = c => f(`=SUM(${c}${first}:${c}${last})`, { ...tot, format: /[IJNOP]/.test(c) ? MONEY_FMT : undefined, align: /[FGHRS]/.test(c) ? 'center' : undefined });
  main.push([{ ...t('TOTAL', tot), align: 'center', columnSpan: 5 }, null, null, null, null, S('F'), S('G'), S('H'), S('I'), S('J'),
    f(`=I${total}-J${total}`, { ...tot, format: MONEY_FMT }), f(`=IF(I${total}>0,J${total}/I${total},"")`, { ...tot, format: PCT1 }), null,
    S('N'), S('O'), S('P'), t('', tot), S('R'), S('S')]);
  main.push([], []);
  main.push([null, label('NAME')]);
  main.push([null, t((csrName || '').toUpperCase())]);
  main.push([null, label('EXPECTED MONTHLY REMITTANCE'), f(`=I${total}`, { format: MONEY_FMT })]);
  main.push([null, label('ACTUAL REMITTANCE'), f(`=J${total}`, { format: MONEY_FMT })]);
  main.push([null, label('DIFFERENCE'), f(`=K${total}`, { format: MONEY_FMT })]);
  const mainCols = [9.4, 32.6, 13.6, 16.4, 13.4, 15.1, 13, 14, 15.4, 16.1, 14.5, 15.1, 6.1, 16.6, 16, 15.1, 11.1, 15.9, 13].map(width => ({ width }));

  // ----- SUMMARY sheet -----
  const rng = c => `${M}!$${c}$${first}:$${c}$${last}`;
  const sum = [];
  const put = (r, c, v) => { while (sum.length <= r) sum.push([]); sum[r][c] = v; };
  const col = l => l.charCodeAt(0) - 65; // single letters only
  const B = 1;
  put(1, B, label(`DEFAULT SUMMARY - ${monthName} ${year}`, { fontSize: 14, textColor: NAVY }));
  put(2, B, t(`Linked to ${M} (days defaulted) and DEFAULT DETAIL (reasons). One DEFAULT DETAIL row = one defaulted day.`, { borderColor: undefined, textColor: '#595959' }));
  put(3, col('O'), label('LOOKUP LISTS (used by DEFAULT DETAIL - do not delete)'));
  put(4, B, label('KEY METRICS', { textColor: NAVY }));
  ['DEPARTMENT RESPONSIBLE', 'DEFAULT REASON', 'BATCH', 'CAR TYPE'].forEach((h, i) => put(4, col('O') + i, head(h)));
  REASONS.forEach((r, i) => { put(5 + i, col('O'), t(r.dept)); put(5 + i, col('P'), t(r.report)); });
  ['1ST', '2ND', '3RD', 'EV'].forEach((b, i) => put(5 + i, col('Q'), t(b)));
  const carTypes = ['LIVAN', 'CIREO', 'BYD', 'BUS'];
  rows.forEach(r => { if (r.carType && carTypes.indexOf(r.carType) < 0) carTypes.push(r.carType); });
  carTypes.forEach((c, i) => put(5 + i, col('R'), t(c)));
  DEPARTMENTS.forEach((d, i) => put(5 + i, col('S'), t(d)));
  const lastReason = 6 + REASONS.length - 1; // P6:P16
  const metrics = [
    ['Daily remittance rate', `=${M}!I2`, MONEY_FMT],
    ['Total expected work days', `=${M}!F${total}`],
    ['Total days worked', `=${M}!G${total}`],
    ['Total days defaulted', `=${M}!H${total}`],
    ['Default rate (% of expected days)', '=IFERROR(C9/C7,0)', PCT1],
    ['Days explained (DEFAULT DETAIL)', `=COUNTIF(${DD}!$C$4:$C$${DD_LAST},"?*")`],
    ['Unexplained days (to follow up)', `=${M}!S${total}`],
    ['% of defaulted days explained', '=IFERROR(C11/C9,0)', PCT1],
    ['Revenue lost on defaulted days', '=C9*C6', MONEY_FMT],
    ['Revenue shortfall (expected - remitted)', `=${M}!K${total}`, MONEY_FMT],
    ['Drivers with defaulted days', `=COUNTIF(${rng('H')},">0")`],
  ];
  metrics.forEach(([l, fx, fmt], i) => { put(5 + i, B, t(l)); put(5 + i, B + 1, f(fx, { format: fmt, fontWeight: 'bold' })); });

  // by department (rows 19-23)
  put(17, B, label('DEFAULTS BY DEPARTMENT RESPONSIBLE', { textColor: NAVY }));
  ['DEPARTMENT', 'DAYS', '% OF EXPLAINED DAYS', 'REVENUE IMPACT'].forEach((h, i) => put(18, B + i, head(h)));
  DEPARTMENTS.forEach((d, i) => {
    const x = 20 + i;
    put(x - 1, B, f(`=$S$${6 + i}`)); put(x - 1, B + 1, f(`=COUNTIFS(${DD}!$G$4:$G$${DD_LAST},B${x})`));
    put(x - 1, B + 2, f(`=IFERROR(C${x}/$C$23,0)`, { format: PCT1 })); put(x - 1, B + 3, f(`=C${x}*$C$6`, { format: MONEY_FMT }));
  });
  put(22, B, t('TOTAL', tot)); put(22, B + 1, f('=SUM(C20:C22)', tot)); put(22, B + 2, f('=SUM(D20:D22)', { ...tot, format: PCT1 })); put(22, B + 3, f('=SUM(E20:E22)', { ...tot, format: MONEY_FMT }));

  // by reason (rows 26..)
  put(24, B, label('DEFAULTS BY REASON', { textColor: NAVY }));
  ['DEFAULT REASON', 'DEPARTMENT', 'DAYS', '% OF EXPLAINED DAYS', 'REVENUE IMPACT'].forEach((h, i) => put(25, B + i, head(h)));
  const rTot = 27 + REASONS.length;
  REASONS.forEach((r, i) => {
    const x = 27 + i;
    put(x - 1, B, f(`=$P$${6 + i}`)); put(x - 1, B + 1, f(`=$O$${6 + i}`));
    put(x - 1, B + 2, f(`=COUNTIFS(${DD}!$H$4:$H$${DD_LAST},B${x})`));
    put(x - 1, B + 3, f(`=IFERROR(D${x}/$D$${rTot},0)`, { format: PCT1 })); put(x - 1, B + 4, f(`=D${x}*$C$6`, { format: MONEY_FMT }));
  });
  put(rTot - 1, B, t('TOTAL', tot)); put(rTot - 1, B + 1, t('', tot));
  put(rTot - 1, B + 2, f(`=SUM(D27:D${rTot - 1})`, tot)); put(rTot - 1, B + 3, f(`=SUM(E27:E${rTot - 1})`, { ...tot, format: PCT1 })); put(rTot - 1, B + 4, f(`=SUM(F27:F${rTot - 1})`, { ...tot, format: MONEY_FMT }));

  // by batch
  const bHead = rTot + 2; // title row number
  put(bHead - 1, B, label('DEFAULTS BY BATCH', { textColor: NAVY }));
  ['BATCH', 'DRIVERS', 'DAYS DEFAULTED', 'DAYS EXPLAINED', 'UNEXPLAINED DAYS', '% EXPLAINED'].forEach((h, i) => put(bHead, B + i, head(h)));
  const b1 = bHead + 2;
  ['1ST', '2ND', '3RD', 'EV'].forEach((_, i) => {
    const x = b1 + i;
    put(x - 1, B, f(`=$Q$${6 + i}`)); put(x - 1, B + 1, f(`=COUNTIF(${rng('D')},B${x})`));
    put(x - 1, B + 2, f(`=SUMIF(${rng('D')},B${x},${rng('H')})`)); put(x - 1, B + 3, f(`=COUNTIFS(${DD}!$E$4:$E$${DD_LAST},B${x})`));
    put(x - 1, B + 4, f(`=SUMIF(${rng('D')},B${x},${rng('S')})`)); put(x - 1, B + 5, f(`=IFERROR(E${x}/D${x},0)`, { format: PCT0 }));
  });
  const bT = b1 + 4;
  put(bT - 1, B, t('TOTAL', tot));
  ['C', 'D', 'E', 'F'].forEach((c, i) => put(bT - 1, B + 1 + i, f(`=SUM(${c}${b1}:${c}${bT - 1})`, tot)));
  put(bT - 1, B + 5, f(`=IFERROR(E${bT}/D${bT},0)`, { ...tot, format: PCT0 }));

  // by driver
  const dTitle = bT + 2, dHead = dTitle + 1, d1 = dHead + 1;
  put(dTitle - 1, B, label('DEFAULTS BY DRIVER', { textColor: NAVY }));
  [t('DRIVER NAME'), t('BATCH'), t('DAYS DEFAULTED'), t('DAYS EXPLAINED'), f('=$S$6'), f('=$S$7'), f('=$S$8'), t('UNEXPLAINED DAYS'), t('STATUS')]
    .forEach((c, i) => put(dHead - 1, B + i, { ...c, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: BLUE, wrap: true, align: 'center' }));
  rows.forEach((_, i) => {
    const x = d1 + i, src = first + i;
    put(x - 1, B, f(`=${M}!B${src}`)); put(x - 1, B + 1, f(`=${M}!D${src}`, { align: 'center' }));
    put(x - 1, B + 2, f(`=N(${M}!H${src})`, { align: 'center' })); put(x - 1, B + 3, f(`=${M}!R${src}`, { align: 'center' }));
    ['F', 'G', 'H'].forEach((c, j) => put(x - 1, B + 4 + j, f(`=COUNTIFS(${DD}!$C$4:$C$${DD_LAST},$B${x},${DD}!$G$4:$G$${DD_LAST},${c}$${dHead})`, { align: 'center' })));
    put(x - 1, B + 7, f(`=${M}!S${src}`, { align: 'center' }));
    put(x - 1, B + 8, f(`=IF(E${x}>D${x},"CHECK: MORE DAYS LOGGED",IF(I${x}>0,"FOLLOW UP","OK"))`));
  });
  const dT = d1 + Math.max(rows.length, 1);
  const dl = dT - 1;
  put(dT - 1, B, t('TOTAL', tot)); put(dT - 1, B + 1, t('', tot));
  ['D', 'E', 'F', 'G', 'H', 'I'].forEach((c, i) => put(dT - 1, B + 2 + i, f(`=SUM(${c}${d1}:${c}${dl})`, { ...tot, align: 'center' })));
  put(dT - 1, B + 8, f(`=COUNTIF(J${d1}:J${dl},"FOLLOW UP")&" to follow up, "&COUNTIF(J${d1}:J${dl},"CHECK*")&" to check"`, tot));
  const sumCols = [3, 40, 16, 18, 18, 16, 16, 16, 16, 24, 3, 3, 3, 3, 24, 36, 10, 12, 18].map(width => ({ width }));

  // ----- DEFAULT DETAIL sheet -----
  const dd = [];
  dd.push([null, label(`DEFAULT DETAIL - ${monthName} ${year}`, { fontSize: 14, textColor: NAVY })]);
  dd.push([null, t('One row = one day a driver did not work. Add rows below for days you find out about later: type the date, name, registration number and reason.', { borderColor: undefined, textColor: '#595959' })]);
  dd.push(['S/N', 'DATE', 'NAME', 'REGISTRATION NUMBER', 'BATCH', 'CAR TYPE', 'DEPARTMENT RESPONSIBLE', 'DEFAULT REASON', 'FURTHER REMARKS'].map(head));
  const batchF = x => f(`=IF($C${x}="","",IFERROR(INDEX(${M}!$D$${first}:$D$${last},MATCH($C${x},${M}!$B$${first}:$B$${last},0)),"NOT ON ${M}"))`, { align: 'center' });
  const deptF = x => f(`=IF($H${x}="","",IFERROR(INDEX(SUMMARY!$O$6:$O$${lastReason},MATCH($H${x},SUMMARY!$P$6:$P$${lastReason},0)),"CHECK REASON"))`);
  defaults.forEach((d, i) => {
    dd.push([n(i + 1, { align: 'center' }),
      { type: Date, value: new Date(d.date + 'T00:00:00Z'), format: 'dd/mm/yyyy', borderColor: BORDER, align: 'center' },
      t(d.name), t(d.reg), t(d.batch, { align: 'center' }), t(d.carType),
      d.reason ? t(d.dept) : t(''), t(d.reason), t(d.remarks, { wrap: true })]);
  });
  // Spare rows with the lookups ready, for days added by hand.
  for (let i = 0; i < 40; i++) {
    const x = 4 + defaults.length + i;
    dd.push([n(defaults.length + i + 1, { align: 'center', textColor: '#A6A6A6' }), { value: null, type: Date, format: 'dd/mm/yyyy', borderColor: BORDER }, t(''), t(''), batchF(x), t(''), deptF(x), t(''), t('')]);
  }
  const ddCols = [6.6, 12.4, 30.5, 22.1, 9, 11, 22, 36, 51.1].map(width => ({ width }));

  return [
    { data: main, sheet: M, columns: mainCols, stickyRowsCount: 3 },
    { data: sum.map(r => Array.from({ length: Math.max(r.length, 1) }, (_, i) => (r[i] === undefined ? null : r[i]))), sheet: 'SUMMARY', columns: sumCols },
    { data: dd, sheet: 'DEFAULT DETAIL', columns: ddCols, stickyRowsCount: 3 },
  ];
}

export const csrFileName = (csrName, month) => {
  const m = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }).toUpperCase();
  return `AT_CSR_${m}-${String(csrName || 'ALL').toUpperCase().split(/\s+/)[0]}.xlsx`;
};
