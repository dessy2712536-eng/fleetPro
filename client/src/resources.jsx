import { Badge, ExpiryCell, Plate, cachedOption, daysAgo, fmtDate, fmtDateTime, human, nowLocal, todayStr } from './ui';
import { Link } from 'react-router-dom';
import { api, ApiError } from './api';

// Formatting functions are injected per render (they depend on currency settings).
export const VEHICLE_TYPES = ['car', 'suv', 'pickup', 'van', 'truck', 'bus', 'motorbike', 'equipment', 'other'];
export const FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng', 'other'];

export const vehiclesCfg = ({ dist, user }) => ({
  endpoint: '/vehicles', singular: 'Car', exportName: 'vehicles',
  searchPlaceholder: 'Search plate, make, model, driver, manager',
  rowLink: r => `/vehicles/${r.id}`,
  initialFilters: mineFirst(user),
  filters: [
    { name: 'manager_id', label: 'Manager', ref: 'manager' },
    { name: 'status', label: 'Status', options: ['active', 'in_maintenance', 'inactive', 'handed_over', 'disposed'] },
    { name: 'type', label: 'Type', options: VEHICLE_TYPES },
  ],
  columns: [
    { key: 'reg_number', label: 'Car', sort: 'reg_number', render: r => <Plate to={`/vehicles/${r.id}`}>{r.reg_number}</Plate> },
    { key: 'make', label: 'Make & model', sort: 'make', render: r => <><strong>{r.make} {r.model}</strong><div className="dim">{r.year || ''} {human(r.type)} · {human(r.fuel_type)}</div></> },
    { key: 'manager_name', label: 'Manager', sort: 'manager_name', hideIn: 'manager_id', render: r => r.manager_name || <span className="txt-bad">No manager</span> },
    { key: 'driver_name', label: 'Driver', render: r => r.driver_name || <span className="dim">No driver</span> },
    { key: 'current_odometer', label: 'Odometer', num: true, sort: 'current_odometer', render: r => dist(r.current_odometer) },
    { key: 'insurance_expiry', label: 'Insurance', render: r => <ExpiryCell date={r.insurance_expiry} /> },
    { key: 'roadworthy_expiry', label: 'Roadworthy', render: r => <ExpiryCell date={r.roadworthy_expiry} /> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <Badge value={r.status} /> },
  ],
  defaults: () => ({ type: 'car', fuel_type: 'petrol', status: 'active', current_odometer: 0, ...(user && user.role === 'manager' ? { manager_id: user.id } : {}) }),
  fields: [
    { name: 'reg_number', label: 'Registration number', required: true },
    { name: 'manager_id', label: 'Manager', type: 'manager', required: true, hint: 'The manager responsible for this car' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'in_maintenance', 'inactive', 'handed_over', 'disposed'], required: true },
    { name: 'make', label: 'Make', required: true },
    { name: 'model', label: 'Model', required: true },
    { name: 'year', label: 'Year', type: 'number' },
    { name: 'type', label: 'Vehicle type', type: 'select', options: VEHICLE_TYPES, required: true },
    { name: 'fuel_type', label: 'Fuel type', type: 'select', options: FUEL_TYPES, required: true },
    { name: 'color', label: 'Colour' },
    { name: 'vin', label: 'VIN / chassis number' },
    { name: 'current_odometer', label: 'Current odometer', type: 'number', hint: 'Updates automatically from trips, fuel and service records' },
    { name: 'assigned_driver_id', label: 'Driver', type: 'driver', hint: 'Set automatically when you start a contract' },
    { name: 'purchase_date', label: 'Purchase date', type: 'date' },
    { name: 'purchase_price', label: 'Purchase price', type: 'number' },
    { name: 'insurance_expiry', label: 'Insurance expires', type: 'date' },
    { name: 'roadworthy_expiry', label: 'Roadworthy expires', type: 'date' },
    { name: 'registration_expiry', label: 'Registration expires', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

const mineFirst = user => (user && user.role === 'manager' ? { manager_id: user.id } : {});

// ---------- Giving a driver a car (used by Add driver and Assign car) ----------
const hasCar = f => !!f.car_id;
const isEV = make => /cerio|cireo|byd/i.test(make || '');

/** Form fields for picking a car and the contract that goes with it. */
export const carFields = ({ withHeading = true } = {}) => [
  ...(withHeading ? [{ name: 'car_heading', type: 'heading', label: 'Car', hint: 'Pick a car to give this driver now, or leave it empty and do it later.' }] : []),
  { name: 'car_id', label: 'Car', type: 'carpick', span: 2,
    derive: v => {
      const car = cachedOption('vehicle', v);
      if (!car) return {};
      return { ...(car.manager_id ? { manager_id: car.manager_id } : {}), c_type: isEV(car.make) ? 'daily_hire' : 'work_and_pay' };
    } },
  { name: 'c_type', label: 'Arrangement', type: 'select', options: ['work_and_pay', 'daily_hire'], required: true, showIf: hasCar, hint: 'Work & pay: driver owns the car after the term. Daily hire: e.g. Cerio, BYD' },
  { name: 'c_start_date', label: 'Start date', type: 'date', required: true, showIf: hasCar },
  { name: 'c_daily_rate', label: 'Daily payment', type: 'number', showIf: hasCar, hint: 'Leave empty for the standard rate (400 work & pay, Cerio 500, BYD 700)' },
  { name: 'c_paid_so_far', label: 'Total paid so far', type: 'number', showIf: hasCar, hint: 'Only for drivers who started before FleetPro: their payments up to yesterday' },
  { name: 'c_deposit_amount', label: 'Security deposit', type: 'number', required: true, showIf: f => hasCar(f) && f.c_type === 'work_and_pay', hint: '5,000–10,000: retrieved car · 15,000: new car' },
  { name: 'c_deposit_reference', label: 'Deposit MoMo reference', required: true, showIf: f => hasCar(f) && f.c_type === 'work_and_pay' },
  { name: 'c_deposit_date', label: 'Deposit paid on', type: 'date', showIf: f => hasCar(f) && f.c_type === 'work_and_pay' },
];
export const carDefaults = () => ({ c_type: 'work_and_pay', c_start_date: todayStr(), c_deposit_date: todayStr() });

// Contract errors come back with contract field names; show them on the matching form fields.
const CONTRACT_TO_FORM = { vehicle_id: 'car_id', driver_id: 'car_id', type: 'c_type', start_date: 'c_start_date', daily_rate: 'c_daily_rate', deposit_amount: 'c_deposit_amount', deposit_reference: 'c_deposit_reference', deposit_date: 'c_deposit_date', end_date: 'c_start_date' };

/** Start a contract between a driver and the car picked in the form. Returns the contract. */
export async function giveCar(driverId, f) {
  const isWP = f.c_type === 'work_and_pay';
  let contract;
  try {
    contract = await api('/contracts', { method: 'POST', body: {
      driver_id: driverId, vehicle_id: f.car_id, type: f.c_type, status: 'active', start_date: f.c_start_date,
      daily_rate: f.c_daily_rate || null, payment_days: 'mon_sat',
      deposit_amount: isWP ? f.c_deposit_amount : null, deposit_reference: isWP ? f.c_deposit_reference : null,
      deposit_date: isWP ? (f.c_deposit_date || f.c_start_date) : null,
    } });
  } catch (e) {
    const details = {};
    Object.entries(e.details || {}).forEach(([k, v]) => { details[CONTRACT_TO_FORM[k] || k] = v; });
    throw new ApiError(e.status, e.message, details);
  }
  if (Number(f.c_paid_so_far) > 0) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    await api('/payments', { method: 'POST', body: {
      contract_id: contract.id, type: 'adjustment', paid_on: todayStr(), amount: Number(f.c_paid_so_far),
      work_date: yesterday < f.c_start_date ? f.c_start_date : yesterday, notes: 'Total paid before FleetPro (opening balance)',
    } }).catch(() => { /* the contract stands; the opening balance can be added under Payments */ });
  }
  return contract;
}

const DRIVER_KEYS = ['name', 'status', 'manager_id', 'phone', 'momo_number', 'id_number', 'license_number', 'license_class', 'license_expiry', 'hire_date', 'email', 'notes'];

export const driversCfg = ({ money, user } = {}) => ({
  endpoint: '/drivers', singular: 'Driver', exportName: 'drivers',
  searchPlaceholder: 'Search name, phone, MoMo number, car',
  rowLink: r => `/drivers/${r.id}`,
  initialFilters: mineFirst(user),
  filters: [
    { name: 'manager_id', label: 'Manager', ref: 'manager' },
    { name: 'status', label: 'Status', options: ['active', 'on_leave', 'stopped'] },
    { name: 'intention', label: 'Latest feedback', options: ['continue', 'undecided', 'wants_to_stop'] },
  ],
  columns: [
    { key: 'name', label: 'Driver', sort: 'name', render: r => <><Link to={`/drivers/${r.id}`} className="strong-link">{r.name}</Link><div className="dim">{r.phone || ''}</div></> },
    { key: 'manager_name', label: 'Manager', sort: 'manager_name', hideIn: 'manager_id', render: r => r.manager_name || <span className="dim">None</span> },
    { key: 'reg_number', label: 'Car', render: r => r.reg_number ? <><Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate><div className="dim">{human(r.contract_type)} · {money ? money(r.daily_rate) : r.daily_rate}/day</div></> : <span className="dim">No car</span> },
    { key: 'arrears', label: 'Owing', num: true, sort: 'arrears', render: r => r.arrears == null ? <span className="dim">—</span> : <Owing r={r} money={money} /> },
    { key: 'remaining_balance', label: 'Car balance', num: true, render: r => r.remaining_balance == null ? <span className="dim">—</span> : <>{money ? money(r.remaining_balance) : r.remaining_balance}<div className="dim">{r.progress}% paid</div></> },
    { key: 'intention', label: 'Latest feedback', render: r => r.intention ? <><Badge value={r.intention} /><div className="dim">{fmtDate(r.last_checkin_on)}</div></> : <span className="dim">No check-in</span> },
    { key: 'license_expiry', label: 'Licence', sort: 'license_expiry', render: r => <ExpiryCell date={r.license_expiry} /> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <Badge value={r.status} /> },
  ],
  defaults: () => ({ status: 'active', __new: true, ...carDefaults(), ...(user && user.role === 'manager' ? { manager_id: user.id } : {}) }),
  // A new driver can be given a car in the same step. If the car can't be given, the driver isn't kept,
  // so pressing Save again never creates the same driver twice.
  save: async (form, editing) => {
    const body = Object.fromEntries(DRIVER_KEYS.filter(k => k in form).map(k => [k, form[k]]));
    if (editing && editing.id) { await api(`/drivers/${editing.id}`, { method: 'PUT', body }); return 'Driver updated'; }
    if (form.car_id && !body.hire_date) body.hire_date = form.c_start_date;
    const driver = await api('/drivers', { method: 'POST', body });
    if (!form.car_id) return 'Driver added';
    try {
      const c = await giveCar(driver.id, form);
      return `${driver.name} added and given ${c.reg_number}`;
    } catch (e) {
      await api(`/drivers/${driver.id}`, { method: 'DELETE' }).catch(() => {});
      throw e;
    }
  },
  fields: [
    { name: 'name', label: 'Full name', required: true },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'on_leave', 'stopped'], required: true },
    { name: 'manager_id', label: 'Manager', type: 'manager', hint: 'The manager this driver reports to' },
    { name: 'phone', label: 'Phone' },
    { name: 'momo_number', label: 'MTN MoMo number', hint: 'Number the driver pays from' },
    ...carFields().map(f => ({ ...f, showIf: form => !!form.__new && (!f.showIf || f.showIf(form)) })),
    { name: 'details_heading', type: 'heading', label: 'Licence and other details', showIf: form => !!form.__new },
    { name: 'id_number', label: 'Ghana Card number' },
    { name: 'license_number', label: 'Licence number' },
    { name: 'license_class', label: 'Licence class' },
    { name: 'license_expiry', label: 'Licence expires', type: 'date' },
    { name: 'hire_date', label: 'Joined on', type: 'date' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

export function Owing({ r, money }) {
  const a = r.arrears;
  if (a > 0) return <span className={r.days_behind >= 3 ? 'txt-bad' : 'txt-warn'}>{money(a)}<div className="dim">{r.days_behind} days behind</div></span>;
  if (a < 0) return <span className="txt-ok">{money(-a)} ahead</span>;
  return <span className="txt-ok">Up to date</span>;
}

export const contractsCfg = ({ money, user }) => ({
  endpoint: '/contracts', singular: 'Contract', exportName: 'contracts', dateRange: true,
  searchPlaceholder: 'Search driver, car, deposit reference',
  initialFilters: { status: 'active', ...mineFirst(user) },
  filters: [
    { name: 'manager_id', label: 'Manager', ref: 'manager' },
    { name: 'status', label: 'Status', options: ['active', 'completed', 'stopped'] },
    { name: 'type', label: 'Type', options: ['work_and_pay', 'daily_hire'] },
  ],
  columns: [
    { key: 'driver_name', label: 'Driver', sort: 'driver_name', hideIn: 'driver_id', render: r => <><Link to={`/drivers/${r.driver_id}`} className="strong-link">{r.driver_name}</Link><div className="dim">{r.manager_name || 'No manager'}</div></> },
    { key: 'reg_number', label: 'Car', hideIn: 'vehicle_id', render: r => <><Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate><div className="dim">{r.make} {r.model}{r.car_condition ? ` · ${r.car_condition}` : ''}</div></> },
    { key: 'type', label: 'Type', render: r => <><Badge value={r.type} /><div className="dim">{money(r.daily_rate)}/day · {human(r.payment_days)}</div></> },
    { key: 'start_date', label: 'Term', sort: 'start_date', render: r => <>{fmtDate(r.start_date)}<div className="dim">{r.ended_on ? `Ended ${fmtDate(r.ended_on)}` : r.end_date ? `to ${fmtDate(r.end_date)}` : 'Ongoing'}</div></> },
    { key: 'deposit_amount', label: 'Deposit', num: true, render: r => r.deposit_amount ? <>{money(r.deposit_amount)}<div className="dim">{r.deposit_reference}</div></> : <span className="dim">—</span> },
    { key: 'arrears', label: 'Owing', num: true, sort: 'arrears', render: r => <Owing r={r} money={money} /> },
    { key: 'remaining_balance', label: 'Car balance', num: true, sort: 'remaining_balance', render: r => r.remaining_balance == null ? <span className="dim">Daily hire</span> : <>{money(r.remaining_balance)}<div className="progress" title={`${r.progress}% paid`}><span style={{ width: `${r.progress}%` }} /></div></> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <Badge value={r.status} /> },
  ],
  defaults: () => ({ type: 'work_and_pay', status: 'active', start_date: todayStr(), deposit_date: todayStr(), payment_days: 'mon_sat' }),
  fields: [
    { name: 'driver_id', label: 'Driver', type: 'driver', required: true },
    { name: 'vehicle_id', label: 'Car', type: 'vehicle', required: true, hint: 'New cars need the full new-car deposit; retrieved cars accept less' },
    { name: 'type', label: 'Arrangement', type: 'select', options: ['work_and_pay', 'daily_hire'], required: true, hint: 'Work & pay: driver owns the car after the term. Daily hire: e.g. Cerio, BYD' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'completed', 'stopped'], required: true },
    { name: 'start_date', label: 'Start date', type: 'date', required: true },
    { name: 'end_date', label: 'End date', type: 'date', hint: 'Work & pay: leave empty to set 4 years automatically' },
    { name: 'daily_rate', label: 'Daily payment', type: 'number', hint: 'Leave empty for the standard rate (400 work & pay, Cerio 500, BYD 700)' },
    { name: 'payment_days', label: 'Pays on', type: 'select', options: ['mon_sat', 'every_day'], required: true },
    { name: 'deposit_amount', label: 'Security deposit', type: 'number', showIf: f => f.type === 'work_and_pay' || f.deposit_amount, hint: '5,000–10,000: retrieved car · 15,000: new car' },
    { name: 'deposit_reference', label: 'Deposit MoMo reference', showIf: f => f.type === 'work_and_pay' || f.deposit_amount },
    { name: 'deposit_date', label: 'Deposit paid on', type: 'date', showIf: f => f.type === 'work_and_pay' || f.deposit_amount },
    { name: 'ended_on', label: 'Ended on', type: 'date', showIf: f => f.status !== 'active' },
    { name: 'end_reason', label: 'Reason for ending', span: 2, showIf: f => f.status !== 'active' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

export const paymentsCfg = ({ money, user }) => ({
  endpoint: '/payments', singular: 'Payment', exportName: 'payments', dateRange: true,
  searchPlaceholder: 'Search MoMo reference, driver, car',
  initialFilters: mineFirst(user),
  filters: [
    { name: 'manager_id', label: 'Manager', ref: 'manager' },
    { name: 'type', label: 'Type', options: ['daily', 'waiver', 'adjustment'] },
    { name: 'driver_id', label: 'Driver', ref: 'driver' },
  ],
  columns: [
    { key: 'paid_on', label: 'Paid on', sort: 'paid_on', render: r => fmtDate(r.paid_on) },
    { key: 'work_date', label: 'For work on', sort: 'work_date', render: r => fmtDate(r.work_date) },
    { key: 'driver_name', label: 'Driver', sort: 'driver_name', hideIn: 'driver_id', render: r => <><Link to={`/drivers/${r.driver_id}`} className="strong-link">{r.driver_name}</Link><div className="dim">{r.manager_name || ''}</div></> },
    { key: 'reg_number', label: 'Car', hideIn: 'vehicle_id', render: r => <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> },
    { key: 'momo_reference', label: 'MoMo reference', render: r => r.momo_reference ? <><span className="mono">{r.momo_reference}</span><div className="dim">{r.momo_number || ''}</div></> : <span className="dim">{r.type === 'daily' ? '—' : human(r.type)}</span> },
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: r => <><strong className={r.type === 'waiver' ? 'txt-warn' : ''}>{money(r.amount)}</strong>{r.type !== 'daily' && <div className="dim">{human(r.type)}</div>}</> },
    { key: 'recorded_by', label: 'Recorded by', render: r => <>{r.recorded_by || '—'}{r.notes && <div className="dim">{r.notes}</div>}</> },
  ],
  defaults: () => ({ type: 'daily', paid_on: todayStr(), work_date: daysAgo(1) }),
  fields: [
    { name: 'contract_id', label: 'Driver and car', type: 'contract', required: true, span: 2,
      derive: (v, form) => { const o = cachedOption('contract', v); return o ? { ...(form.amount ? {} : { amount: o.daily_rate }), ...(o.next_unpaid_day ? { work_date: o.next_unpaid_day } : {}) } : {}; } },
    { name: 'type', label: 'Type', type: 'select', options: ['daily', 'waiver', 'adjustment'], required: true, hint: 'Excused days: car off the road, holiday – no money received' },
    { name: 'amount', label: 'Amount', type: 'number', required: true },
    { name: 'work_date', label: 'For work done on', type: 'date', required: true, hint: 'Filled in with the next unpaid day. For excused days, the first day off' },
    { name: 'paid_on', label: 'Paid on', type: 'date', required: true },
    { name: 'momo_reference', label: 'MTN MoMo reference', showIf: f => f.type !== 'waiver', hint: 'Transaction ID from the MoMo message' },
    { name: 'momo_number', label: 'Paid from number', showIf: f => f.type !== 'waiver' },
    { name: 'notes', label: 'Notes', type: 'textarea', hint: 'Required for excused days: give the reason' },
  ],
});

export const checkinsCfg = ({ user }) => ({
  endpoint: '/checkins', singular: 'Check-in', exportName: 'driver-check-ins', dateRange: true,
  searchPlaceholder: 'Search driver, car, complaint',
  initialFilters: mineFirst(user),
  filters: [
    { name: 'manager_id', label: 'Manager', ref: 'manager' },
    { name: 'intention', label: 'Driver wants to', options: ['continue', 'undecided', 'wants_to_stop'] },
    { name: 'complaint_status', label: 'Complaint', options: ['none', 'open', 'resolved'] },
    { name: 'car_condition', label: 'Car', options: ['good', 'needs_attention', 'in_workshop', 'accident', 'off_road'] },
  ],
  columns: [
    { key: 'date', label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
    { key: 'driver_name', label: 'Driver', sort: 'driver_name', hideIn: 'driver_id', render: r => <><Link to={`/drivers/${r.driver_id}`} className="strong-link">{r.driver_name}</Link><div className="dim">{r.manager_name || ''}</div></> },
    { key: 'reg_number', label: 'Car', hideIn: 'vehicle_id', render: r => r.reg_number ? <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> : <span className="dim">—</span> },
    { key: 'car_condition', label: 'Car condition', render: r => <Badge value={r.car_condition} /> },
    { key: 'intention', label: 'Driver wants to', sort: 'intention', render: r => <Badge value={r.intention} /> },
    { key: 'complaint', label: 'Complaint / action', render: r => r.complaint ? <><span>{r.complaint}</span>{r.action_taken && <div className="dim">Action: {r.action_taken}</div>}</> : <span className="dim">None</span> },
    { key: 'complaint_status', label: 'Status', render: r => <Badge value={r.complaint_status} /> },
  ],
  defaults: () => ({ date: todayStr(), car_condition: 'good', intention: 'continue', complaint_status: 'none' }),
  fields: [
    { name: 'driver_id', label: 'Driver', type: 'driver', required: true },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'car_condition', label: 'Car condition', type: 'select', options: ['good', 'needs_attention', 'in_workshop', 'accident', 'off_road'], required: true },
    { name: 'odometer', label: 'Odometer reading', type: 'number', hint: 'Keeps service reminders accurate' },
    { name: 'intention', label: 'Does the driver want to continue?', type: 'select', options: ['continue', 'undecided', 'wants_to_stop'], required: true },
    { name: 'complaint_status', label: 'Complaint status', type: 'select', options: ['none', 'open', 'resolved'] },
    { name: 'complaint', label: 'Complaint', type: 'textarea' },
    { name: 'action_taken', label: 'Action taken', type: 'textarea' },
  ],
});

export const tripsCfg = ({ dist }) => ({
  endpoint: '/trips', singular: 'Trip', exportName: 'trips', dateRange: true,
  searchPlaceholder: 'Search plate, driver, place, purpose',
  filters: [
    { name: 'status', label: 'Status', options: ['planned', 'in_progress', 'completed', 'cancelled'] },
    { name: 'vehicle_id', label: 'Vehicle', ref: 'vehicle' },
    { name: 'driver_id', label: 'Driver', ref: 'driver' },
  ],
  columns: [
    { key: 'start_time', label: 'Started', sort: 'start_time', render: r => fmtDateTime(r.start_time) },
    { key: 'reg_number', label: 'Vehicle', hideIn: 'vehicle_id', render: r => <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> },
    { key: 'driver_name', label: 'Driver', hideIn: 'driver_id' },
    { key: 'route', label: 'Route', render: r => <>{r.origin || '?'} <span className="dim">to</span> {r.destination || '?'}<div className="dim">{r.purpose}</div></> },
    { key: 'distance', label: 'Distance', num: true, sort: 'distance', render: r => dist(r.distance) },
    { key: 'status', label: 'Status', sort: 'status', render: r => <Badge value={r.status} /> },
  ],
  defaults: () => ({ status: 'in_progress', start_time: nowLocal() }),
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true },
    { name: 'driver_id', label: 'Driver', type: 'driver' },
    { name: 'status', label: 'Status', type: 'select', options: ['planned', 'in_progress', 'completed', 'cancelled'], required: true },
    { name: 'purpose', label: 'Purpose' },
    { name: 'origin', label: 'From' },
    { name: 'destination', label: 'To' },
    { name: 'start_time', label: 'Start', type: 'datetime', required: true },
    { name: 'end_time', label: 'End', type: 'datetime' },
    { name: 'start_odometer', label: 'Start odometer', type: 'number' },
    { name: 'end_odometer', label: 'End odometer', type: 'number', hint: 'Required to mark the trip completed' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

export const fuelCfg = ({ money, dist }) => ({
  endpoint: '/fuel', singular: 'Fuel entry', exportName: 'fuel-logs', dateRange: true,
  searchPlaceholder: 'Search plate, driver, station',
  filters: [{ name: 'vehicle_id', label: 'Vehicle', ref: 'vehicle' }, { name: 'driver_id', label: 'Driver', ref: 'driver' }],
  columns: [
    { key: 'date', label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
    { key: 'reg_number', label: 'Vehicle', hideIn: 'vehicle_id', render: r => <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> },
    { key: 'driver_name', label: 'Driver' },
    { key: 'station', label: 'Station' },
    { key: 'liters', label: 'Litres', num: true, sort: 'liters', render: r => Number(r.liters).toFixed(1) },
    { key: 'price_per_liter', label: 'Per litre', num: true, render: r => money(r.price_per_liter) },
    { key: 'cost', label: 'Cost', num: true, sort: 'cost', render: r => <strong>{money(r.cost)}</strong> },
    { key: 'odometer', label: 'Odometer', num: true, render: r => dist(r.odometer) },
  ],
  defaults: () => ({ date: todayStr(), full_tank: 1 }),
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true },
    { name: 'driver_id', label: 'Driver', type: 'driver' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'station', label: 'Station' },
    { name: 'liters', label: 'Litres', type: 'number', required: true },
    { name: 'cost', label: 'Total cost', type: 'number', required: true },
    { name: 'odometer', label: 'Odometer reading', type: 'number' },
    { name: 'full_tank', label: 'Filled to full tank', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

export const EXPENSE_CATS = ['tolls', 'parking', 'insurance', 'registration', 'licensing', 'tyres', 'fines', 'cleaning', 'other'];
export const expensesCfg = ({ money }) => ({
  endpoint: '/expenses', singular: 'Expense', exportName: 'expenses', dateRange: true,
  searchPlaceholder: 'Search plate, vendor, description',
  filters: [{ name: 'category', label: 'Category', options: EXPENSE_CATS }, { name: 'vehicle_id', label: 'Vehicle', ref: 'vehicle' }],
  columns: [
    { key: 'date', label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
    { key: 'reg_number', label: 'Vehicle', hideIn: 'vehicle_id', render: r => r.reg_number ? <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> : <span className="dim">Whole fleet</span> },
    { key: 'category', label: 'Category', sort: 'category', render: r => human(r.category) },
    { key: 'vendor', label: 'Paid to' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', num: true, sort: 'amount', render: r => <strong>{money(r.amount)}</strong> },
  ],
  defaults: () => ({ date: todayStr(), category: 'tolls' }),
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'vehicle', hint: 'Leave empty for a fleet-wide cost' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS, required: true },
    { name: 'amount', label: 'Amount', type: 'number', required: true },
    { name: 'vendor', label: 'Paid to' },
    { name: 'description', label: 'Description', span: 2 },
  ],
});

export const MAINT_TYPES = ['service', 'repair', 'inspection', 'tyres', 'bodywork', 'other'];
export const recordsCfg = ({ money, dist }) => ({
  endpoint: '/maintenance/records', singular: 'Work order', exportName: 'maintenance', dateRange: true,
  searchPlaceholder: 'Search plate, job, garage',
  filters: [
    { name: 'status', label: 'Status', options: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
    { name: 'type', label: 'Type', options: MAINT_TYPES },
    { name: 'vehicle_id', label: 'Vehicle', ref: 'vehicle' },
  ],
  columns: [
    { key: 'date', label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
    { key: 'reg_number', label: 'Vehicle', hideIn: 'vehicle_id', render: r => <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> },
    { key: 'description', label: 'Job', render: r => <>{r.description}<div className="dim">{human(r.type)}{r.service_type ? ` · ${r.service_type} schedule` : ''}</div></> },
    { key: 'vendor', label: 'Garage' },
    { key: 'odometer', label: 'Odometer', num: true, render: r => dist(r.odometer) },
    { key: 'cost', label: 'Cost', num: true, sort: 'cost', render: r => money(r.cost) },
    { key: 'status', label: 'Status', sort: 'status', render: r => <Badge value={r.status} /> },
  ],
  defaults: () => ({ date: todayStr(), type: 'service', status: 'completed' }),
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true },
    { name: 'schedule_id', label: 'Service schedule', type: 'schedule', hint: 'Completing a linked job resets that schedule' },
    { name: 'description', label: 'Job description', required: true, span: 2 },
    { name: 'type', label: 'Type', type: 'select', options: MAINT_TYPES, required: true },
    { name: 'status', label: 'Status', type: 'select', options: ['scheduled', 'in_progress', 'completed', 'cancelled'], required: true },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'odometer', label: 'Odometer', type: 'number' },
    { name: 'vendor', label: 'Garage / vendor' },
    { name: 'cost', label: 'Cost', type: 'number' },
    { name: 'downtime_days', label: 'Days off the road', type: 'number' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

export const schedulesCfg = ({ dist }) => ({
  endpoint: '/maintenance/schedules', singular: 'Service schedule', exportName: 'service-schedules',
  searchPlaceholder: 'Search plate or service',
  filters: [{ name: 'vehicle_id', label: 'Vehicle', ref: 'vehicle' }],
  columns: [
    { key: 'reg_number', label: 'Vehicle', hideIn: 'vehicle_id', render: r => <Plate to={`/vehicles/${r.vehicle_id}`}>{r.reg_number}</Plate> },
    { key: 'service_type', label: 'Service', render: r => <strong>{r.service_type}</strong> },
    { key: 'interval', label: 'Every', render: r => [r.interval_km && dist(r.interval_km), r.interval_days && `${r.interval_days} days`].filter(Boolean).join(' or ') },
    { key: 'last', label: 'Last done', render: r => <>{fmtDate(r.last_done_date)}<div className="dim">{r.last_done_odometer != null ? dist(r.last_done_odometer) : ''}</div></> },
    { key: 'next', label: 'Next due', render: r => <NextDue r={r} dist={dist} /> },
    { key: 'active', label: 'Active', render: r => r.active ? 'Yes' : <span className="dim">Paused</span> },
  ],
  defaults: () => ({ active: 1, interval_km: 5000, interval_days: 180 }),
  fields: [
    { name: 'vehicle_id', label: 'Vehicle', type: 'vehicle', required: true },
    { name: 'service_type', label: 'Service', required: true, hint: 'e.g. Oil & filter change' },
    { name: 'interval_km', label: 'Every (distance)', type: 'number' },
    { name: 'interval_days', label: 'Every (days)', type: 'number' },
    { name: 'last_done_date', label: 'Last done on', type: 'date' },
    { name: 'last_done_odometer', label: 'Last done at odometer', type: 'number' },
    { name: 'active', label: 'Schedule is active', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
});

function NextDue({ r, dist }) {
  const parts = [];
  let tone = '';
  if (r.next_due_odometer != null) {
    const left = r.next_due_odometer - r.current_odometer;
    if (left <= 0) tone = 'bad'; else if (left <= Math.min(1000, r.interval_km * 0.1)) tone = tone || 'warn';
    parts.push(left <= 0 ? `${dist(-left)} overdue` : `in ${dist(left)}`);
  }
  if (r.next_due_date) {
    const days = Math.round((new Date(r.next_due_date) - new Date(todayStr())) / 86400000);
    if (days < 0) tone = 'bad'; else if (days <= 14 && tone !== 'bad') tone = 'warn';
    parts.push(days < 0 ? `${-days} days overdue` : `by ${fmtDate(r.next_due_date)}`);
  }
  return <span className={tone ? `txt-${tone}` : ''}>{parts.join(' · ') || '—'}</span>;
}
