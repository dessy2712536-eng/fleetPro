import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, fmtDate } from '../ui';
import { REASONS, excusedByDefault, reasonLabel } from '../reasons';

import { DAY, buildStatement, dow, dueThroughNow, monthName } from '../statement.js';

export { buildStatement };

const STATUS = {
  paid: ['Paid', 'tone-ok'], part: ['Part paid', 'tone-warn'], unpaid: ['Not paid', 'tone-bad'],
  excused: ['Excused', 'tone-muted'], not_due: ['Not due yet', 'tone-muted'],
  due_tonight: ['Due by 9pm today', 'tone-muted'], part_tonight: ['Part paid · rest due by 9pm', 'tone-warn'], off_owed: ['Day off – still owed', 'tone-warn'],
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
  const st = useMemo(() => (payments ? buildStatement(contract, payments, today, offDays, dueThroughNow()) : null), [payments, offDays, contract, today]);
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
  const { money, can } = useApp();
  const [reason, setReason] = useState(existing ? existing.reason : '');
  const [excused, setExcused] = useState(existing ? !!existing.excused : false);
  const [touched, setTouched] = useState(!!existing);
  const [note, setNote] = useState(existing ? existing.note || '' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = r => { setReason(r); if (!touched) setExcused(excusedByDefault(r)); };
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
          {(REASONS.some(r => r.key === reason) || !reason ? REASONS : [...REASONS, { key: reason, label: reasonLabel(reason) }]).map(({ key: r, label, dept }) => (
            <label key={r} className={`reason-pick ${reason === r ? 'on' : ''}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => pick(r)} />
              {label}{dept && dept !== 'DRIVER' && <span className="dim"> · {dept === 'AUTO WORKSHOP' ? 'workshop' : 'admin'}</span>}
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
          {existing && can('admin') && <button type="button" className="link-btn danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}>Remove day off</button>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </Modal>
  );
}
