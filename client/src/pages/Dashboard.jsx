import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useApp } from '../context';
import { PageHead, Plate, fmtDate, fmtDateTime, useOptions } from '../ui';

export const SERIES = [
  { key: 'fuel', label: 'Fuel', color: '#2F6690' },
  { key: 'maintenance', label: 'Maintenance', color: '#E0A800' },
  { key: 'other', label: 'Other', color: '#9AA8B1' },
];
export const monthLabel = m => new Date(m + '-01T00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const dayLabel = d => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
const kfmt = v => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v);

export default function Dashboard() {
  const { money, user } = useApp();
  const managers = useOptions('manager');
  const [managerId, setManagerId] = useState(user.role === 'manager' ? String(user.id) : 'all');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/dashboard', { query: { manager_id: managerId } }).then(setD).catch(e => setErr(e.message)); }, [managerId]);

  if (err) return <div className="form-error">{err}</div>;
  if (!d) return <div className="loading">Loading overview…</div>;

  const c = d.collections;
  const y = c.yesterday;
  const yRate = y.expected ? Math.round((y.collected / y.expected) * 100) : null;
  const scope = managerId === 'all' ? 'all drivers' : managerId === String(user.id) ? 'your drivers' : (managers.find(m => String(m.value) === managerId) || {}).label;

  return (
    <>
      <PageHead title="Overview" sub={`${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${scope}`}>
        <select value={managerId} onChange={e => setManagerId(e.target.value)} aria-label="Manager">
          <option value="all">All managers</option>
          {managers.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </PageHead>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Paid for yesterday's work</span>
          <span className="kpi-value">{money(y.collected)}</span>
          <span className="kpi-note">of {money(y.expected)} due{yRate != null && <> · <span className={yRate >= 95 ? 'txt-ok' : 'txt-bad'}>{yRate}%</span></>} · {y.unpaid.length} not paid yet</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Received today</span>
          <span className="kpi-value">{money(c.collected_today)}</span>
          <span className="kpi-note">{money(c.month_collected)} this month</span>
        </div>
        <Link to="/drivers" className={`kpi kpi-alert ${c.drivers_in_arrears ? 'has-overdue' : ''}`}>
          <span className="kpi-label">Total owing</span>
          <span className="kpi-value">{money(c.arrears_total)}</span>
          <span className="kpi-note">{c.drivers_in_arrears} driver{c.drivers_in_arrears === 1 ? '' : 's'} behind on payments</span>
        </Link>
        <Link to="/alerts" className="kpi">
          <span className="kpi-label">Needs attention</span>
          <span className="kpi-value">{d.alert_counts.overdue + d.alert_counts.urgent}</span>
          <span className="kpi-note">{c.wants_to_stop} want to stop · {c.open_complaints} open complaints</span>
        </Link>
      </div>

      <div className="dash-grid">
        <section className="panel span-2">
          <header className="panel-head"><h2>Daily collections, last 14 days</h2><Link to="/reports/manager">Manager reports</Link></header>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={c.daily} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#DDE2DE" />
              <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} fontSize={12} interval={0} angle={-30} textAnchor="end" height={44} />
              <YAxis tickFormatter={kfmt} tickLine={false} axisLine={false} fontSize={12} width={44} />
              <Tooltip formatter={v => money(v)} labelFormatter={d => `Work on ${fmtDate(d)}`} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="expected" name="Due" fill="#C9D0CB" />
              <Bar dataKey="collected" name="Paid" fill="#1E7F5C" />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Not paid for {fmtDate(y.date)}</h2><Link to="/payments">Record payment</Link></header>
          {y.unpaid.length === 0 ? <p className="empty">Everyone has paid for yesterday.</p> : (
            <ul className="plain-list">
              {y.unpaid.map(u => (
                <li key={u.driver_id}>
                  <Plate>{u.reg_number}</Plate>
                  <div><Link to={`/drivers/${u.driver_id}`} className="strong-link">{u.driver_name}</Link><div className="dim">{money(u.daily_rate)} due</div></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Most behind</h2><Link to="/drivers">Drivers</Link></header>
          {c.top_arrears.length === 0 ? <p className="empty">No driver owes money.</p> : (
            <table className="data mini">
              <tbody>
                {c.top_arrears.map(a => (
                  <tr key={a.driver_id}>
                    <td><Link to={`/drivers/${a.driver_id}`} className="strong-link">{a.driver_name}</Link><div className="dim">{a.reg_number} · last paid {a.last_payment_on ? fmtDate(a.last_payment_on) : 'never'}</div></td>
                    <td className="num"><strong className={a.days_behind >= 3 ? 'txt-bad' : 'txt-warn'}>{money(a.arrears)}</strong><div className="dim">{a.days_behind} days</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Alerts</h2><Link to="/alerts">See all {d.alert_counts.total}</Link></header>
          {d.alerts.length === 0 ? <p className="empty">Nothing needs attention.</p> : (
            <ul className="alert-list compact">
              {d.alerts.map((a, i) => (
                <li key={i} className={`sev-${a.severity}`}>
                  <Link to={a.link}><strong>{a.title}</strong><span>{a.detail}</span></Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Fleet</h2><Link to="/contracts">Contracts</Link></header>
          <dl className="facts-inline stacked">
            <div><dt>Work & pay drivers</dt><dd>{c.work_and_pay}</dd></div>
            <div><dt>Daily hire (EV)</dt><dd>{c.daily_hire}</dd></div>
            <div><dt>Cars in workshop</dt><dd>{d.fleet.in_maintenance || 0}</dd></div>
            <div><dt>Deposits held</dt><dd>{money(c.deposits_held)}</dd></div>
          </dl>
          <h3 className="mini-head">Cars waiting for a driver</h3>
          {d.available_cars.length === 0 ? <p className="dim">None — every active car has a driver.</p> : (
            <ul className="plain-list">
              {d.available_cars.map(v => <li key={v.id}><Plate to={`/vehicles/${v.id}`}>{v.reg_number}</Plate><span>{v.make} {v.model} <span className="dim">· retrieved car, 5,000+ deposit</span></span></li>)}
            </ul>
          )}
        </section>

        <section className="panel span-2">
          <header className="panel-head"><h2>Company running costs, last 12 months</h2><Link to="/reports">Cost reports</Link></header>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#DDE2DE" />
              <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={kfmt} tickLine={false} axisLine={false} fontSize={12} width={44} />
              <Tooltip formatter={v => money(v)} labelFormatter={monthLabel} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
              {SERIES.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="panel">
          <header className="panel-head"><h2>Recent changes</h2></header>
          {d.activity.length === 0 ? <p className="empty">Changes made by your team will show here.</p> : (
            <ul className="activity narrow">
              {d.activity.map(a => (
                <li key={a.id}>
                  <span><strong>{a.user_name || 'System'}</strong> {a.action}d {a.entity.toLowerCase()} {a.summary && <span className="dim">{a.summary}</span>}</span>
                  <span className="dim when">{fmtDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

