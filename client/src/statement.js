import { reasonLabel } from './reasons.js';

// ---- date helpers (dates are YYYY-MM-DD strings, worked in UTC so time zones can't shift a day) ----
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const dow = d => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export const isPayDay = (d, mode) => mode === 'every_day' || dow(d) !== 0;
export const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const MONEY = { daily: 1, adjustment: 1 };

/** A day's money is due the day after the work, by 9pm (Ghana time). Unpaid after that, it is a debt. */
export const DEBT_HOUR = 21;
export function dueThroughNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return addDays(today, Number(parts.hour) % 24 >= DEBT_HOUR ? -1 : -2);
}

/**
 * Builds the day-by-day statement for one contract.
 * - Every pay day from the start date to yesterday (drivers pay the day after they work) is due at the daily rate.
 * - Excused days (waivers) are marked off first.
 * - A payment recorded for a day covers that day first. Anything extra (overpayments, money paid before
 *   FleetPro) then goes to the oldest days still unpaid. The total owing is the same either way.
 */
export function buildStatement(contract, payments, todayStr, offDays = [], debtThrough = addDays(todayStr, -1)) {
  const rate = Number(contract.daily_rate) || 0;
  const yesterday = addDays(todayStr, -1);
  const lastWork = payments.map(p => p.work_date).filter(Boolean).sort().slice(-1)[0];
  let end = lastWork && lastWork > yesterday ? lastWork : yesterday;
  const stop = [contract.ended_on, contract.end_date].filter(Boolean).sort()[0];
  if (stop && stop < end) end = stop;

  // Excused days: an excused entry covers (amount ÷ rate) pay days from its work date.
  const excused = {};
  payments.filter(p => p.type === 'waiver').forEach(p => {
    let n = rate ? Math.round(p.amount / rate) : 0;
    for (let d = p.work_date, i = 0; n > 0 && i < 400; d = addDays(d, 1), i++) {
      if (isPayDay(d, contract.payment_days)) { excused[d] = p.notes || 'Excused'; n--; }
    }
  });

  // Days off: excused ones aren't due; the others are still due but show the reason.
  const off = {};
  offDays.forEach(o => { off[o.date] = o; if (o.excused) excused[o.date] = `${reasonLabel(o.reason)} (excused)`; });

  // What was recorded against each day.
  const recorded = {};
  payments.filter(p => MONEY[p.type]).forEach(p => { (recorded[p.work_date] = recorded[p.work_date] || []).push(p); });

  const days = [];
  for (let d = contract.start_date, i = 0; d <= end && i < 4000; d = addDays(d, 1), i++) {
    const pay = isPayDay(d, contract.payment_days);
    const recs = recorded[d] || [];
    if (!pay && !recs.length) continue; // Sundays only appear if something was recorded on them
    // Yesterday, before 9pm: not a debt yet, so only what has already been paid for it counts as due.
    const pending = pay && !excused[d] && d > debtThrough && d <= yesterday;
    const own = recs.filter(p => p.type === 'daily').reduce((n, p) => n + Number(p.amount), 0);
    const due = pending ? Math.min(rate, own) : pay && !excused[d] && d <= yesterday ? rate : 0;
    days.push({ date: d, due, pay, pending, excused: excused[d] || null, off: off[d] || null, recs, recordedAmount: recs.reduce((n, p) => n + Number(p.amount), 0), future: d > yesterday });
  }

  // 1. Each day's own daily payments cover that day. 2. Extra money goes to the oldest unpaid days.
  const allMoney = payments.filter(p => MONEY[p.type]).reduce((n, p) => n + Number(p.amount), 0);
  let pool = allMoney;
  days.forEach(r => {
    const own = r.recs.filter(p => p.type === 'daily').reduce((n, p) => n + Number(p.amount), 0);
    r.covered = Math.min(r.due, own);
    pool -= r.covered;
  });
  days.forEach(r => {
    const extra = Math.min(r.due - r.covered, Math.max(pool, 0));
    r.covered += extra;
    pool -= extra;
  });
  let dueSoFar = 0, paidSoFar = 0, coveredSoFar = 0;
  days.forEach(r => {
    const covered = r.covered;
    coveredSoFar += covered;
    r.coveredSoFar = coveredSoFar;
    r.status = r.excused ? 'excused' : r.pending && covered < rate ? (covered > 0 ? 'part_tonight' : 'due_tonight') : r.due === 0 ? 'not_due' : covered >= r.due ? 'paid' : covered > 0 ? 'part' : r.off ? 'off_owed' : 'unpaid';
    dueSoFar += r.due;
    paidSoFar += r.recordedAmount;
    r.dueSoFar = dueSoFar;
    r.paidSoFar = paidSoFar;
  });
  const totalDue = dueSoFar;
  return { days, totalDue, totalPaid: allMoney, balance: totalDue - allMoney, rate, end };
}

