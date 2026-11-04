import { useCallback, useEffect, useState } from 'react';
import DailyStatement from './DailyStatement';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Badge, ExpiryCell, Modal, Plate, RecordForm, ResourceTable, daysAgo, fmtDate, human, invalidateOptions, todayStr } from '../ui';
import { Owing, saveContract, carDefaults, carFields, giveCar, checkinsCfg, contractsCfg, driversCfg, expensesCfg, fuelCfg, paymentsCfg, recordsCfg, schedulesCfg, tripsCfg, vehiclesCfg } from '../resources';

function useRecord(path) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(path).then(setRow).catch(e => setError(e.message)), [path]);
  useEffect(() => { load(); }, [load]);
  return { row, error, load };
}


/**
 * Money paid under each contract: on a car page, one row per driver who has had the car;
 * on a driver page, one row per car the driver has had.
 */
function PaidByContract({ query, mode, reloadKey }) {
  const { money } = useApp();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api('/contracts', { query: { ...query, limit: 500, sort: 'start_date', dir: 'desc' } }).then(r => setRows(r.rows)).catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadKey]);
  if (!rows) return null;
  const total = rows.reduce((n, c) => n + (Number(c.paid_total) || 0), 0);
  const last = rows.map(c => c.last_payment_on).filter(Boolean).sort().slice(-1)[0];
  if (mode === 'driver' && rows.length < 2) return null; // the driver's single car is already shown above
  return (
    <section className="panel paid-panel">
      <header className="panel-head">
        <h2>{mode === 'car' ? 'Payments made on this car' : 'Paid on each car'}</h2>
        {rows.length > 0 && <span className="paid-total">{money(total)} <span className="dim">in total{last ? ` · last paid ${fmtDate(last)}` : ''}</span></span>}
      </header>
      {rows.length === 0 ? <p className="empty">{mode === 'car' ? 'No driver has had this car yet, so nothing has been paid on it.' : 'No payments yet.'}</p> : (
        <div className="table-wrap flat">
          <table className="data">
            <thead><tr>
              <th>{mode === 'car' ? 'Driver' : 'Car'}</th><th>Arrangement</th><th>Period</th>
              <th className="num">Paid</th><th className="num">Car price</th><th className="num">Left to pay</th><th className="num">Owing now</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>{mode === 'car' ? <Link to={`/drivers/${c.driver_id}`} className="strong-link">{c.driver_name}</Link> : <Plate to={`/vehicles/${c.vehicle_id}`}>{c.reg_number}</Plate>}</td>
                  <td>{human(c.type)}<div className="dim">{money(c.daily_rate)}/day</div></td>
                  <td>{fmtDate(c.start_date)}<div className="dim">{c.ended_on ? `to ${fmtDate(c.ended_on)}` : 'to now'}</div></td>
                  <td className="num"><strong>{money(c.paid_total)}</strong>{c.last_payment_on && <div className="dim">last {fmtDate(c.last_payment_on)}</div>}</td>
                  <td className="num">{c.contract_value != null ? money(c.contract_value) : <span className="dim">—</span>}</td>
                  <td className="num">{c.remaining_balance != null && c.status === 'active' ? <>{money(c.remaining_balance)}<div className="dim">{c.progress}% paid</div></> : c.status === 'completed' ? <span className="txt-ok">Paid off</span> : <span className="dim">—</span>}</td>
                  <td className="num">{c.status === 'active' ? <Owing r={c} money={money} /> : c.arrears > 0 ? <span className="txt-bad">{money(c.arrears)}</span> : <span className="dim">—</span>}</td>
                  <td><Badge value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function VehicleDetail() {
  const { id } = useParams();
  const app = useApp();
  const { money, dist, can, notify, settings } = app;
  const navigate = useNavigate();
  const { row: v, error, load } = useRecord(`/vehicles/${id}`);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('contracts');
  const [editing, setEditing] = useState(false);
  const [giving, setGiving] = useState(false);
  const [activeContract, setActiveContract] = useState(undefined); // undefined = not loaded yet

  const loadSummary = useCallback(() => api(`/vehicles/${id}/summary`).then(setSummary).catch(() => {}), [id]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => {
    api('/contracts', { query: { vehicle_id: id, status: 'active', limit: 1 } })
      .then(r => setActiveContract(r.rows[0] || null)).catch(() => setActiveContract(undefined));
  }, [id, summary]);
  const refresh = () => { load(); loadSummary(); };

  if (error) return <div className="form-error">{error} <Link to="/vehicles">Back to cars</Link></div>;
  if (!v) return <div className="loading">Loading…</div>;

  const cfg = vehiclesCfg(app);
  const s90 = summary?.last_90_days;
  const all = summary?.all_time;
  const tabs = {
    contracts: ['Drivers & contracts', contractsCfg(app)],
    payments: ['Payments', paymentsCfg(app)],
    trips: ['Trips', tripsCfg(app)],
    fuel: ['Fuel', fuelCfg(app)],
    maintenance: ['Work orders', recordsCfg(app)],
    schedules: ['Service schedules', schedulesCfg(app)],
    expenses: ['Expenses', expensesCfg(app)],
  };

  const save = async form => {
    await api(`/vehicles/${id}`, { method: 'PUT', body: form });
    notify('Car updated'); setEditing(false); invalidateOptions(); refresh();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${v.reg_number} and all its trips, fuel, maintenance and expense records? Consider marking it "Disposed" instead to keep its history.`)) return;
    await api(`/vehicles/${id}`, { method: 'DELETE' });
    notify('Car deleted'); invalidateOptions(); navigate('/vehicles');
  };

  return (
    <>
      <div className="detail-head">
        <Link to="/vehicles" className="back">Cars</Link>
        <div className="detail-title">
          <Plate>{v.reg_number}</Plate>
          <div>
            <h1>{v.make} {v.model}</h1>
            <p className="sub">{[v.year, human(v.type), human(v.fuel_type), v.color].filter(Boolean).join(' · ')}</p>
          </div>
          <Badge value={v.status} />
          {v.condition && <span title={v.condition === 'new' ? 'Never given to a second driver' : 'Has had a driver before: the next driver gets it as a retrieved car'}><Badge value={v.condition} /></span>}
          <span className="spacer" />
          {can('manager') && (!v.assigned_driver_id || activeContract === null) && ['active', 'inactive', 'in_maintenance'].includes(v.status) && (
            <button className="btn primary" onClick={() => setGiving(true)} disabled={!v.manager_id} title={v.manager_id ? '' : 'Assign a manager first'}>Assign driver</button>
          )}
          {can('manager') && <button className="btn ghost" onClick={() => setEditing(true)}>Edit car</button>}
        </div>
      </div>
      {v.assigned_driver_id && activeContract === null && (
        <div className="notice warn">
          <span><strong>{v.driver_name || 'A driver'} is down as driving this car, but there's no contract yet</strong>, so payments can't be recorded and the car doesn't show on the driver's page.</span>
          {can('manager') && <button className="btn primary sm" onClick={() => setGiving(true)}>Set up contract</button>}
        </div>
      )}
      {!v.manager_id && <div className="notice warn"><span><strong>This car has no manager.</strong> Edit the car to choose one before giving it to a driver.</span></div>}

      {summary?.alerts?.length > 0 && (
        <ul className="alert-list inline">
          {summary.alerts.map((a, i) => <li key={i} className={`sev-${a.severity}`}><strong>{a.title.split(' – ')[0]}</strong><span>{a.detail}</span></li>)}
        </ul>
      )}

      <div className="facts">
        <dl>
          <div><dt>Manager</dt><dd>{v.manager_name || <span className="txt-bad">No manager</span>}</dd></div>
          <div><dt>Odometer</dt><dd>{dist(v.current_odometer)}</dd></div>
          <div><dt>Driver</dt><dd>{v.assigned_driver_id ? <Link to={`/drivers/${v.assigned_driver_id}`}>{v.driver_name}</Link> : 'Unassigned'}</dd></div>
          <div><dt>Insurance</dt><dd><ExpiryCell date={v.insurance_expiry} /></dd></div>
          <div><dt>Roadworthy</dt><dd><ExpiryCell date={v.roadworthy_expiry} /></dd></div>
          <div><dt>Registration</dt><dd><ExpiryCell date={v.registration_expiry} /></dd></div>
          <div><dt>VIN</dt><dd>{v.vin || '—'}</dd></div>
          <div><dt>Purchased</dt><dd>{fmtDate(v.purchase_date)}{v.purchase_price ? ` for ${money(v.purchase_price)}` : ''}</dd></div>
        </dl>
        <dl className="facts-costs">
          <div><dt>Cost, last 90 days</dt><dd>{money(s90?.total_cost)}</dd></div>
          <div><dt>Cost per {settings.distance_unit}</dt><dd>{s90?.cost_per_km != null ? money(s90.cost_per_km) : '—'}</dd></div>
          <div><dt>Fuel economy</dt><dd>{s90?.km_per_liter != null ? `${s90.km_per_liter} ${settings.distance_unit}/L` : '—'}</dd></div>
          <div><dt>Lifetime running cost</dt><dd>{money(all?.total_cost)}</dd></div>
        </dl>
      </div>
      {v.notes && <p className="notes">{v.notes}</p>}
      <PaidByContract query={{ vehicle_id: Number(id) }} mode="car" reloadKey={summary} />

      <div className="tabs" role="tablist">
        {Object.entries(tabs).map(([k, [label]]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <ResourceTable key={tab} cfg={tabs[tab][1]} fixed={{ vehicle_id: Number(id) }} embedded onChanged={refresh} />

      {giving && (() => {
        const cc = contractsCfg(app);
        const fields = cc.fields.filter(f => f.name !== 'vehicle_id').map(f => f.name === 'driver_id' ? { ...f, onlyManager: v.manager_id, onlyFree: true, hint: `Active drivers in ${v.manager_name || 'this car\'s manager'}'s group who don't have a car` } : f);
        return (
          <Modal title={`Assign a driver to ${v.reg_number}`} onClose={() => setGiving(false)} wide>
            <RecordForm fields={fields}
              initial={{ ...cc.defaults(), vehicle_id: v.id, driver_id: activeContract === null ? v.assigned_driver_id : null, type: /cerio|cireo|byd/i.test(v.make) ? 'daily_hire' : 'work_and_pay' }}
              onSubmit={async f => {
                await saveContract({ ...f, vehicle_id: v.id }, null);
                notify(`${v.reg_number} assigned`); setGiving(false); invalidateOptions(); refresh(); setTab('contracts');
              }}
              onCancel={() => setGiving(false)} submitLabel="Start contract" />
          </Modal>
        );
      })()}
      {editing && (
        <Modal title={`Edit ${v.reg_number}`} onClose={() => setEditing(false)} wide>
          <RecordForm fields={cfg.fields} initial={Object.fromEntries(cfg.fields.map(f => [f.name, v[f.name]]))} onSubmit={save} onCancel={() => setEditing(false)} submitLabel="Save changes" />
          {app.can('admin') && <div className="danger-zone"><button className="link-btn danger" onClick={remove}>Delete this vehicle</button></div>}
        </Modal>
      )}
    </>
  );
}

export function DriverDetail() {
  const { id } = useParams();
  const app = useApp();
  const { can, notify, money } = app;
  const navigate = useNavigate();
  const { row: d, error, load } = useRecord(`/drivers/${id}`);
  const [contract, setContract] = useState(null);
  const [tab, setTab] = useState('statement');
  const [editing, setEditing] = useState(false);
  const [quick, setQuick] = useState(null); // 'payment' | 'checkin'
  const [looseCar, setLooseCar] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!d) return;
    if (d.contract_id) api(`/contracts/${d.contract_id}`).then(setContract).catch(() => {});
    else setContract(null);
    // A car may be marked for this driver directly on the car, without a contract yet.
    if (!d.contract_id) api('/vehicles', { query: { driver_id: d.id, limit: 1 } }).then(r => setLooseCar(r.rows[0] || null)).catch(() => {});
    else setLooseCar(null);
  }, [d]);
  const refresh = () => { load(); setVersion(v => v + 1); };

  if (error) return <div className="form-error">{error} <Link to="/drivers">Back to drivers</Link></div>;
  if (!d) return <div className="loading">Loading…</div>;
  const cfg = driversCfg(app);
  const payCfg = paymentsCfg(app);
  const ciCfg = checkinsCfg(app);

  const save = async form => {
    const message = await cfg.save(form, { id: Number(id) });
    notify(message || 'Driver updated'); setEditing(false); invalidateOptions(); refresh();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${d.name}?`)) return;
    try { await api(`/drivers/${id}`, { method: 'DELETE' }); notify('Driver deleted'); invalidateOptions(); navigate('/drivers'); }
    catch (e) { notify(e.message, 'bad'); }
  };
  const quickSave = async form => {
    const path = quick === 'payment' ? '/payments' : '/checkins';
    await api(path, { method: 'POST', body: form });
    notify(quick === 'payment' ? 'Payment recorded' : 'Check-in saved');
    setQuick(null); invalidateOptions(); refresh();
  };

  return (
    <>
      <div className="detail-head">
        <Link to="/drivers" className="back">Drivers</Link>
        <div className="detail-title">
          <div className="avatar" aria-hidden>{d.name.split(' ').map(p => p[0]).slice(0, 2).join('')}</div>
          <div><h1>{d.name}</h1><p className="sub">{[d.phone, d.manager_name ? `Manager: ${d.manager_name}` : 'No manager'].filter(Boolean).join(' · ')}</p></div>
          <Badge value={d.status} />
          {d.intention && <Badge value={d.intention} />}
          <span className="spacer" />
          {can('manager') && contract && contract.status === 'active' && <button className="btn primary" onClick={() => setQuick('payment')}>Record payment</button>}
          {can('manager') && !d.contract_id && d.status !== 'stopped' && <button className="btn primary" onClick={() => setQuick('car')}>Assign car</button>}
          {can('manager') && <button className="btn ghost" onClick={() => setQuick('checkin')}>Add check-in</button>}
          {can('manager') && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
        </div>
      </div>

      {contract ? (
        <div className="facts">
          <dl>
            <div><dt>Car</dt><dd><Plate to={`/vehicles/${contract.vehicle_id}`}>{contract.reg_number}</Plate> <span className="dim">{contract.make} {contract.model}</span></dd></div>
            <div><dt>Arrangement</dt><dd>{human(contract.type)} · {money(contract.daily_rate)}/day <span className="dim">({human(contract.payment_days)})</span></dd></div>
            <div><dt>Started</dt><dd>{fmtDate(contract.start_date)}{contract.car_condition ? <span className="dim"> · {contract.car_condition} car</span> : ''}</dd></div>
            <div><dt>Ends</dt><dd>{contract.end_date ? fmtDate(contract.end_date) : 'Ongoing'}</dd></div>
            <div><dt>Deposit</dt><dd>{contract.deposit_amount ? <>{money(contract.deposit_amount)} <span className="dim mono">{contract.deposit_reference}</span></> : 'Not paid'}{contract.deposit_owed > 0 && <div className="txt-warn small">{money(contract.deposit_owed)} still owed</div>}</dd></div>
            <div><dt>MoMo number</dt><dd>{d.momo_number || '—'}</dd></div>
            <div><dt>Ghana Card</dt><dd>{d.id_number || '—'}</dd></div>
            <div><dt>Last paid</dt><dd>{contract.last_payment_on ? fmtDate(contract.last_payment_on) : 'No payments yet'}</dd></div>
            <div><dt>Licence expires</dt><dd><ExpiryCell date={d.license_expiry} /></dd></div>
          </dl>
          <dl className="facts-costs">
            <div><dt>Total paid on {contract.reg_number}</dt><dd>{money(contract.paid_total)}<small>{contract.last_payment_on ? `Last paid ${fmtDate(contract.last_payment_on)}` : 'No payments yet'}</small></dd></div>
            {contract.contract_value != null && <div><dt>Car price</dt><dd>{money(contract.contract_value)}</dd></div>}
            {contract.remaining_balance != null && <div><dt>Left to pay for the car</dt><dd>{money(contract.remaining_balance)}<div className="progress dark"><span style={{ width: `${contract.progress}%` }} /></div><small>{contract.progress}% paid</small></dd></div>}
            <div><dt>Owing now</dt><dd><Owing r={contract} money={money} /></dd></div>
          </dl>
        </div>
      ) : (
        looseCar ? (
          <div className="notice warn">
            <span><strong>{d.name.split(' ')[0]} is down as driving <Plate to={`/vehicles/${looseCar.id}`}>{looseCar.reg_number}</Plate>, but there's no contract yet</strong>, so payments can't be recorded.</span>
            {can('manager') && <button className="btn primary sm" onClick={() => setQuick('car')}>Set up contract</button>}
          </div>
        ) : (
          <div className="notes">{d.name.split(' ')[0]} doesn't have a car yet{d.arrangement ? ` (${human(d.arrangement).toLowerCase()})` : ''}.{can('manager') && d.status !== 'stopped' && <> <button className="link-btn" onClick={() => setQuick('car')}>Assign a car</button></>}</div>
        )
      )}
      {d.notes && <p className="notes">{d.notes}</p>}
      <PaidByContract query={{ driver_id: Number(id) }} mode="driver" reloadKey={version} />

      <div className="tabs" role="tablist">
        {[...(contract ? [['statement', 'Daily breakdown']] : []), ['payments', 'Payments'], ['checkins', 'Check-ins'], ['contracts', 'Contracts'], ['trips', 'Trips']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'statement' && contract ? <DailyStatement contract={contract} driverName={d.name} reloadKey={version} onChanged={() => load()} /> : (
        <ResourceTable key={tab + version}
          cfg={{ payments: payCfg, checkins: ciCfg, contracts: contractsCfg(app), trips: tripsCfg(app) }[tab === 'statement' ? 'payments' : tab]}
          fixed={{ driver_id: Number(id) }} embedded onChanged={refresh} />
      )}

      {editing && (
        <Modal title={`Edit ${d.name}`} onClose={() => setEditing(false)} wide>
          <RecordForm fields={cfg.fields} initial={{ ...Object.fromEntries(cfg.fields.map(f => [f.name, d[f.name]])), ...cfg.editExtras(d) }} onSubmit={save} onCancel={() => setEditing(false)} submitLabel="Save changes" />
          {app.can('admin') && <div className="danger-zone"><button className="link-btn danger" onClick={remove}>Delete this driver</button></div>}
        </Modal>
      )}
      {quick === 'car' && (
        <Modal title={looseCar ? `Set up contract · ${d.name}` : `Assign a car to ${d.name}`} onClose={() => setQuick(null)} wide>
          <RecordForm
            fields={carFields({ withHeading: false }).map(f => f.name === 'car_id' ? { ...f, ...(d.arrangement ? { derive: () => ({}) } : {}), allowDriverId: d.id, required: true, hint: d.manager_name ? `Cars in ${d.manager_name}'s group can be given to ${d.name.split(' ')[0]}` : undefined } : f)}
            initial={{ ...carDefaults(), ...(d.arrangement ? { c_type: d.arrangement } : {}), ...(looseCar ? { car_id: looseCar.id, c_type: d.arrangement || (/cerio|cireo|byd/i.test(looseCar.make) ? 'daily_hire' : 'work_and_pay') } : {}) }}
            onSubmit={async f => {
              if (!f.car_id) { const e = new Error('Choose a car'); e.details = { car_id: 'Required' }; throw e; }
              const c = await giveCar(d.id, f);
              notify(`${c.reg_number} assigned to ${d.name}`); setQuick(null); invalidateOptions(); refresh();
            }}
            onCancel={() => setQuick(null)} submitLabel={looseCar ? 'Start contract' : 'Assign car'} />
        </Modal>
      )}
      {quick && quick !== 'car' && (
        <Modal title={quick === 'payment' ? `Record payment · ${d.name}` : `Check-in · ${d.name}`} onClose={() => setQuick(null)} wide>
          <RecordForm
            fields={(quick === 'payment' ? payCfg : ciCfg).fields.filter(f => f.name !== (quick === 'payment' ? 'contract_id' : 'driver_id'))}
            initial={quick === 'payment'
              ? { ...payCfg.defaults(), contract_id: contract.id, c_rate: contract.daily_rate, c_type: contract.type,
                  amount: contract.type === 'daily_hire' ? null : contract.daily_rate, momo_number: d.momo_number, work_date: contract.next_unpaid_day }
              : { ...ciCfg.defaults(), driver_id: d.id }}
            onSubmit={f => quickSave(quick === 'payment' ? { ...f, contract_id: contract.id } : { ...f, driver_id: d.id })}
            onCancel={() => setQuick(null)}
            submitLabel={quick === 'payment' ? 'Record payment' : 'Save check-in'} />
        </Modal>
      )}
    </>
  );
}
