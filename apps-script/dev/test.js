// Run with: node apps-script/dev/test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./emulator');

const { ctx, book, call } = loadBackend();
// Forget which tabs were checked, as a fresh Apps Script run would.
const freshRun = () => require('vm').runInContext('Object.keys(_checked).forEach(k => delete _checked[k]);', ctx);
ctx.setup();
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

const admin = ok(call('POST', '/auth/login', { body: { email: 'ADMIN@fleet.local', password: 'admin12345' } })).token;
const as = (token, method, p, opts = {}) => call(method, p, { ...opts, token });

test('setup creates tabs with headers', () => {
  for (const t of ['users', 'vehicles', 'drivers', 'trips', 'fuel_logs', 'expenses', 'maintenance_schedules', 'maintenance_records', 'audit_log', 'settings']) {
    assert.ok(book.getSheetByName(t), t);
  }
  assert.equal(book.getSheetByName('Sheet1'), null);
  assert.equal(book.getSheetByName('vehicles').getRange(1, 1, 1, 2).getValues()[0].join(), 'id,reg_number');
});

test('auth', () => {
  assert.equal(call('POST', '/auth/login', { body: { email: 'admin@fleet.local', password: 'wrong' } }).status, 401);
  assert.equal(call('GET', '/vehicles').status, 401);
  assert.equal(call('GET', '/vehicles', { token: admin.slice(0, -3) + 'abc' }).status, 401);
  assert.equal(ok(as(admin, 'GET', '/auth/me')).user.role, 'admin');
});

let viewer;
test('viewer cannot write', () => {
  ok(as(admin, 'POST', '/users', { body: { name: 'V', email: 'v@x.com', password: 'viewer1234', role: 'viewer' } }));
  viewer = ok(call('POST', '/auth/login', { body: { email: 'v@x.com', password: 'viewer1234' } })).token;
  assert.equal(as(viewer, 'GET', '/vehicles').ok, true);
  assert.equal(as(viewer, 'POST', '/drivers', { body: { name: 'x', status: 'active' } }).status, 403);
});

let vid, did;
test('vehicles and drivers with validation and uniqueness', () => {
  const bad = as(admin, 'POST', '/vehicles', { body: { make: 'Toyota', type: 'rocket' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.details.reg_number && bad.details.type);
  did = ok(as(admin, 'POST', '/drivers', { body: { name: 'Kwame', status: 'active', license_expiry: '2020-01-01' } })).id;
  const v = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'GR-1-24', make: 'Toyota', model: 'Hilux', type: 'pickup', fuel_type: 'diesel', status: 'active', current_odometer: 1000, assigned_driver_id: did, insurance_expiry: '2001-01-01' } }));
  assert.equal(v.driver_name, 'Kwame');
  assert.equal(v.current_odometer, 1000);
  vid = v.id;
  assert.equal(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'gr-1-24', make: 'a', model: 'b', type: 'car', fuel_type: 'petrol', status: 'active' } }).status, 409);
  // values round-trip through the sheet as typed values
  const again = ok(as(admin, 'GET', `/vehicles/${vid}`));
  assert.equal(typeof again.current_odometer, 'number');
  assert.equal(again.insurance_expiry, '2001-01-01');
});

test('trips update odometer and enforce rules', () => {
  assert.equal(as(admin, 'POST', '/trips', { body: { vehicle_id: vid, start_time: '2026-01-01T08:00', start_odometer: 1000, end_odometer: 900, status: 'completed' } }).status, 422);
  const t = ok(as(admin, 'POST', '/trips', { body: { vehicle_id: vid, driver_id: did, start_time: '2026-01-01T08:00', start_odometer: 1000, end_odometer: 1250, status: 'completed' } }));
  assert.equal(t.distance, 250);
  assert.equal(ok(as(admin, 'GET', `/vehicles/${vid}`)).current_odometer, 1250);
  ok(as(admin, 'POST', '/trips', { body: { vehicle_id: vid, start_time: '2026-01-02T08:00', status: 'in_progress' } }));
  assert.equal(as(admin, 'POST', '/trips', { body: { vehicle_id: vid, start_time: '2026-01-02T09:00', status: 'in_progress' } }).status, 409);
  const list = ok(as(admin, 'GET', '/trips', { query: { vehicle_id: vid, sort: 'start_time', dir: 'asc' } }));
  assert.equal(list.total, 2);
  assert.equal(list.rows[0].start_time, '2026-01-01T08:00');
});

test('maintenance resets schedule and toggles vehicle status', () => {
  const s = ok(as(admin, 'POST', '/maintenance/schedules', { body: { vehicle_id: vid, service_type: 'Oil', interval_km: 200, last_done_odometer: 0 } }));
  let alerts = ok(as(admin, 'GET', '/alerts')).alerts;
  assert.ok(alerts.some(a => a.kind === 'service_due' && a.severity === 'overdue'));
  assert.ok(alerts.some(a => a.kind === 'insurance'));
  assert.ok(alerts.some(a => a.kind === 'license'));
  const r = ok(as(admin, 'POST', '/maintenance/records', { body: { vehicle_id: vid, schedule_id: s.id, date: '2026-01-03', odometer: 1300, type: 'service', description: 'Oil change', status: 'in_progress' } }));
  assert.equal(ok(as(admin, 'GET', `/vehicles/${vid}`)).status, 'in_maintenance');
  ok(as(admin, 'PUT', `/maintenance/records/${r.id}`, { body: { status: 'completed', cost: 500 } }));
  assert.equal(ok(as(admin, 'GET', `/vehicles/${vid}`)).status, 'active');
  assert.equal(ok(as(admin, 'GET', `/maintenance/schedules/${s.id}`)).last_done_odometer, 1300);
  alerts = ok(as(admin, 'GET', '/alerts')).alerts;
  assert.ok(!alerts.some(a => a.schedule_id === s.id && a.severity === 'overdue'));
});

test('reports', () => {
  ok(as(admin, 'POST', '/fuel', { body: { vehicle_id: vid, date: '2026-01-01', liters: 25, cost: 350, odometer: 1250 } }));
  ok(as(admin, 'POST', '/expenses', { body: { vehicle_id: vid, date: '2026-01-01', category: 'tolls', amount: 150 } }));
  const r = ok(as(admin, 'GET', '/reports/vehicles', { query: { from: '2026-01-01', to: '2026-01-31' } })).rows.find(x => x.vehicle_id === vid);
  assert.equal(r.fuel_cost, 350);
  assert.equal(r.maintenance_cost, 500);
  assert.equal(r.total_cost, 1000);
  assert.ok(r.distance_km >= 250 && r.km_per_liter > 0 && r.cost_per_km > 0);
  assert.equal(ok(as(admin, 'GET', '/reports/monthly', { query: { from: '2026-01-01', to: '2026-03-31' } })).rows.length, 3);
});

test('deleting a vehicle removes its records; deleting a driver unlinks them', () => {
  const d2 = ok(as(admin, 'POST', '/drivers', { body: { name: 'Temp', status: 'active' } })).id;
  ok(as(admin, 'PUT', `/vehicles/${vid}`, { body: { assigned_driver_id: d2 } }));
  ok(as(admin, 'DELETE', `/drivers/${d2}`));
  assert.equal(ok(as(admin, 'GET', `/vehicles/${vid}`)).assigned_driver_id, null);
  ok(as(admin, 'DELETE', `/vehicles/${vid}`));
  assert.equal(ok(as(admin, 'GET', '/trips')).total, 0);
  assert.equal(ok(as(admin, 'GET', '/fuel')).total, 0);
});

test('settings, users, last admin protection, password change', () => {
  assert.equal(as(viewer, 'PUT', '/settings', { body: { currency: 'USD' } }).status, 403);
  assert.equal(ok(as(admin, 'PUT', '/settings', { body: { currency: 'USD', alert_days: 45 } })).currency, 'USD');
  assert.equal(ok(as(viewer, 'GET', '/settings')).alert_days, '45');
  const me = ok(as(admin, 'GET', '/auth/me')).user;
  assert.equal(as(admin, 'PUT', `/users/${me.id}`, { body: { role: 'viewer' } }).status, 400);
  assert.equal(as(viewer, 'POST', '/auth/change-password', { body: { current_password: 'nope', new_password: 'newpass123' } }).status, 400);
  ok(as(viewer, 'POST', '/auth/change-password', { body: { current_password: 'viewer1234', new_password: 'newpass123' } }));
  assert.equal(call('POST', '/auth/login', { body: { email: 'v@x.com', password: 'newpass123' } }).ok, true);
});

test('work & pay contract: deposit rules, arrears, MoMo references, handover', () => {
  const { addDays, today, payDays } = { addDays: ctx.addDays, today: ctx.today, payDays: ctx.payDays };
  const mgr = ok(as(admin, 'POST', '/users', { body: { name: 'Mgr One', email: 'm1@x.com', password: 'manager123', role: 'manager' } }));
  const mtok = ok(call('POST', '/auth/login', { body: { email: 'm1@x.com', password: 'manager123' } })).token;
  const drv = ok(as(admin, 'POST', '/drivers', { body: { name: 'Ama Driver', status: 'active', manager_id: mgr.id, momo_number: '0241112222' } }));
  const car = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: mgr.id, reg_number: 'GR-100-26', make: 'Toyota', model: 'Vitz', type: 'car', fuel_type: 'petrol', status: 'active' } }));
  const start = addDays(today(), -14);
  const base = { driver_id: drv.id, vehicle_id: car.id, type: 'work_and_pay', start_date: start, status: 'active', deposit_reference: 'DEP001' };

  // New car needs 15,000; below minimum rejected; reference required
  let r = as(admin, 'POST', '/contracts', { body: { ...base, deposit_amount: 4000 } });
  assert.equal(r.status, 422); assert.ok(r.details.deposit_amount);
  r = as(admin, 'POST', '/contracts', { body: { ...base, deposit_amount: 8000 } });
  assert.equal(r.status, 422); assert.match(r.details.vehicle_id, /new car/);
  const c = ok(as(mtok, 'POST', '/contracts', { body: { ...base, deposit_amount: 15000 } }));
  assert.equal(c.daily_rate, 400);
  assert.equal(c.end_date, addDays(ctx.addYears(start, 4), -1));
  assert.equal(c.car_condition, 'new');
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).assigned_driver_id, drv.id);
  const due = payDays(start, addDays(today(), -1), 'mon_sat');
  assert.equal(c.expected_to_date, due * 400);
  assert.equal(c.arrears, due * 400);
  assert.ok(c.contract_value > 490000 && c.contract_value < 505000, String(c.contract_value));

  // A second active contract on the same car is blocked
  const drv2 = ok(as(admin, 'POST', '/drivers', { body: { name: 'Kojo Two', status: 'active', manager_id: mgr.id } }));
  assert.equal(as(admin, 'POST', '/contracts', { body: { ...base, driver_id: drv2.id, deposit_amount: 15000, deposit_reference: 'DEP002' } }).status, 422);

  // Payments: reference required + unique; reduce arrears; waiver needs a reason
  assert.equal(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: start, paid_on: addDays(start, 1), amount: 400 } }).status, 422);
  const p1 = ok(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: start, paid_on: addDays(start, 1), amount: 400, momo_reference: 'MP123' } }));
  assert.equal(p1.recorded_by, 'Mgr One');
  assert.equal(p1.driver_name, 'Ama Driver');
  assert.equal(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: start, paid_on: start, amount: 400, momo_reference: 'mp123' } }).status, 422);
  assert.equal(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: start, paid_on: start, amount: 400, momo_reference: 'dep001' } }).status, 422);
  const twice = as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: start, paid_on: addDays(start, 1), amount: 400, momo_reference: 'MP124' } });
  assert.equal(twice.status, 422); assert.match(twice.details.work_date, /already fully paid/);
  assert.equal(ok(as(admin, 'GET', `/contracts/${c.id}`)).next_unpaid_day > start, true);
  assert.equal(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'waiver', work_date: start, paid_on: start, amount: 800 } }).status, 422);
  ok(as(mtok, 'POST', '/payments', { body: { contract_id: c.id, type: 'waiver', work_date: addDays(start, 1), paid_on: addDays(start, 2), amount: 800, notes: 'Car in workshop' } }));
  let cv = ok(as(admin, 'GET', `/contracts/${c.id}`));
  assert.equal(cv.paid_total, 400);
  assert.equal(cv.waived_total, 800);
  assert.equal(cv.arrears, due * 400 - 1200);
  assert.equal(cv.remaining_balance, cv.contract_value - 400); // waivers don't pay off the car

  // Driver list shows arrears and manager; manager filter works
  const dl = ok(as(admin, 'GET', '/drivers', { query: { manager_id: mgr.id } }));
  assert.equal(dl.total, 2);
  const dv = dl.rows.find(x => x.id === drv.id);
  assert.equal(dv.manager_name, 'Mgr One'); assert.equal(dv.reg_number, 'GR-100-26'); assert.equal(dv.arrears, cv.arrears);

  // Arrears alert visible to that manager
  const al = ok(as(mtok, 'GET', '/alerts')).alerts;
  assert.ok(al.some(a => a.kind === 'arrears' && a.driver_id === drv.id));

  // Check-in: complaint opens, wants to stop raises alert, odometer bumps car
  const ci = ok(as(mtok, 'POST', '/checkins', { body: { driver_id: drv.id, date: today(), odometer: 5000, car_condition: 'good', intention: 'wants_to_stop', complaint: 'Too much traffic' } }));
  assert.equal(ci.complaint_status, 'open'); assert.equal(ci.vehicle_id, car.id);
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).current_odometer, 5000);
  assert.ok(ok(as(mtok, 'GET', '/alerts')).alerts.some(a => a.kind === 'wants_to_stop'));

  // Manager report (week)
  const rep = ok(as(mtok, 'GET', '/reports/manager', { query: { period: 'month', date: addDays(today(), -1) } }));
  assert.equal(rep.manager_id, mgr.id);
  const row = rep.rows.find(x => x.driver_id === drv.id);
  assert.ok(row && row.intention === 'wants_to_stop' && row.complaint === 'Too much traffic');
  assert.equal(rep.summary.wants_to_stop, 1);
  const day = ok(as(mtok, 'GET', '/reports/manager', { query: { period: 'day', date: start } }));
  assert.equal(day.rows.find(x => x.driver_id === drv.id).paid, 400);
  assert.equal(day.rows.find(x => x.driver_id === drv.id).momo_references, 'MP123');

  // Stopping: car freed, driver stopped; retrieved car accepts smaller deposit
  ok(as(admin, 'PUT', `/contracts/${c.id}`, { body: { status: 'stopped', end_reason: 'Quit' } }));
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).assigned_driver_id, null);
  assert.equal(ok(as(admin, 'GET', `/drivers/${drv.id}`)).status, 'stopped');
  assert.ok(ok(as(admin, 'GET', `/contracts/${c.id}`)).ended_on);
  const c2 = ok(as(admin, 'POST', '/contracts', { body: { ...base, driver_id: drv2.id, deposit_amount: 8000, deposit_reference: 'DEP003', start_date: today() } }));
  assert.equal(c2.car_condition, 'retrieved');
  assert.equal(as(admin, 'DELETE', `/contracts/${c.id}`).status, 409);
  assert.equal(as(admin, 'DELETE', `/drivers/${drv.id}`).status, 409);

  // Paying the full contract value completes it and hands the car over
  ok(as(admin, 'POST', '/payments', { body: { contract_id: c2.id, type: 'adjustment', work_date: today(), paid_on: today(), amount: ok(as(admin, 'GET', `/contracts/${c2.id}`)).contract_value, notes: 'test payoff' } }));
  assert.equal(ok(as(admin, 'GET', `/contracts/${c2.id}`)).status, 'completed');
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).status, 'handed_over');
});

test('daily hire rates for Cerio and BYD, no deposit needed', () => {
  const d1 = ok(as(admin, 'POST', '/drivers', { body: { name: 'EV One', status: 'active' } }));
  const d2 = ok(as(admin, 'POST', '/drivers', { body: { name: 'EV Two', status: 'active' } }));
  const cerio = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'EV-1', make: 'Cerio', model: 'EV', type: 'car', fuel_type: 'electric', status: 'active' } }));
  const byd = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'EV-2', make: 'BYD', model: 'Dolphin', type: 'car', fuel_type: 'electric', status: 'active' } }));
  const a = ok(as(admin, 'POST', '/contracts', { body: { driver_id: d1.id, vehicle_id: cerio.id, type: 'daily_hire', start_date: ctx.today(), status: 'active' } }));
  const b = ok(as(admin, 'POST', '/contracts', { body: { driver_id: d2.id, vehicle_id: byd.id, type: 'daily_hire', start_date: ctx.today(), status: 'active' } }));
  assert.equal(a.daily_rate, 500); assert.equal(b.daily_rate, 700);
  assert.equal(a.end_date, null); assert.equal(a.contract_value, null);
});

test('daily hire: any amount can be entered, and part-payments add up', () => {
  const d = ok(as(admin, 'POST', '/drivers', { body: { name: 'Part Payer', status: 'active' } }));
  const car = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'PP-1', make: 'BYD', model: 'Dolphin', type: 'car', fuel_type: 'electric', status: 'active' } }));
  const day = ctx.addDays(ctx.today(), -1);
  const c = ok(as(admin, 'POST', '/contracts', { body: { driver_id: d.id, vehicle_id: car.id, type: 'daily_hire', start_date: day, status: 'active' } }));
  ok(as(admin, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: day, paid_on: ctx.today(), amount: 300, momo_reference: 'PP-A' } }));
  ok(as(admin, 'POST', '/payments', { body: { contract_id: c.id, type: 'daily', work_date: day, paid_on: ctx.today(), amount: 250, momo_reference: 'PP-B' } }));
  const after = ok(as(admin, 'GET', `/contracts/${c.id}`));
  assert.equal(after.paid_total, 550);
  assert.equal(after.arrears, ctx.isPayDay(day, 'mon_sat') ? 150 : -550);
});

test('a car marked with a driver (no contract) still shows on the driver', () => {
  const d = ok(as(admin, 'POST', '/drivers', { body: { name: 'Loose Link', status: 'active', manager_id: 1 } }));
  const car = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'LL-1', make: 'Toyota', model: 'Vitz', type: 'car', fuel_type: 'petrol', status: 'active', assigned_driver_id: d.id } }));
  const dv = ok(as(admin, 'GET', `/drivers/${d.id}`));
  assert.equal(dv.reg_number, 'LL-1'); assert.equal(dv.car_without_contract, true);
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).has_contract, false);
  ok(as(admin, 'POST', '/contracts', { body: { driver_id: d.id, vehicle_id: car.id, type: 'daily_hire', start_date: ctx.today(), status: 'active', daily_rate: 450 } }));
  const after = ok(as(admin, 'GET', `/drivers/${d.id}`));
  assert.equal(after.car_without_contract, false); assert.equal(after.contract_type, 'daily_hire');
  assert.equal(ok(as(admin, 'GET', `/vehicles/${car.id}`)).has_contract, true);
});

test('drivers keep their work arrangement', () => {
  const d = ok(as(admin, 'POST', '/drivers', { body: { name: 'Arr Driver', status: 'active', arrangement: 'daily_hire' } }));
  assert.equal(d.arrangement, 'daily_hire');
  assert.equal(as(admin, 'POST', '/drivers', { body: { name: 'Bad Arr', status: 'active', arrangement: 'rent' } }).status, 422);
  assert.ok(ok(as(admin, 'GET', '/drivers', { query: { arrangement: 'daily_hire', limit: 500 } })).rows.some(x => x.id === d.id));
  const car = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: 1, reg_number: 'AR-1', make: 'Toyota', model: 'Vitz', type: 'car', fuel_type: 'petrol', status: 'active' } }));
  ok(as(admin, 'POST', '/contracts', { body: { driver_id: d.id, vehicle_id: car.id, type: 'work_and_pay', start_date: ctx.today(), status: 'active', deposit_amount: 15000, deposit_reference: 'ARR-DEP-1' } }));
  assert.equal(ok(as(admin, 'GET', `/drivers/${d.id}`)).arrangement, 'work_and_pay', 'the contract decides once there is one');
});

test('missing sheet columns are added automatically after a code update', () => {
  const sh = book.getSheetByName('drivers');
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const at = header.indexOf('arrangement');
  // Make the tab look like it did before the arrangement column existed.
  const all = sh.getDataRange().getValues().map(r => r.filter((_, j) => j !== at).concat(['']));
  sh.getRange(1, 1, all.length, all[0].length).setValues(all);
  freshRun();
  const d = ok(as(admin, 'GET', '/drivers', { query: { q: 'Arr Driver' } })).rows[0];
  assert.equal(d.name, 'Arr Driver');
  ok(as(admin, 'PUT', `/drivers/${d.id}`, { body: { phone: '0240000001' } }));
  const again = ok(as(admin, 'GET', `/drivers/${d.id}`));
  assert.equal(again.phone, '0240000001'); assert.equal(again.name, 'Arr Driver'); assert.equal(again.status, 'active');
  assert.ok(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].includes('arrangement'));
});

test('payDays counts Monday–Saturday', () => {
  assert.equal(ctx.payDays('2026-11-02', '2026-11-08', 'mon_sat'), 6); // Mon..Sun
  assert.equal(ctx.payDays('2026-11-08', '2026-11-08', 'mon_sat'), 0); // Sunday
  assert.equal(ctx.payDays('2026-11-01', '2026-11-30', 'mon_sat'), 25);
  assert.equal(ctx.payDays('2026-11-01', '2026-11-30', 'every_day'), 30);
});

test('cars need a manager with the manager role', () => {
  assert.equal(as(admin, 'POST', '/vehicles', { body: { reg_number: 'NM-1', make: 'Kia', model: 'Rio', type: 'car', fuel_type: 'petrol', status: 'active' } }).details.manager_id, 'Required');
  const viewerUser = ok(as(admin, 'GET', '/users')).rows.find(u => u.role === 'viewer');
  assert.ok(as(admin, 'POST', '/vehicles', { body: { manager_id: viewerUser.id, reg_number: 'NM-1', make: 'Kia', model: 'Rio', type: 'car', fuel_type: 'petrol', status: 'active' } }).details.manager_id);
  const mgr = ok(as(admin, 'POST', '/users', { body: { name: 'Car Mgr', email: 'cm@x.com', password: 'manager123', role: 'manager' } }));
  const car = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: mgr.id, reg_number: 'NM-1', make: 'Kia', model: 'Rio', type: 'car', fuel_type: 'petrol', status: 'active', insurance_expiry: '2000-01-01' } }));
  assert.equal(car.manager_name, 'Car Mgr');
  assert.equal(ok(as(admin, 'GET', '/vehicles', { query: { manager_id: mgr.id } })).total, 1);
  const mt = ok(call('POST', '/auth/login', { body: { email: 'cm@x.com', password: 'manager123' } })).token;
  assert.ok(ok(as(mt, 'GET', '/alerts')).alerts.some(a => a.vehicle_id === car.id && a.kind === 'insurance'));
  const rep = ok(as(mt, 'GET', '/reports/manager', { query: { period: 'week' } }));
  assert.ok(rep.idle_cars.some(c => c.vehicle_id === car.id));
  // a driver without a manager picks up the car's manager when given the car
  const drv = ok(as(admin, 'POST', '/drivers', { body: { name: 'No Mgr', status: 'active' } }));
  ok(as(admin, 'POST', '/contracts', { body: { driver_id: drv.id, vehicle_id: car.id, type: 'daily_hire', start_date: ctx.today(), status: 'active', daily_rate: 450 } }));
  assert.equal(ok(as(admin, 'GET', `/drivers/${drv.id}`)).manager_id, mgr.id);
});

test('Ghana Card numbers use GHA-XXXXXXXXX-X and are unique', () => {
  const a = ok(as(admin, 'POST', '/drivers', { body: { name: 'Card One', status: 'active', id_number: 'gha 123456789 0' } }));
  assert.equal(a.id_number, 'GHA-123456789-0');
  assert.equal(as(admin, 'POST', '/drivers', { body: { name: 'Card Two', status: 'active', id_number: 'GHA-12345-6' } }).details.id_number, 'Use the Ghana Card format GHA-123456789-0');
  assert.match(as(admin, 'POST', '/drivers', { body: { name: 'Card Three', status: 'active', id_number: 'GHA1234567890' } }).details.id_number, /already used by Card One/);
  assert.equal(ok(as(admin, 'GET', '/drivers', { query: { q: 'GHA-123456789' } })).total, 1);
});

test('only admins see every car; viewers see none', () => {
  const vt = ok(call('POST', '/auth/login', { body: { email: 'v@x.com', password: 'newpass123' } })).token;
  assert.equal(ok(as(vt, 'GET', '/vehicles')).total, 0);
  assert.equal(ok(as(vt, 'GET', '/dashboard')).fleet_total, 0);
  assert.ok(ok(as(admin, 'GET', '/vehicles')).total > 0);
});

test('managers only see and change their own group', () => {
  const mA = ok(as(admin, 'POST', '/users', { body: { name: 'Group A', email: 'ga@x.com', password: 'manager123', role: 'manager' } }));
  const mB = ok(as(admin, 'POST', '/users', { body: { name: 'Group B', email: 'gb@x.com', password: 'manager123', role: 'manager' } }));
  const ta = ok(call('POST', '/auth/login', { body: { email: 'ga@x.com', password: 'manager123' } })).token;
  const tb = ok(call('POST', '/auth/login', { body: { email: 'gb@x.com', password: 'manager123' } })).token;
  const carA = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: mA.id, reg_number: 'AA-1', make: 'Cerio', model: 'EV', type: 'car', fuel_type: 'electric', status: 'active' } }));
  const carB = ok(as(admin, 'POST', '/vehicles', { body: { manager_id: mB.id, reg_number: 'BB-1', make: 'BYD', model: 'EV', type: 'car', fuel_type: 'electric', status: 'active' } }));
  const drvA = ok(as(ta, 'POST', '/drivers', { body: { name: 'Driver A', status: 'active' } }));
  assert.equal(drvA.manager_id, mA.id, 'a manager’s new driver joins their group');
  const drvB = ok(as(tb, 'POST', '/drivers', { body: { name: 'Driver B', status: 'active' } }));

  // lists are limited
  const carsA = ok(as(ta, 'GET', '/vehicles', { query: { limit: 500 } })).rows;
  assert.deepEqual(carsA.map(v => v.reg_number), ['AA-1']);
  assert.equal(ok(as(ta, 'GET', '/vehicles', { query: { manager_id: 'all', limit: 500 } })).total, 1);
  assert.deepEqual(ok(as(ta, 'GET', '/drivers', { query: { limit: 500 } })).rows.map(d => d.name), ['Driver A']);
  assert.ok(ok(as(admin, 'GET', '/vehicles', { query: { limit: 500 } })).total > 2, 'admin still sees everything');

  // single records, edits and deletes in another group look like they don't exist
  assert.equal(as(ta, 'GET', `/vehicles/${carB.id}`).status, 404);
  assert.equal(as(ta, 'GET', `/drivers/${drvB.id}`).status, 404);
  assert.equal(as(ta, 'PUT', `/vehicles/${carB.id}`, { body: { color: 'Red' } }).status, 404);
  assert.equal(as(ta, 'DELETE', `/drivers/${drvB.id}`).status, 404);
  assert.equal(as(ta, 'GET', `/vehicles/${carB.id}/summary`).status, 404);

  // can't move own car to another manager, or create a car for someone else
  assert.equal(as(ta, 'PUT', `/vehicles/${carA.id}`, { body: { manager_id: mB.id } }).status, 403);
  assert.equal(as(ta, 'POST', '/vehicles', { body: { manager_id: mB.id, reg_number: 'AA-2', make: 'Kia', model: 'Rio', type: 'car', fuel_type: 'petrol', status: 'active' } }).status, 403);
  const own = ok(as(ta, 'POST', '/vehicles', { body: { reg_number: 'AA-2', make: 'Kia', model: 'Rio', type: 'car', fuel_type: 'petrol', status: 'active' } }));
  assert.equal(own.manager_id, mA.id);

  // contracts and payments
  assert.equal(as(ta, 'POST', '/contracts', { body: { driver_id: drvA.id, vehicle_id: carB.id, type: 'daily_hire', start_date: ctx.today(), status: 'active' } }).status, 403);
  assert.equal(as(admin, 'POST', '/contracts', { body: { driver_id: drvA.id, vehicle_id: carB.id, type: 'daily_hire', start_date: ctx.today(), status: 'active' } }).status, 422, 'car and driver must be in the same group');
  const cA = ok(as(ta, 'POST', '/contracts', { body: { driver_id: drvA.id, vehicle_id: carA.id, type: 'daily_hire', start_date: ctx.addDays(ctx.today(), -3), status: 'active' } }));
  const cB = ok(as(tb, 'POST', '/contracts', { body: { driver_id: drvB.id, vehicle_id: carB.id, type: 'daily_hire', start_date: ctx.addDays(ctx.today(), -3), status: 'active' } }));
  assert.equal(as(ta, 'POST', '/payments', { body: { contract_id: cB.id, type: 'daily', work_date: cB.start_date, paid_on: ctx.today(), amount: 700, momo_reference: 'GRP-X1' } }).status, 403);
  ok(as(tb, 'POST', '/payments', { body: { contract_id: cB.id, type: 'daily', work_date: cB.start_date, paid_on: ctx.today(), amount: 700, momo_reference: 'GRP-B1' } }));
  assert.equal(ok(as(ta, 'GET', '/payments', { query: { limit: 500 } })).rows.filter(p => p.momo_reference === 'GRP-B1').length, 0);
  assert.equal(ok(as(ta, 'GET', '/contracts', { query: { limit: 500 } })).rows.every(c => c.vehicle_id !== carB.id), true);

  // reports, dashboard, alerts and the manager list are limited too
  const rep = ok(as(ta, 'GET', '/reports/manager', { query: { period: 'week', manager_id: 'all' } }));
  assert.equal(rep.manager_id, mA.id);
  assert.ok(rep.rows.every(r => r.vehicle_id !== carB.id));
  const dash = ok(as(ta, 'GET', '/dashboard', { query: { manager_id: 'all' } }));
  assert.equal(dash.manager_id, mA.id);
  assert.equal(dash.fleet_total, 2);
  assert.ok(ok(as(ta, 'GET', '/alerts', { query: { manager_id: 'all' } })).alerts.every(a => a.manager_id === mA.id));
  assert.deepEqual(ok(as(ta, 'GET', '/managers')).rows.map(u => u.name), ['Group A']);
  assert.ok(ok(as(ta, 'GET', '/reports/vehicles')).rows.every(r => r.vehicle_id !== carB.id));
  assert.ok(ok(as(ta, 'GET', '/audit')).rows.every(a => a.user_id === mA.id));
  assert.ok(cA.id);

  // moving a car to another manager takes its driver along (and the other way round)
  ok(as(admin, 'PUT', `/vehicles/${carA.id}`, { body: { manager_id: mB.id } }));
  assert.equal(ok(as(admin, 'GET', `/drivers/${drvA.id}`)).manager_id, mB.id);
  ok(as(admin, 'PUT', `/drivers/${drvA.id}`, { body: { manager_id: mA.id } }));
  assert.equal(ok(as(admin, 'GET', `/vehicles/${carA.id}`)).manager_id, mA.id);
});

test('demo data and dashboard', () => {
  ctx.loadDemoData();
  const d = ok(as(admin, 'GET', '/dashboard'));
  assert.equal(d.fleet_total, 21);
  assert.equal(d.collections.active_contracts, 20);
  assert.equal(d.collections.daily.length, 14);
  assert.ok(d.collections.arrears_total > 0);
  assert.ok(d.collections.top_arrears.length > 0);
  assert.equal(d.available_cars.length, 1);
  assert.equal(d.cars_without_manager, 0);
  assert.ok(ok(as(admin, 'GET', '/vehicles', { query: { limit: 100 } })).rows.every(v => v.manager_name));
  assert.ok(d.alert_counts.total > 0);
  const mtok = ok(call('POST', '/auth/login', { body: { email: 'manager@fleet.local', password: 'demo12345' } })).token;
  const rep = ok(as(mtok, 'GET', '/reports/manager', { query: { period: 'week' } }));
  assert.ok(rep.rows.length >= 6 && rep.rows.every(r => r.manager_name === 'Samuel Adjei'));
  assert.ok(rep.summary.expected > 0 && rep.summary.collection_rate > 50);
  const all = ok(as(admin, 'GET', '/reports/manager', { query: { period: 'month', manager_id: 'all' } }));
  assert.equal(all.by_manager.length, 3);
  const contracts = ok(as(admin, 'GET', '/contracts', { query: { limit: 100 } })).rows;
  assert.equal(contracts.filter(c => c.car_condition === 'retrieved' && c.status === 'active').length, 2);
  const good = contracts.find(c => c.driver_name === 'Kwame Asante');
  assert.ok(Math.abs(good.arrears) <= 1200, `good payer arrears ${good.arrears}`);
  const bad = contracts.find(c => c.driver_name === 'Michael Agyei');
  assert.ok(bad.days_behind >= 3, `bad payer behind ${bad.days_behind}`);
});
