import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Badge, PageHead, Plate, daysAgo, fmtDate, human, useOptions } from '../ui';

const PERIODS = [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']];

function toCsv(rows) {
  const cols = ['manager_name', 'driver_name', 'driver_phone', 'reg_number', 'car', 'contract_type', 'daily_rate', 'days_due', 'expected', 'paid', 'waived', 'shortfall',
    'momo_references', 'arrears_total', 'days_behind', 'remaining_balance', 'progress', 'last_payment_on', 'vehicle_status', 'odometer', 'service_due', 'documents_due',
    'last_checkin_on', 'car_condition', 'intention', 'complaint', 'complaint_status'];
  const esc = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

export default function ManagerReport() {
  const { user, money, notify } = useApp();
  const managers = useOptions('manager');
  const [period, setPeriod] = useState('day');
  const [date, setDate] = useState(daysAgo(1));
  const [managerId, setManagerId] = useState(user.role === 'manager' ? String(user.id) : 'all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api('/reports/manager', { query: { period, date, manager_id: managerId } })
      .then(setData).catch(e => notify(e.message, 'bad')).finally(() => setLoading(false));
  }, [period, date, managerId, notify]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(data.rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${period}-report-${data.from}${data.manager_name ? '-' + data.manager_name.replace(/\s+/g, '-') : ''}.csv`;
    a.click();
  };

  const s = data?.summary;
  const periodText = !data ? '' : data.from === data.to
    ? `Payments for work on ${fmtDate(data.from)}`
    : `${fmtDate(data.from)} to ${fmtDate(data.to)}${data.to > data.due_through ? ` · payments counted up to work on ${fmtDate(data.due_through)}` : ''}`;

  return (
    <>
      <PageHead title="Manager reports" sub="Payments, balances, car condition, servicing and driver feedback for each manager's drivers.">
        <button className="btn ghost" onClick={() => window.print()} disabled={!data}>Print</button>
        <button className="btn ghost" onClick={exportCsv} disabled={!data}>Export CSV</button>
      </PageHead>

      <div className="toolbar no-print">
        <div className="segmented" role="tablist">
          {PERIODS.map(([k, l]) => <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}>{l}</button>)}
        </div>
        <label className="inline-label">{period === 'day' ? 'Work date' : 'Any date in the ' + period}
          <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="inline-label">Manager
          <select value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="all">All managers</option>
            {managers.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
      </div>

      {!data ? <div className="loading">Building report…</div> : (
        <div className={loading ? 'is-loading' : ''}>
          <div className="report-title">
            <h2>{PERIODS.find(p => p[0] === period)[1]} report · {data.manager_name || 'All managers'}</h2>
            <p className="dim">{periodText}</p>
          </div>

          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Collected</span>
              <span className="kpi-value">{money(s.collected)}</span>
              <span className="kpi-note">of {money(s.expected)} expected{s.collection_rate != null && <> · <span className={s.collection_rate >= 95 ? 'txt-ok' : s.collection_rate >= 80 ? 'txt-warn' : 'txt-bad'}>{s.collection_rate}%</span></>}{s.waived ? ` · ${money(s.waived)} excused` : ''}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Total owing (all time)</span>
              <span className="kpi-value">{money(s.arrears_total)}</span>
              <span className="kpi-note">{s.drivers_in_arrears} of {s.drivers} drivers behind</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Driver feedback</span>
              <span className="kpi-value">{s.wants_to_stop}</span>
              <span className="kpi-note">want to stop · {s.open_complaints} open complaint{s.open_complaints === 1 ? '' : 's'}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Cars</span>
              <span className="kpi-value">{s.service_due}</span>
              <span className="kpi-note">due for service · {s.off_road} off the road</span>
            </div>
          </div>

          {managerId === 'all' && data.by_manager.length > 1 && (
            <section className="panel" style={{ marginBottom: 16 }}>
              <header className="panel-head"><h2>By manager</h2></header>
              <div className="table-wrap flat">
                <table className="data">
                  <thead><tr><th>Manager</th><th className="num">Drivers</th><th className="num">Expected</th><th className="num">Collected</th><th className="num">Rate</th><th className="num">Total owing</th><th className="num">Behind</th><th className="num">Want to stop</th><th className="num">Complaints</th></tr></thead>
                  <tbody>
                    {data.by_manager.map(m => (
                      <tr key={m.manager_id || 0} className={m.manager_id ? 'clickable' : ''} onClick={() => m.manager_id && setManagerId(String(m.manager_id))}>
                        <td><strong>{m.manager_name}</strong></td>
                        <td className="num">{m.drivers}</td>
                        <td className="num">{money(m.expected)}</td>
                        <td className="num">{money(m.collected)}</td>
                        <td className="num">{m.collection_rate != null ? `${m.collection_rate}%` : '—'}</td>
                        <td className="num">{money(m.arrears_total)}</td>
                        <td className="num">{m.drivers_in_arrears}</td>
                        <td className="num">{m.wants_to_stop}</td>
                        <td className="num">{m.open_complaints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="table-wrap">
            <table className="data report">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Car</th>
                  <th className="num">Paid / due</th>
                  <th className="num">Short</th>
                  <th className="num">Total owing</th>
                  <th className="num">Car balance</th>
                  <th>Car status &amp; service</th>
                  <th>Driver feedback</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.contract_id} className={r.shortfall > 0 ? 'row-short' : ''}>
                    <td>
                      <Link to={`/drivers/${r.driver_id}`} className="strong-link">{r.driver_name}</Link>
                      <div className="dim">{r.driver_phone || ''}{managerId === 'all' && r.manager_name ? ` · ${r.manager_name}` : ''}</div>
                      {r.contract_status !== 'active' && <Badge value={r.contract_status} />}
                    </td>
                    <td><Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate><div className="dim">{r.car}</div><div className="dim">{r.contract_type === 'work_and_pay' ? 'Work & pay' : 'Daily hire'} · {money(r.daily_rate)}</div></td>
                    <td className="num">
                      <strong>{money(r.paid)}</strong> <span className="dim">/ {r.days_due ? money(r.expected) : 'not due'}</span>
                      {period !== 'day' && r.days_due > 0 && <div className="dim">{r.days_due} work days</div>}
                      {r.waived > 0 && <div className="dim">+{money(r.waived)} excused</div>}
                      {period === 'day' && r.momo_references && <div className="mono dim">{r.momo_references}</div>}
                    </td>
                    <td className="num">{r.shortfall > 0 ? <span className="txt-bad">{money(r.shortfall)}</span> : r.shortfall < 0 ? <span className="txt-ok">+{money(-r.shortfall)}</span> : <span className="txt-ok">✓</span>}</td>
                    <td className="num">{r.arrears_total > 0 ? <span className={r.days_behind >= 3 ? 'txt-bad' : 'txt-warn'}>{money(r.arrears_total)}<div className="dim">{r.days_behind} day{r.days_behind == 1 ? '' : 's'}</div></span> : <span className="txt-ok">{r.arrears_total < 0 ? `${money(-r.arrears_total)} ahead` : 'Up to date'}</span>}</td>
                    <td className="num">{r.remaining_balance == null ? <span className="dim">Daily hire</span> : <>{money(r.remaining_balance)}<div className="dim">{r.progress}% paid</div></>}</td>
                    <td className="wrap">
                      {r.car_condition ? <Badge value={r.car_condition} /> : <Badge value={r.vehicle_status} />}
                      {r.service_due && <div className="txt-warn small">{r.service_due}</div>}
                      {r.documents_due && <div className="txt-bad small">{r.documents_due}</div>}
                    </td>
                    <td className="wrap">
                      {r.intention ? <Badge value={r.intention} /> : <span className="dim">No check-in yet</span>}
                      {r.complaint && <div className={`small ${r.complaint_status === 'open' ? 'txt-warn' : 'dim'}`}>{r.complaint}{r.complaint_status === 'resolved' ? ' (resolved)' : ''}</div>}
                      {r.last_checkin_on && <div className="dim">Checked {fmtDate(r.last_checkin_on)}</div>}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={99} className="empty">No drivers with contracts in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          {data.idle_cars?.length > 0 && (
            <section className="panel idle-cars">
              <header className="panel-head"><h2>Cars without a driver ({data.idle_cars.length})</h2></header>
              <ul className="plain-list">
                {data.idle_cars.map(c => (
                  <li key={c.vehicle_id}>
                    <Plate to={`/vehicles/${c.vehicle_id}`}>{c.reg_number}</Plate>
                    <div>{c.make} {c.model} <Badge value={c.status} />{managerId === 'all' && c.manager_name ? <span className="dim"> · {c.manager_name}</span> : ''}
                      {c.service_due && <div className="txt-warn small">{c.service_due}</div>}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="footnote">
            Drivers pay the day after they work, so "Expected" only counts work days up to {fmtDate(data.due_through)}. Pay days are {human('mon_sat')} unless a contract says otherwise.
            "Short" is for this {period === 'day' ? 'day' : period}; "Total owing" is everything outstanding since the contract started.
            Record a <Link to="/checkins">driver check-in</Link> to update car condition and feedback.
          </p>
        </div>
      )}
    </>
  );
}
