import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, fmtDate, human } from '../ui';

// ---- date helpers (dates are YYYY-MM-DD strings, worked in UTC so time zones can't shift a day) ----
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
const isPayDay = (d, mode) => mode === 'every_day' || dow(d) !== 0;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONEY = { daily: 1, adjustment: 1 };
export const OFF_REASONS = ['sick', 'workshop', 'maintenance', 'accident', 'personal_emergency', 'funeral', 'police', 'other'];
/** The car was out of action, so the driver isn't asked to pay for these by default. */
const EXCUSED_BY_DEFAULT = { workshop: 1, maintenance: 1 };
const reasonLabel = r => ({ police: 'Police / impounded' })[r] || human(r);

/**
 * Builds the day-by-day statement for one contract.
 * - Every pay day from the start date to yesterday (drivers pay the day after they work) is due at the daily rate.
 * - Excused days (waivers) are marked off first.
 * - A payment recorded for a day covers that day first. Anything extra (overpayments, money paid before
 *   FleetPro) then goes to the oldest days still unpaid. The total owing is the same either way.
 */
export function buildStatement(contract, payments, todayStr, offDays = []) {
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
    const due = pay && !excused[d] && d <= yesterday ? rate : 0;
    days.push({ date: d, due, pay, excused: excused[d] || null, off: off[d] || null, recs, recordedAmount: recs.reduce((n, p) => n + Number(p.amount), 0), future: d > yesterday });
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
    r.status = r.excused ? 'excused' : r.due === 0 ? 'not_due' : covered >= r.due ? 'paid' : covered > 0 ? 'part' : r.off ? 'off_owed' : 'unpaid';
    dueSoFar += r.due;
    paidSoFar += r.recordedAmount;
    r.dueSoFar = dueSoFar;
    r.paidSoFar = paidSoFar;
  });
  const totalDue = dueSoFar;
  return { days, totalDue, totalPaid: allMoney, balance: totalDue - allMoney, rate, end };
}

const STATUS = {
  paid: ['Paid', 'tone-ok'], part: ['Part paid', 'tone-warn'], unpaid: ['Not paid', 'tone-bad'],
  excused: ['Excused', 'tone-muted'], not_due: ['Not due yet', 'tone-muted'], off_owed: ['Day off – still owed', 'tone-warn'],
};

export default function DailyStatement({ contract, driverName, reloadKey, onChanged }) {
  const { money, can, notify } = useApp();
  const [payments, setPayments] = useState(null);
  const [offDays, setOffDays] = useState([]);
  const [open, setOpen] = useState(null);
  const [marking, setMarking] = useState(null); // { date, off? }
  const [version, setVersion] = useState(0);

  useEffect(() => {
    Promise.all([
      api('/payments', { query: { contract_id: contract.id, limit: 100000 } }),
      api('/off-days', { query: { contract_id: contract.id, limit: 100000 } }).catch(() => ({ rows: [] })),
    ]).then(([p, o]) => { setPayments(p.rows); setOffDays(o.rows); }).catch(() => setPayments([]));
  }, [contract.id, reloadKey, version]);

  const changed = () => { setVersion(v => v + 1); onChanged?.(); };
  const today = new Date().toISOString().slice(0, 10);
  const st = useMemo(() => (payments ? buildStatement(contract, payments, today, offDays) : null), [payments, offDays, contract, today]);
  const months = useMemo(() => {
    if (!st) return [];
    const by = {};
    st.days.forEach(r => { const k = r.date.slice(0, 7); (by[k] = by[k] || []).push(r); });
    return Object.keys(by).sort().reverse().map(k => {
      const rows = by[k];
      const last = rows[rows.length - 1];
      return {
        key: k, rows,
        due: rows.reduce((n, r) => n + r.due, 0),
        recorded: rows.reduce((n, r) => n + r.recordedAmount, 0),
        unpaidDays: rows.filter(r => r.status === 'unpaid' || r.status === 'part').length,
        balanceAtEnd: last.dueSoFar - last.coveredSoFar,
      };
    });
  }, [st]);

  if (!st) return <div className="loading">Loading daily breakdown…</div>;
  if (!st.days.length) return <p className="empty">Nothing is due yet: {driverName.split(' ')[0]} started on {fmtDate(contract.start_date)} and pays the day after each working day.</p>;

  const isOpen = k => (open === null ? k === months[0].key : open[k]);
  const toggle = k => setOpen(o => ({ ...(o || { [months[0].key]: true }), [k]: !isOpen(k) }));
  const openingBalance = payments.filter(p => p.type === 'adjustment').reduce((n, p) => n + Number(p.amount), 0);

  const downloadCsv = () => {
    const head = ['Date', 'Day', 'Due', 'Recorded for this day', 'MoMo references / reason', 'Status', 'Total due so far', 'Owing so far'];
    const lines = st.days.map(r => [r.date, DAY[dow(r.date)], r.due, r.recordedAmount, r.recs.map(p => p.momo_reference || p.type).join(' ') || (r.off ? `Day off: ${reasonLabel(r.off.reason)}${r.off.note ? ' – ' + r.off.note : ''}` : ''), STATUS[r.status][0], r.dueSoFar, r.dueSoFar - r.coveredSoFar]);
    const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const blob = new Blob([[head, ...lines].map(l => l.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${driverName} – ${contract.reg_number} daily breakdown.csv`;
    a.click();
  };

  return (
    <section className="statement">
      <div className="statement-summary">
        <div><span className="dim">From</span><strong>{fmtDate(contract.start_date)}</strong></div>
        <div><span className="dim">To</span><strong>{fmtDate(st.end)}</strong></div>
        <div><span className="dim">Days due × {money(st.rate)}</span><strong>{money(st.totalDue)}</strong></div>
        <div><span className="dim">Paid</span><strong>{money(st.totalPaid)}</strong></div>
        <div><span className="dim">{st.balance > 0 ? 'Owing' : st.balance < 0 ? 'Paid ahead' : 'Balance'}</span>
          <strong className={st.balance > 0 ? 'txt-bad' : 'txt-ok'}>{st.balance === 0 ? 'Up to date' : money(Math.abs(st.balance))}</strong></div>
        <button type="button" className="btn ghost sm" onClick={downloadCsv}>Download (CSV)</button>
      </div>
      <p className="dim small">
        Each working day ({contract.payment_days === 'every_day' ? 'every day' : 'Monday to Saturday'}) is due at {money(st.rate)}. A payment covers its own day first; anything extra goes to the oldest unpaid days.
        {openingBalance > 0 && <> Includes {money(openingBalance)} paid before FleetPro.</>}
      </p>

      {months.map(m => (
        <div key={m.key} className="statement-month">
          <button type="button" className="statement-month-head" aria-expanded={isOpen(m.key)} onClick={() => toggle(m.key)}>
            <span className="chev" aria-hidden>{isOpen(m.key) ? '▾' : '▸'}</span>
            <strong>{monthName(m.key)}</strong>
            <span className="dim">{m.rows.filter(r => r.due > 0).length} day{m.rows.filter(r => r.due > 0).length === 1 ? '' : 's'} due · {money(m.due)} due · {money(m.recorded)} recorded</span>
            <span className="spacer" />
            {m.unpaidDays > 0 ? <span className="txt-bad small">{m.unpaidDays} day{m.unpaidDays === 1 ? '' : 's'} not fully paid</span> : <span className="txt-ok small">All covered</span>}
            <span className="small">Owing at month end: <strong className={m.balanceAtEnd > 0 ? 'txt-bad' : 'txt-ok'}>{m.balanceAtEnd > 0 ? money(m.balanceAtEnd) : 'nil'}</strong></span>
          </button>
          {isOpen(m.key) && (
            <div className="table-wrap flat">
              <table className="data statement-table">
                <thead><tr><th>Date</th><th className="num">Due</th><th className="num">Recorded for this day</th><th>Reference / reason</th><th>Status</th><th className="num">Due so far</th><th className="num">Owing so far</th>{can('manager') && <th aria-label="Actions" />}</tr></thead>
                <tbody>
                  {m.rows.map(r => {
                    const bal = r.dueSoFar - r.coveredSoFar;
                    return (
                      <tr key={r.date} className={`st-${r.status}`}>
                        <td><span className="dim">{DAY[dow(r.date)]}</span> {fmtDate(r.date)}</td>
                        <td className="num">{r.due ? money(r.due) : <span className="dim">—</span>}</td>
                        <td className="num">{r.recordedAmount ? <strong>{money(r.recordedAmount)}</strong> : <span className="dim">—</span>}</td>
                        <td className="small">
                          {r.recs.length > 0 && <span className="mono">{r.recs.map(p => p.momo_reference || (p.type === 'adjustment' ? 'Paid before FleetPro' : p.type)).join(', ')}</span>}
                          {r.off ? <div><strong>{reasonLabel(r.off.reason)}</strong>{r.off.note && <span className="dim"> · {r.off.note}</span>}</div>
                            : (!r.recs.length && r.excused ? <span className="dim">{r.excused}</span> : null)}
                        </td>
                        <td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                        <td className="num">{money(r.dueSoFar)}</td>
                        <td className="num">{bal > 0 ? <span className="txt-bad">{money(bal)}</span> : <span className="txt-ok">nil</span>}</td>
                        {can('manager') && (
                          <td className="row-actions">
                            {r.off
                              ? <button type="button" className="link-btn" onClick={() => setMarking({ date: r.date, off: r.off })}>Change</button>
                              : r.pay && !r.future && r.recordedAmount < st.rate && !r.recs.some(p => p.type === 'waiver')
                                ? <button type="button" className="link-btn" onClick={() => setMarking({ date: r.date })}>Day off</button>
                                : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      {marking && (
        <DayOffForm contractId={contract.id} date={marking.date} existing={marking.off} driverName={driverName} rate={st.rate}
          onClose={() => setMarking(null)}
          onSaved={msg => { notify(msg); setMarking(null); changed(); }} />
      )}
    </section>
  );
}

/** Mark one pay day as a day off, with a reason; or change / remove an existing one. */
function DayOffForm({ contractId, date, existing, driverName, rate, onClose, onSaved }) {
  const { money } = useApp();
  const [reason, setReason] = useState(existing ? existing.reason : '');
  const [excused, setExcused] = useState(existing ? !!existing.excused : false);
  const [touched, setTouched] = useState(!!existing);
  const [note, setNote] = useState(existing ? existing.note || '' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = r => { setReason(r); if (!touched) setExcused(!!EXCUSED_BY_DEFAULT[r]); };
  const first = driverName.split(' ')[0];

  const save = async e => {
    e.preventDefault();
    if (!reason) { setError('Choose why the driver didn\'t work'); return; }
    setBusy(true); setError('');
    try {
      const body = { contract_id: contractId, date, reason, excused: excused ? 1 : 0, note: note || null };
      if (existing) await api(`/off-days/${existing.id}`, { method: 'PUT', body });
      else await api('/off-days', { method: 'POST', body });
      onSaved(`${fmtDate(date)} marked as ${reasonLabel(reason).toLowerCase()}${excused ? ' (excused)' : ''}`);
    } catch (err) { setError(err.details && Object.values(err.details)[0] ? Object.values(err.details)[0] : err.message); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api(`/off-days/${existing.id}`, { method: 'DELETE' }); onSaved(`${fmtDate(date)} is a normal working day again`); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={`Day off · ${DAY[dow(date)]} ${fmtDate(date)}`} onClose={onClose}>
      <form className="form" onSubmit={save}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <fieldset className="reason-picks">
          <legend>Why didn't {first} work?</legend>
          {OFF_REASONS.map(r => (
            <label key={r} className={`reason-pick ${reason === r ? 'on' : ''}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => pick(r)} />
              {reasonLabel(r)}
            </label>
          ))}
        </fieldset>
        <label className="check excuse">
          <input type="checkbox" checked={excused} onChange={e => { setExcused(e.target.checked); setTouched(true); }} />
          <span><strong>Excuse this day</strong> – {first} doesn't have to pay the {money(rate)} for it.
            <span className="dim"> Leave unticked if it's still owed.</span></span>
        </label>
        <div className="field">
          <label htmlFor="off-note">Note (optional)</label>
          <input id="off-note" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Malaria, clutch repair at Rana Motors" maxLength={500} />
        </div>
        <footer className="form-actions">
          {existing && <button type="button" className="link-btn danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>Remove day off</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </Modal>
  );
}
