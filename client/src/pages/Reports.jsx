import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadCsv } from '../api';
import { useApp } from '../context';
import { PageHead, Plate, daysAgo, human, todayStr } from '../ui';
import { SERIES, monthLabel } from './Dashboard';

const PRESETS = [
  { label: 'Last 30 days', from: () => daysAgo(30) },
  { label: 'Last 90 days', from: () => daysAgo(90) },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01` },
  { label: 'Last 12 months', from: () => daysAgo(365) },
];

export default function Reports() {
  const { money, dist, notify, settings } = useApp();
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  const [tab, setTab] = useState('vehicles');
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [cats, setCats] = useState([]);
  const [sort, setSort] = useState({ key: 'total_cost', dir: -1 });

  useEffect(() => {
    const q = { query: { from, to } };
    Promise.all([api('/reports/vehicles', q), api('/reports/drivers', q), api('/reports/monthly', q), api('/reports/expense-categories', q)])
      .then(([v, d, m, c]) => { setVehicles(v.rows); setDrivers(d.rows); setMonthly(m.rows); setCats(c.rows); })
      .catch(e => notify(e.message, 'bad'));
  }, [from, to, notify]);

  const totals = useMemo(() => {
    const t = vehicles.reduce((a, v) => ({ fuel: a.fuel + v.fuel_cost, maint: a.maint + v.maintenance_cost, other: a.other + v.other_cost, km: a.km + v.distance_km, l: a.l + v.fuel_liters }), { fuel: 0, maint: 0, other: 0, km: 0, l: 0 });
    const total = t.fuel + t.maint + t.other;
    return { ...t, total, perKm: t.km ? total / t.km : null, kmpl: t.l ? t.km / t.l : null };
  }, [vehicles]);

  const sorted = useMemo(() => [...vehicles].sort((a, b) => ((a[sort.key] ?? -Infinity) > (b[sort.key] ?? -Infinity) ? 1 : -1) * sort.dir), [vehicles, sort]);
  const th = (key, label) => (
    <th className="num"><button className="th-sort" onClick={() => setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }))}>{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>
  );
  const catMax = Math.max(1, ...cats.map(c => c.amount));
  const exportCsv = () => downloadCsv(`/reports/${tab}`, { from, to }, `${tab}-report-${from}-to-${to}.csv`).catch(e => notify(e.message, 'bad'));

  return (
    <>
      <PageHead title="Reports" sub="Running costs, efficiency and utilisation for any period.">
        <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
      </PageHead>

      <div className="toolbar">
        {PRESETS.map(p => <button key={p.label} className={`chip ${from === p.from() && to === todayStr() ? 'on' : ''}`} onClick={() => { setFrom(p.from()); setTo(todayStr()); }}>{p.label}</button>)}
        <span className="spacer" />
        <label className="inline-label">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="inline-label">To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Total running cost</span><span className="kpi-value">{money(totals.total)}</span><span className="kpi-note">Fuel {money(totals.fuel)} · Maintenance {money(totals.maint)} · Other {money(totals.other)}</span></div>
        <div className="kpi"><span className="kpi-label">Distance</span><span className="kpi-value">{dist(totals.km)}</span><span className="kpi-note">Across {vehicles.filter(v => v.distance_km > 0).length} vehicles</span></div>
        <div className="kpi"><span className="kpi-label">Cost per {settings.distance_unit}</span><span className="kpi-value">{totals.perKm ? money(totals.perKm) : '—'}</span><span className="kpi-note">All costs divided by distance</span></div>
        <div className="kpi"><span className="kpi-label">Fleet fuel economy</span><span className="kpi-value">{totals.kmpl ? `${totals.kmpl.toFixed(1)} ${settings.distance_unit}/L` : '—'}</span><span className="kpi-note">{Math.round(totals.l).toLocaleString()} litres</span></div>
      </div>

      <div className="dash-grid">
        <section className="panel span-2">
          <header className="panel-head"><h2>Cost by month</h2></header>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#DDE2DE" />
              <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} tickLine={false} axisLine={false} fontSize={12} width={44} />
              <Tooltip formatter={v => money(v)} labelFormatter={monthLabel} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 13 }} />
              {SERIES.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel">
          <header className="panel-head"><h2>Where the money went</h2></header>
          <ul className="mix">
            {cats.map(c => (
              <li key={c.category}>
                <span>{human(c.category.replace('maintenance: ', 'Maint. – '))}</span>
                <span className="mix-bar"><span style={{ width: `${(c.amount / catMax) * 100}%` }} /></span>
                <strong>{money(c.amount)}</strong>
              </li>
            ))}
            {cats.length === 0 && <li className="empty">No costs in this period.</li>}
          </ul>
        </section>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'vehicles'} onClick={() => setTab('vehicles')}>By vehicle</button>
        <button role="tab" aria-selected={tab === 'drivers'} onClick={() => setTab('drivers')}>By driver</button>
      </div>

      <div className="table-wrap">
        {tab === 'vehicles' ? (
          <table className="data">
            <thead><tr>
              <th>Vehicle</th>{th('trips', 'Trips')}{th('distance_km', 'Distance')}{th('fuel_liters', 'Litres')}{th('km_per_liter', `${settings.distance_unit}/L`)}
              {th('fuel_cost', 'Fuel')}{th('maintenance_cost', 'Maintenance')}{th('other_cost', 'Other')}{th('total_cost', 'Total')}{th('cost_per_km', `Per ${settings.distance_unit}`)}{th('downtime_days', 'Days off road')}
            </tr></thead>
            <tbody>
              {sorted.map(v => (
                <tr key={v.vehicle_id}>
                  <td><Plate to={`/vehicles/${v.vehicle_id}`}>{v.reg_number}</Plate> <span className="dim">{v.make} {v.model}</span></td>
                  <td className="num">{v.trips}</td>
                  <td className="num">{dist(v.distance_km)}</td>
                  <td className="num">{v.fuel_liters.toFixed(1)}</td>
                  <td className="num">{v.km_per_liter ?? '—'}</td>
                  <td className="num">{money(v.fuel_cost)}</td>
                  <td className="num">{money(v.maintenance_cost)}</td>
                  <td className="num">{money(v.other_cost)}</td>
                  <td className="num"><strong>{money(v.total_cost)}</strong></td>
                  <td className="num">{v.cost_per_km != null ? money(v.cost_per_km) : '—'}</td>
                  <td className="num">{v.downtime_days || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="data">
            <thead><tr><th>Driver</th><th className="num">Trips</th><th className="num">Distance</th><th className="num">Fuel bought</th><th className="num">Litres</th></tr></thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.driver_id}>
                  <td><strong>{d.name}</strong></td>
                  <td className="num">{d.trips}</td>
                  <td className="num">{dist(d.distance_km)}</td>
                  <td className="num">{money(d.fuel_cost)}</td>
                  <td className="num">{d.fuel_liters.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="footnote">Distance uses completed trips, or the spread of odometer readings in the period when that is larger. Only completed work orders count toward maintenance cost.</p>
    </>
  );
}
