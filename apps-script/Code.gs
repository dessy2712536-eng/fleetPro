/**
 * FleetPro backend for Google Sheets.
 *
 * This script lives inside your Google Sheet (Extensions → Apps Script).
 * Each tab in the Sheet is a table. The web app on GitHub Pages talks to this
 * script through its Web App URL.
 *
 * First-time setup: select `setup` in the toolbar and click Run.
 * Optional demo data: select `loadDemoData` and click Run (this wipes fleet data).
 */

// ============================================================================
// Schema
// ============================================================================

const VEHICLE_TYPES = ['car', 'suv', 'pickup', 'van', 'truck', 'bus', 'motorbike', 'equipment', 'other'];
const FUEL_TYPES = ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng', 'other'];
const EXPENSE_CATS = ['tolls', 'parking', 'insurance', 'registration', 'tyres', 'fines', 'cleaning', 'licensing', 'other'];
const MAINT_TYPES = ['service', 'repair', 'inspection', 'tyres', 'bodywork', 'other'];

const vehicleRef = { type: 'ref', table: 'vehicles', label: 'vehicle' };
/**
 * Why a driver didn't work on a pay day (the DEFAULT REASON list of the monthly CSR report).
 * Days the workshop or administration is responsible for are excused by default; driver days are still owed.
 * The older reasons (sick, workshop, …) are still accepted so earlier records stay valid.
 */
const OFF_REASONS = ['accident', 'major_repair', 'spare_parts', 'servicing', 'illness', 'personal_emergency', 'payment_default',
  'impoundment', 'platform_suspension', 'reconciliation', 'unassigned_car',
  'sick', 'workshop', 'maintenance', 'funeral', 'police', 'other'];
const BATCHES = ['1ST', '2ND', '3RD', 'EV'];
const driverRef = { type: 'ref', table: 'drivers', label: 'driver' };

/** Editable fields per table (validation spec). id/created_at/updated_at are added automatically. */
const FIELDS = {
  users: {
    name: { type: 'string', required: true, max: 100 },
    email: { type: 'string', required: true, max: 120 },
    role: { type: 'enum', values: ['admin', 'manager', 'viewer'], required: true },
    active: { type: 'bool', default: 1 },
    password_hash: { type: 'string', internal: true },
  },
  drivers: {
    name: { type: 'string', required: true, max: 100 },
    manager_id: { type: 'ref', table: 'users', label: 'manager' },
    phone: { type: 'string', max: 30 },
    momo_number: { type: 'string', max: 30 },
    id_number: { type: 'string', max: 40 },
    email: { type: 'string', max: 120 },
    license_number: { type: 'string', max: 40 },
    license_class: { type: 'string', max: 20 },
    license_expiry: { type: 'date' },
    hire_date: { type: 'date' },
    status: { type: 'enum', values: ['active', 'on_leave', 'stopped'], required: true },
    arrangement: { type: 'enum', values: ['work_and_pay', 'daily_hire'] },
    batch: { type: 'enum', values: BATCHES },
    notes: { type: 'string', max: 2000 },
  },
  vehicles: {
    reg_number: { type: 'string', required: true, max: 30 },
    make: { type: 'string', required: true, max: 60 },
    model: { type: 'string', required: true, max: 60 },
    year: { type: 'int', min: 1950, max: 2100 },
    type: { type: 'enum', values: VEHICLE_TYPES, required: true },
    fuel_type: { type: 'enum', values: FUEL_TYPES, required: true },
    vin: { type: 'string', max: 40 },
    color: { type: 'string', max: 30 },
    status: { type: 'enum', values: ['active', 'in_maintenance', 'inactive', 'handed_over', 'disposed'], required: true },
    current_odometer: { type: 'number', min: 0, default: 0 },
    purchase_date: { type: 'date' },
    purchase_price: { type: 'number', min: 0 },
    insurance_expiry: { type: 'date' },
    roadworthy_expiry: { type: 'date' },
    registration_expiry: { type: 'date' },
    assigned_driver_id: driverRef,
    manager_id: { type: 'ref', table: 'users', label: 'manager', required: true },
    notes: { type: 'string', max: 2000 },
  },
  trips: {
    vehicle_id: Object.assign({}, vehicleRef, { required: true }),
    driver_id: driverRef,
    start_time: { type: 'datetime', required: true },
    end_time: { type: 'datetime' },
    origin: { type: 'string', max: 200 },
    destination: { type: 'string', max: 200 },
    purpose: { type: 'string', max: 200 },
    start_odometer: { type: 'number', min: 0 },
    end_odometer: { type: 'number', min: 0 },
    status: { type: 'enum', values: ['planned', 'in_progress', 'completed', 'cancelled'], required: true },
    notes: { type: 'string', max: 2000 },
  },
  fuel_logs: {
    vehicle_id: Object.assign({}, vehicleRef, { required: true }),
    driver_id: driverRef,
    date: { type: 'date', required: true },
    liters: { type: 'number', required: true, min: 0.01 },
    cost: { type: 'number', required: true, min: 0 },
    odometer: { type: 'number', min: 0 },
    station: { type: 'string', max: 100 },
    full_tank: { type: 'bool', default: 1 },
    notes: { type: 'string', max: 1000 },
  },
  expenses: {
    vehicle_id: vehicleRef,
    date: { type: 'date', required: true },
    category: { type: 'enum', values: EXPENSE_CATS, required: true },
    amount: { type: 'number', required: true, min: 0 },
    vendor: { type: 'string', max: 100 },
    description: { type: 'string', max: 500 },
  },
  maintenance_schedules: {
    vehicle_id: Object.assign({}, vehicleRef, { required: true }),
    service_type: { type: 'string', required: true, max: 100 },
    interval_km: { type: 'number', min: 1 },
    interval_days: { type: 'int', min: 1 },
    last_done_date: { type: 'date' },
    last_done_odometer: { type: 'number', min: 0 },
    active: { type: 'bool', default: 1 },
    notes: { type: 'string', max: 1000 },
  },
  maintenance_records: {
    vehicle_id: Object.assign({}, vehicleRef, { required: true }),
    schedule_id: { type: 'ref', table: 'maintenance_schedules', label: 'schedule' },
    date: { type: 'date', required: true },
    odometer: { type: 'number', min: 0 },
    type: { type: 'enum', values: MAINT_TYPES, required: true },
    description: { type: 'string', required: true, max: 500 },
    vendor: { type: 'string', max: 100 },
    cost: { type: 'number', min: 0, default: 0 },
    status: { type: 'enum', values: ['scheduled', 'in_progress', 'completed', 'cancelled'], required: true },
    downtime_days: { type: 'number', min: 0 },
    notes: { type: 'string', max: 2000 },
  },
  contracts: {
    driver_id: Object.assign({}, driverRef, { required: true }),
    vehicle_id: Object.assign({}, vehicleRef, { required: true }),
    type: { type: 'enum', values: ['work_and_pay', 'daily_hire'], required: true },
    start_date: { type: 'date', required: true },
    end_date: { type: 'date' },
    daily_rate: { type: 'number', min: 1 },
    payment_days: { type: 'enum', values: ['mon_sat', 'every_day'], default: 'mon_sat' },
    total_price: { type: 'number', min: 1 },
    // existing_driver: was already driving for the company before FleetPro (their paperwork may predate the new/retrieved rule)
    onboarding: { type: 'enum', values: ['new_driver', 'existing_driver'] },
    deposit_amount: { type: 'number', min: 0 },
    deposit_reference: { type: 'string', max: 60 },
    deposit_date: { type: 'date' },
    status: { type: 'enum', values: ['active', 'completed', 'stopped'], required: true },
    ended_on: { type: 'date' },
    end_reason: { type: 'string', max: 500 },
    notes: { type: 'string', max: 2000 },
  },
  payments: {
    contract_id: { type: 'ref', table: 'contracts', label: 'contract', required: true },
    type: { type: 'enum', values: ['daily', 'waiver', 'adjustment'], required: true },
    work_date: { type: 'date', required: true },
    paid_on: { type: 'date', required: true },
    amount: { type: 'number', required: true },
    momo_reference: { type: 'string', max: 60 },
    momo_number: { type: 'string', max: 30 },
    recorded_by: { type: 'string', internal: true },
    notes: { type: 'string', max: 500 },
  },
  // A pay day the driver didn't work. Excused days aren't owed; the others still are.
  off_days: {
    contract_id: { type: 'ref', table: 'contracts', label: 'contract', required: true },
    date: { type: 'date', required: true },
    reason: { type: 'enum', values: OFF_REASONS, required: true },
    excused: { type: 'bool', default: 0 },
    note: { type: 'string', max: 500 },
    recorded_by: { type: 'string', internal: true },
  },
  checkins: {
    driver_id: Object.assign({}, driverRef, { required: true }),
    vehicle_id: vehicleRef,
    date: { type: 'date', required: true },
    odometer: { type: 'number', min: 0 },
    car_condition: { type: 'enum', values: ['good', 'needs_attention', 'in_workshop', 'accident', 'off_road'], required: true },
    intention: { type: 'enum', values: ['continue', 'undecided', 'wants_to_stop'], required: true },
    complaint: { type: 'string', max: 1000 },
    complaint_status: { type: 'enum', values: ['none', 'open', 'resolved'], default: 'none' },
    action_taken: { type: 'string', max: 1000 },
  },
  audit_log: {
    user_id: { type: 'int' }, user_name: { type: 'string' }, action: { type: 'string' },
    entity: { type: 'string' }, entity_id: { type: 'int' }, summary: { type: 'string' },
  },
};

const TABLES = Object.keys(FIELDS);
const columnsOf = t => ['id'].concat(Object.keys(FIELDS[t]), ['created_at', 'updated_at']);
const NUMERIC = { int: 1, number: 1, ref: 1, bool: 1 };

// ============================================================================
// Errors and helpers
// ============================================================================

function HttpError(status, message, details) {
  this.status = status; this.message = message; this.details = details;
}
const invalid = (field, msg) => new HttpError(422, 'Please fix the highlighted fields', { [field]: msg });

function tz() { return Session.getScriptTimeZone() || 'UTC'; }
function today() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd'); }
function nowStamp() { return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function round(n, d) { const p = Math.pow(10, d === undefined ? 2 : d); return Math.round(n * p) / p; }
function sum(arr, f) { return arr.reduce((s, x) => s + (Number(f(x)) || 0), 0); }

// ============================================================================
// Sheet storage
// ============================================================================

const _cache = {};

function ss() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

const _checked = {};
function sheetFor(table) {
  let sh = ss().getSheetByName(table);
  // A tab added in a newer version of FleetPro is created the first time it's needed.
  if (!sh && FIELDS[table]) {
    sh = ss().insertSheet(table);
    const cols = columnsOf(table);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#263035').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  }
  if (!sh) throw new HttpError(500, `Missing sheet tab "${table}". Run setup() in Apps Script.`);
  // After a script update a tab may be missing new columns. Add them before anything is written,
  // so updating the code never shifts data into the wrong columns, even if setup() wasn't re-run.
  if (!_checked[table] && FIELDS[table]) { _checked[table] = true; syncColumns(table, sh); }
  return sh;
}

function syncColumns(table, sh) {
  const cols = columnsOf(table);
  const lastCol = sh.getLastColumn();
  const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (existing.join('|') === cols.join('|')) return;
  if (sh.getLastRow() > 1 && existing.length) {
    const rows = readAll(table); // reads by the old header, so every value keeps its name
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    writeAll(table, rows);
  } else {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  }
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#263035').setFontColor('#ffffff');
}

/** Convert a raw cell to a typed value. Sheets may turn text into Dates, so normalise. */
function fromCell(v, type) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (type === 'datetime') return Utilities.formatDate(v, tz(), "yyyy-MM-dd'T'HH:mm");
    return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  }
  if (NUMERIC[type]) {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  return String(v);
}

function readAll(table) {
  if (_cache[table]) return _cache[table];
  const sh = sheetFor(table);
  const values = sh.getDataRange().getValues();
  const header = values[0] || [];
  const spec = FIELDS[table];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r[0] === '' || r[0] === null) continue;
    const o = {};
    header.forEach((h, j) => {
      const type = h === 'id' ? 'int' : spec[h] ? spec[h].type : 'string';
      o[h] = fromCell(r[j], type);
    });
    rows.push(o);
  }
  _cache[table] = rows;
  return rows;
}

const toCell = v => (v === null || v === undefined ? '' : String(v));

/** Rewrite a whole table (used for inserts/updates/deletes; tables are small enough). */
function writeAll(table, rows) {
  const sh = sheetFor(table);
  const cols = columnsOf(table);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn() || cols.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, cols.length).setNumberFormat('@')
      .setValues(rows.map(r => cols.map(c => toCell(r[c]))));
  }
  _cache[table] = rows;
}

function findById(table, id) { return readAll(table).find(r => r.id === Number(id)) || null; }

function insertRow(table, data) {
  const rows = readAll(table).slice();
  const id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const stamp = nowStamp();
  const row = Object.assign({ id }, data, { created_at: stamp, updated_at: stamp });
  const sh = sheetFor(table);
  const cols = columnsOf(table);
  sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(c => toCell(row[c]))]);
  rows.push(row);
  _cache[table] = rows;
  return row;
}

function updateRow(table, id, patch) {
  id = Number(id);
  const rows = readAll(table);
  const current = rows.find(r => r.id === id);
  if (!current) return null;
  const updated = Object.assign({}, current, patch, { updated_at: nowStamp() });
  // Write only the changed row: locate it by id in column A.
  const sh = sheetFor(table);
  const cols = columnsOf(table);
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  const idx = ids.findIndex(r => Number(r[0]) === id);
  if (idx < 0) {
    writeAll(table, rows.map(r => (r.id === id ? updated : r)));
  } else {
    sh.getRange(idx + 2, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(c => toCell(updated[c]))]);
    _cache[table] = rows.map(r => (r.id === id ? updated : r));
  }
  return updated;
}

function updateWhere(table, pred, patch) {
  let changed = false;
  const rows = readAll(table).map(r => { if (pred(r)) { changed = true; return Object.assign({}, r, patch); } return r; });
  if (changed) writeAll(table, rows);
}

function deleteWhere(table, pred) {
  const before = readAll(table);
  const after = before.filter(r => !pred(r));
  if (after.length !== before.length) writeAll(table, after);
}

// ============================================================================
// Settings (key/value tab)
// ============================================================================

const DEFAULT_SETTINGS = {
  company_name: 'My Fleet', currency: 'GHS', distance_unit: 'km', alert_days: '30',
  rate_work_and_pay: '400', rate_cerio: '500', rate_byd: '700', rate_other_daily: '500',
  contract_years: '4', deposit_min: '5000', deposit_new_car: '15000', arrears_alert_days: '3',
  // Work & pay price drivers pay to own each car model, e.g. {"Livan X3 Pro": 500000}
  model_prices: '{"Livan X3 Pro":500000}',
};

/** "Livan X3Pro", "LIVAN x3 pro" → "livanx3pro" so spellings match. */
function modelKey(make, model) { return String((make || '') + (model || '')).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Price to own this car on work & pay, from Settings → Car prices; null if none is set. */
function modelPrice(vehicle) {
  if (!vehicle) return null;
  let prices = {};
  try { prices = JSON.parse(getSettings().model_prices || '{}'); } catch (e) { prices = {}; }
  const want = modelKey(vehicle.make, vehicle.model);
  for (const name in prices) if (modelKey('', name) === want && Number(prices[name]) > 0) return Number(prices[name]);
  return null;
}

function getSettings() {
  if (_cache.__settings) return Object.assign({}, _cache.__settings);
  const out = Object.assign({}, DEFAULT_SETTINGS);
  const sh = ss().getSheetByName('settings');
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(r => { if (r[0]) out[r[0]] = String(r[1]); });
  _cache.__settings = out;
  return Object.assign({}, out);
}

function saveSettings(obj) {
  const sh = ss().getSheetByName('settings');
  const merged = Object.assign(getSettings(), obj);
  const rows = Object.keys(merged).map(k => [k, String(merged[k])]);
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
  _cache.__settings = merged;
  return Object.assign({}, merged);
}

// ============================================================================
// Validation
// ============================================================================

function validate(input, spec, partial) {
  const out = {};
  const errors = {};
  Object.keys(spec).forEach(name => {
    const f = spec[name];
    if (f.internal) return;
    let v = input[name];
    if (v === undefined && partial) return;
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (f.required) errors[name] = 'Required';
      else out[name] = f.default !== undefined ? f.default : (f.type === 'bool' ? 0 : null);
      return;
    }
    switch (f.type) {
      case 'string':
        v = String(v).trim();
        if (f.max && v.length > f.max) errors[name] = `Max ${f.max} characters`;
        if (f.required && !v) errors[name] = 'Required';
        break;
      case 'int': case 'number':
        v = Number(v);
        if (!isFinite(v)) { errors[name] = 'Must be a number'; break; }
        if (f.type === 'int') v = Math.trunc(v);
        if (f.min !== undefined && v < f.min) errors[name] = `Must be at least ${f.min}`;
        if (f.max !== undefined && v > f.max) errors[name] = `Must be at most ${f.max}`;
        break;
      case 'bool':
        v = (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
        break;
      case 'date':
        v = String(v).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) errors[name] = 'Use YYYY-MM-DD';
        break;
      case 'datetime':
        v = String(v).replace(' ', 'T').slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v) || isNaN(Date.parse(v))) errors[name] = 'Invalid date/time';
        break;
      case 'enum':
        v = String(v);
        if (f.values.indexOf(v) < 0) errors[name] = `Must be one of: ${f.values.join(', ')}`;
        break;
      case 'ref':
        v = Number(v);
        if (!findById(f.table, v)) errors[name] = `Unknown ${f.label}`;
        break;
    }
    out[name] = v;
  });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);
  return out;
}

// ============================================================================
// Auth (passwords hashed with salt; tokens signed with a secret kept in Script Properties)
// ============================================================================

const ROLE_RANK = { viewer: 1, manager: 2, admin: 3 };
const TOKEN_HOURS = 12;

function secret() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}
function hex(bytes) { return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }
function hashPassword(password, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '');
  let h = salt + ':' + password;
  for (let i = 0; i < 100; i++) h = hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return salt + '$' + h;
}
function checkPassword(password, stored) {
  if (!stored || stored.indexOf('$') < 0) return false;
  return hashPassword(password, stored.split('$')[0]) === stored;
}
function signToken(user) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ sub: user.id, exp: Date.now() + TOKEN_HOURS * 3600000 }));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret()));
  return payload + '.' + sig;
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) throw new HttpError(401, 'Not signed in');
  const parts = token.split('.');
  const expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret()));
  if (expected !== parts[1]) throw new HttpError(401, 'Session expired, please sign in again');
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if (payload.exp < Date.now()) throw new HttpError(401, 'Session expired, please sign in again');
  const user = findById('users', payload.sub);
  if (!user || !user.active) throw new HttpError(401, 'Account not found or disabled');
  return publicUser(user);
}
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, created_at: u.created_at }; }
function requireRole(user, min) {
  if (ROLE_RANK[user.role] < ROLE_RANK[min]) throw new HttpError(403, `This action needs ${min} access`);
}

function audit(user, action, entity, entityId, summary) {
  try {
    insertRow('audit_log', { user_id: user ? user.id : null, user_name: user ? user.name : null, action, entity, entity_id: entityId || null, summary: summary || null });
    const rows = readAll('audit_log');
    if (rows.length > 2000) writeAll('audit_log', rows.slice(rows.length - 1500)); // keep the log from growing forever
  } catch (e) { /* never block a request on logging */ }
}

// ============================================================================
// Joined views (what each list shows)
// ============================================================================

function maps() {
  const byId = t => { const m = {}; readAll(t).forEach(r => { m[r.id] = r; }); return m; };
  const m = { v: byId('vehicles'), d: byId('drivers'), s: byId('maintenance_schedules'), u: byId('users'), c: byId('contracts') };
  m.pay = {}; // payments grouped by contract
  readAll('payments').forEach(p => { (m.pay[p.contract_id] = m.pay[p.contract_id] || []).push(p); });
  m.activeByDriver = {}; m.activeByVehicle = {};
  readAll('contracts').forEach(c => {
    if (c.status === 'active') { m.activeByDriver[c.driver_id] = c; m.activeByVehicle[c.vehicle_id] = c; }
  });
  // Which drivers each car has had (for New / Retrieved).
  m.carDrivers = {};
  readAll('contracts').forEach(c => { (m.carDrivers[c.vehicle_id] = m.carDrivers[c.vehicle_id] || {})[c.driver_id] = 1; });
  // Cars marked with a driver directly on the car (no contract yet).
  m.carByDriver = {};
  readAll('vehicles').forEach(v => { if (v.assigned_driver_id && v.status !== 'disposed') m.carByDriver[v.assigned_driver_id] = v; });
  m.lastCheckin = {};
  readAll('checkins').forEach(ci => {
    const prev = m.lastCheckin[ci.driver_id];
    if (!prev || ci.date > prev.date || (ci.date === prev.date && ci.id > prev.id)) m.lastCheckin[ci.driver_id] = ci;
  });
  return m;
}

// ============================================================================
// Hire contracts: what is owed, paid and outstanding
// ============================================================================

/** Number of payable days between two dates (inclusive). Mon–Sat by default; Sundays are free. */
function payDays(from, to, mode) {
  if (!from || !to || from > to) return 0;
  const n = daysBetween(from, to) + 1;
  if (mode === 'every_day') return n;
  const dow = new Date(from + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  let count = Math.floor(n / 7) * 6;
  for (let i = 0; i < n % 7; i++) if ((dow + i) % 7 !== 0) count++;
  return count;
}
function isPayDay(date, mode) { return mode === 'every_day' || new Date(date + 'T00:00:00Z').getUTCDay() !== 0; }
const minDate = function () { return Array.prototype.slice.call(arguments).filter(Boolean).sort()[0] || null; };
const maxDate = function () { return Array.prototype.slice.call(arguments).filter(Boolean).sort().slice(-1)[0] || null; };

/** Last day a contract is (or was) payable. */
function contractLastDay(c) { return minDate(c.ended_on, c.end_date) || null; }

/** Work days whose payment is due by now: a day's money is due the following day, so up to yesterday. */
function dueThrough() { return addDays(today(), -1); }

const MONEY_TYPES = { daily: 1, adjustment: 1 };

/** Days off for one contract (indexed once per request). */
function offDaysFor(contractId) {
  const rows = readAll('off_days');
  if (!_cache.__offIdx || _cache.__offIdx.src !== rows) {
    const idx = {};
    rows.forEach(o => { (idx[o.contract_id] = idx[o.contract_id] || []).push(o); });
    _cache.__offIdx = { src: rows, idx };
  }
  return _cache.__offIdx.idx[contractId] || [];
}

function contractStats(c, payments) {
  payments = payments || [];
  const paid = round(sum(payments.filter(p => MONEY_TYPES[p.type]), p => p.amount));
  const offs = offDaysFor(c.id).filter(o => o.date >= c.start_date && o.date <= minDate(dueThrough(), contractLastDay(c)) && isPayDay(o.date, c.payment_days));
  const waived = round(sum(payments.filter(p => p.type === 'waiver'), p => p.amount) + offs.filter(o => o.excused).length * (c.daily_rate || 0));
  const rate = c.daily_rate || 0;
  const dueDays = payDays(c.start_date, minDate(dueThrough(), contractLastDay(c)), c.payment_days);
  const expected = round(dueDays * rate);
  const arrears = round(expected - paid - waived);
  // Price to own the car: set on the contract, else the model's price (Settings → Car prices), else daily rate × every pay day in the term.
  const total = c.type !== 'work_and_pay' ? null
    : Number(c.total_price) > 0 ? round(Number(c.total_price))
    : modelPrice(findById('vehicles', c.vehicle_id)) || (c.end_date ? round(payDays(c.start_date, c.end_date, c.payment_days) * rate) : null);
  const lastPay = payments.filter(p => MONEY_TYPES[p.type]).map(p => p.paid_on).sort().slice(-1)[0] || null;
  // Next work day not yet paid for: the day after the latest day covered by a payment or excused days.
  const covered = payments.map(p => {
    if (p.type !== 'waiver' || !rate) return p.work_date;
    let end = p.work_date; // an excused-days entry covers (amount ÷ daily rate) pay days from its work date
    for (let n = Math.round(p.amount / rate) - 1, i = 0; n > 0 && i < 60; i++) { end = addDays(end, 1); if (isPayDay(end, c.payment_days)) n--; }
    return end;
  }).concat(offDaysFor(c.id).map(o => o.date)).sort().slice(-1)[0];
  let next = covered ? addDays(covered, 1) : c.start_date;
  for (let i = 0; i < 7 && !isPayDay(next, c.payment_days); i++) next = addDays(next, 1);
  return {
    paid_total: paid, waived_total: waived, days_due: dueDays, expected_to_date: expected,
    arrears: arrears, days_behind: rate && arrears > 0 ? round(arrears / rate, 1) : 0,
    contract_value: total,
    price_source: c.type !== 'work_and_pay' ? null : Number(c.total_price) > 0 ? 'contract' : modelPrice(findById('vehicles', c.vehicle_id)) ? 'model' : 'daily_rate',
    remaining_balance: total != null ? round(Math.max(total - paid, 0)) : null,
    progress: total ? round(Math.min(paid / total, 1) * 100, 1) : null,
    last_payment_on: lastPay,
    next_unpaid_day: next,
  };
}

/** Was this car driven by someone else before this contract? (retrieved car vs new car) */
/**
 * Every car starts as NEW. Once it has been given to a driver, it becomes RETRIEVED for any
 * different driver who gets it after that. The same driver getting their own car back doesn't count.
 */
function isRetrievedCar(vehicleId, contractId, driverId) {
  return readAll('contracts').some(c => c.vehicle_id === vehicleId && c.id !== contractId
    && (!contractId || c.id < contractId) && (driverId == null || c.driver_id !== driverId));
}

function defaultRate(type, vehicle) {
  const st = getSettings();
  if (type === 'work_and_pay') return Number(st.rate_work_and_pay) || 400;
  const make = String((vehicle && vehicle.make) || '').toLowerCase();
  if (make.indexOf('byd') >= 0) return Number(st.rate_byd) || 700;
  if (make.indexOf('cerio') >= 0) return Number(st.rate_cerio) || 500;
  return Number(st.rate_other_daily) || 500;
}

function addYears(dateStr, years) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

const VIEWS = {
  vehicles: (r, m) => Object.assign({}, r, {
    driver_name: m.d[r.assigned_driver_id] ? m.d[r.assigned_driver_id].name : null,
    has_contract: !!m.activeByVehicle[r.id],
    // condition: what the car is now. next_condition: what it will be for the next (different) driver.
    condition: carCondition(r, m),
    next_condition: m.carDrivers[r.id] ? 'retrieved' : 'new',
    drivers_had: m.carDrivers[r.id] ? Object.keys(m.carDrivers[r.id]).length : 0,
    manager_name: m.u[r.manager_id] ? m.u[r.manager_id].name : null,
  }),
  drivers: (r, m) => {
    const c = m.activeByDriver[r.id];
    const st = c ? contractStats(c, m.pay[c.id]) : null;
    const ci = m.lastCheckin[r.id];
    return Object.assign({}, r, {
      manager_name: m.u[r.manager_id] ? m.u[r.manager_id].name : null,
      contract_id: c ? c.id : null, contract_type: c ? c.type : null,
      vehicle_id: c ? c.vehicle_id : (m.carByDriver[r.id] ? m.carByDriver[r.id].id : null),
      reg_number: c && m.v[c.vehicle_id] ? m.v[c.vehicle_id].reg_number : (m.carByDriver[r.id] ? m.carByDriver[r.id].reg_number : null),
      car_without_contract: !c && !!m.carByDriver[r.id],
      daily_rate: c ? c.daily_rate : null,
      arrears: st ? st.arrears : null, days_behind: st ? st.days_behind : null,
      remaining_balance: st ? st.remaining_balance : null, progress: st ? st.progress : null,
      last_payment_on: st ? st.last_payment_on : null,
      intention: ci ? ci.intention : null, last_checkin_on: ci ? ci.date : null,
    });
  },
  contracts: (r, m) => {
    const d = m.d[r.driver_id] || {}, v = m.v[r.vehicle_id] || {};
    return Object.assign({}, r, contractStats(r, m.pay[r.id]), {
      driver_name: d.name, manager_id: d.manager_id || null, manager_name: m.u[d.manager_id] ? m.u[d.manager_id].name : null,
      batch: d.batch || null, reg_number: v.reg_number, make: v.make, model: v.model,
      car_condition: Object.keys(m.c).some(k => m.c[k].vehicle_id === r.vehicle_id && m.c[k].id < r.id && m.c[k].driver_id !== r.driver_id) ? 'retrieved' : 'new',
    });
  },
  off_days: (r, m) => {
    const c = m.c[r.contract_id] || {}, d = m.d[c.driver_id] || {}, v = m.v[c.vehicle_id] || {};
    return Object.assign({}, r, {
      driver_id: c.driver_id, driver_name: d.name, manager_id: d.manager_id || null,
      vehicle_id: c.vehicle_id, reg_number: v.reg_number, daily_rate: c.daily_rate,
    });
  },
  payments: (r, m) => {
    const c = m.c[r.contract_id] || {}, d = m.d[c.driver_id] || {}, v = m.v[c.vehicle_id] || {};
    return Object.assign({}, r, {
      driver_id: c.driver_id, driver_name: d.name, manager_id: d.manager_id || null,
      manager_name: m.u[d.manager_id] ? m.u[d.manager_id].name : null,
      vehicle_id: c.vehicle_id, reg_number: v.reg_number, contract_type: c.type, daily_rate: c.daily_rate,
    });
  },
  checkins: (r, m) => {
    const d = m.d[r.driver_id] || {};
    return Object.assign({}, r, {
      driver_name: d.name, manager_id: d.manager_id || null, manager_name: m.u[d.manager_id] ? m.u[d.manager_id].name : null,
      reg_number: m.v[r.vehicle_id] ? m.v[r.vehicle_id].reg_number : null,
    });
  },
  trips: (r, m) => {
    const v = m.v[r.vehicle_id] || {};
    return Object.assign({}, r, {
      reg_number: v.reg_number, make: v.make, model: v.model,
      driver_name: m.d[r.driver_id] ? m.d[r.driver_id].name : null,
      distance: r.end_odometer != null && r.start_odometer != null ? round(r.end_odometer - r.start_odometer, 1) : null,
    });
  },
  fuel_logs: (r, m) => Object.assign({}, r, {
    reg_number: (m.v[r.vehicle_id] || {}).reg_number,
    driver_name: m.d[r.driver_id] ? m.d[r.driver_id].name : null,
    price_per_liter: r.liters ? round(r.cost / r.liters, 2) : null,
  }),
  expenses: (r, m) => Object.assign({}, r, { reg_number: m.v[r.vehicle_id] ? m.v[r.vehicle_id].reg_number : null }),
  maintenance_schedules: (r, m) => {
    const v = m.v[r.vehicle_id] || {};
    return Object.assign({}, r, {
      reg_number: v.reg_number, current_odometer: v.current_odometer,
      next_due_odometer: r.interval_km != null ? (r.last_done_odometer || 0) + r.interval_km : null,
      next_due_date: r.interval_days != null && r.last_done_date ? addDays(r.last_done_date, r.interval_days) : null,
    });
  },
  maintenance_records: (r, m) => Object.assign({}, r, {
    reg_number: (m.v[r.vehicle_id] || {}).reg_number,
    service_type: m.s[r.schedule_id] ? m.s[r.schedule_id].service_type : null,
  }),
};

// ============================================================================
// Resource definitions (list behaviour + business rules)
// ============================================================================

function bumpOdometer(vehicleId, reading) {
  if (reading == null || !isFinite(reading)) return;
  const v = findById('vehicles', vehicleId);
  if (v && (v.current_odometer || 0) < reading) updateRow('vehicles', v.id, { current_odometer: reading });
}

const RESOURCES = {
  vehicles: {
    table: 'vehicles', entity: 'Car',
    // Moving a car to another manager moves its current driver too, so they stay in one group.
    afterWrite: (row, prev) => {
      if (!prev || prev.manager_id === row.manager_id || !row.manager_id) return;
      readAll('contracts').filter(c => c.vehicle_id === row.id && c.status === 'active')
        .forEach(c => updateWhere('drivers', d => d.id === c.driver_id && d.manager_id !== row.manager_id, { manager_id: row.manager_id }));
    },
    search: ['reg_number', 'make', 'model', 'vin', 'driver_name', 'manager_name'],
    filters: { status: 'status', type: 'type', fuel_type: 'fuel_type', driver_id: 'assigned_driver_id', manager_id: 'manager_id', condition: 'condition' },
    sortable: ['reg_number', 'make', 'year', 'current_odometer', 'status', 'manager_name'],
    check: d => { requireManagerUser(d.manager_id); },
    defaultSort: ['reg_number', 'asc'],
    unique: 'reg_number',
    describe: r => `${r.reg_number} (${r.make} ${r.model})`,
    beforeDelete: id => {
      if (readAll('contracts').some(c => c.vehicle_id === id)) throw new HttpError(409, 'This car has contract and payment history. Set its status to Inactive or Disposed instead of deleting it.');
    },
    onDelete: id => {
      ['trips', 'fuel_logs', 'expenses', 'maintenance_records', 'maintenance_schedules'].forEach(t => deleteWhere(t, r => r.vehicle_id === id));
    },
  },
  drivers: {
    table: 'drivers', entity: 'Driver',
    // Moving a driver to another manager moves the car they are driving too.
    afterWrite: (row, prev) => {
      if (!prev || prev.manager_id === row.manager_id || !row.manager_id) return;
      readAll('contracts').filter(c => c.driver_id === row.id && c.status === 'active')
        .forEach(c => updateWhere('vehicles', v => v.id === c.vehicle_id && v.manager_id !== row.manager_id, { manager_id: row.manager_id }));
    },
    search: ['name', 'phone', 'momo_number', 'id_number', 'email', 'license_number', 'reg_number', 'manager_name'],
    filters: { status: 'status', manager_id: 'manager_id', intention: 'intention', arrangement: 'arrangement', batch: 'batch' },
    sortable: ['name', 'license_expiry', 'status', 'arrears', 'manager_name'],
    defaultSort: ['name', 'asc'],
    describe: r => r.name,
    prepare: d => { if (d.id_number) d.id_number = normalizeGhanaCard(d.id_number) || d.id_number; },
    check: (d, prev) => {
      requireManagerUser(d.manager_id);
      if (d.id_number) {
        if (!GHANA_CARD_RE.test(d.id_number)) throw invalid('id_number', 'Use the Ghana Card format GHA-123456789-0');
        const dup = readAll('drivers').find(x => x.id !== (prev ? prev.id : -1) && x.id_number === d.id_number);
        if (dup) throw invalid('id_number', `This Ghana Card number is already used by ${dup.name}`);
      }
    },
    beforeDelete: id => {
      if (readAll('contracts').some(c => c.driver_id === id)) throw new HttpError(409, 'This driver has contract and payment history. Set their status to Stopped instead of deleting them.');
    },
    onDelete: id => {
      updateWhere('vehicles', r => r.assigned_driver_id === id, { assigned_driver_id: null });
      updateWhere('trips', r => r.driver_id === id, { driver_id: null });
      updateWhere('fuel_logs', r => r.driver_id === id, { driver_id: null });
    },
  },
  trips: {
    table: 'trips', entity: 'Trip',
    search: ['reg_number', 'driver_name', 'origin', 'destination', 'purpose'],
    filters: { vehicle_id: 'vehicle_id', driver_id: 'driver_id', status: 'status' },
    dateColumn: 'start_time',
    sortable: ['start_time', 'distance', 'status'],
    defaultSort: ['start_time', 'desc'],
    check: (d, prev) => {
      if (d.start_odometer != null && d.end_odometer != null && d.end_odometer < d.start_odometer) throw invalid('end_odometer', 'Must be greater than start odometer');
      if (d.end_time && d.start_time && d.end_time < d.start_time) throw invalid('end_time', 'Must be after the start time');
      if (d.status === 'completed' && d.end_odometer == null) throw invalid('end_odometer', 'Required to complete a trip');
      if (d.status === 'in_progress') {
        const clash = readAll('trips').find(t => t.vehicle_id === d.vehicle_id && t.status === 'in_progress' && t.id !== (prev ? prev.id : -1));
        if (clash) throw new HttpError(409, 'This vehicle already has a trip in progress');
      }
    },
    afterWrite: row => bumpOdometer(row.vehicle_id, row.end_odometer != null ? row.end_odometer : row.start_odometer),
    describe: r => `${r.reg_number}: ${r.origin || '?'} → ${r.destination || '?'}`,
  },
  fuel: {
    table: 'fuel_logs', entity: 'Fuel log',
    search: ['reg_number', 'driver_name', 'station'],
    filters: { vehicle_id: 'vehicle_id', driver_id: 'driver_id' },
    dateColumn: 'date',
    sortable: ['date', 'cost', 'liters'],
    defaultSort: ['date', 'desc'],
    afterWrite: row => bumpOdometer(row.vehicle_id, row.odometer),
    describe: r => `${r.reg_number}: ${r.liters} L`,
  },
  expenses: {
    table: 'expenses', entity: 'Expense',
    search: ['reg_number', 'vendor', 'description'],
    filters: { vehicle_id: 'vehicle_id', category: 'category' },
    dateColumn: 'date',
    sortable: ['date', 'amount', 'category'],
    defaultSort: ['date', 'desc'],
    describe: r => `${r.category} ${r.amount}`,
  },
  'maintenance/schedules': {
    table: 'maintenance_schedules', entity: 'Service schedule',
    search: ['reg_number', 'service_type'],
    filters: { vehicle_id: 'vehicle_id', active: 'active' },
    sortable: [],
    defaultSort: ['reg_number', 'asc'],
    check: d => { if (d.interval_km == null && d.interval_days == null) throw invalid('interval_km', 'Set a km interval, a day interval, or both'); },
    describe: r => `${r.reg_number}: ${r.service_type}`,
    onDelete: id => updateWhere('maintenance_records', r => r.schedule_id === id, { schedule_id: null }),
  },
  'maintenance/records': {
    table: 'maintenance_records', entity: 'Maintenance record',
    search: ['reg_number', 'description', 'vendor'],
    filters: { vehicle_id: 'vehicle_id', status: 'status', type: 'type' },
    dateColumn: 'date',
    sortable: ['date', 'cost', 'status'],
    defaultSort: ['date', 'desc'],
    check: d => {
      if (d.schedule_id) {
        const s = findById('maintenance_schedules', d.schedule_id);
        if (s && s.vehicle_id !== d.vehicle_id) throw invalid('schedule_id', 'Schedule belongs to a different vehicle');
      }
    },
    afterWrite: row => {
      bumpOdometer(row.vehicle_id, row.odometer);
      if (row.status === 'completed' && row.schedule_id) {
        const s = findById('maintenance_schedules', row.schedule_id);
        if (s) {
          const patch = {};
          if (!s.last_done_date || s.last_done_date < row.date) patch.last_done_date = row.date;
          if (row.odometer != null && (s.last_done_odometer == null || s.last_done_odometer < row.odometer)) patch.last_done_odometer = row.odometer;
          if (Object.keys(patch).length) updateRow('maintenance_schedules', s.id, patch);
        }
      }
      syncVehicleStatus(row.vehicle_id);
    },
    describe: r => `${r.reg_number}: ${r.description}`,
  },
};

Object.assign(RESOURCES, {
  'off-days': {
    table: 'off_days', entity: 'Day off',
    search: ['driver_name', 'reg_number', 'reason', 'note'],
    filters: { contract_id: 'contract_id', driver_id: 'driver_id', vehicle_id: 'vehicle_id', manager_id: 'manager_id', reason: 'reason' },
    dateColumn: 'date',
    sortable: ['date', 'driver_name'],
    defaultSort: ['date', 'desc'],
    prepare: (d, prev, user) => { if (!prev) d.recorded_by = user ? user.name : null; },
    check: (d, prev) => {
      const c = findById('contracts', d.contract_id);
      if (!c) return;
      if (d.date < c.start_date) throw invalid('date', `The contract starts on ${c.start_date}`);
      const last = contractLastDay(c);
      if (last && d.date > last) throw invalid('date', `The contract ended on ${last}`);
      if (d.date > today()) throw invalid('date', 'This day hasn\'t happened yet');
      if (!isPayDay(d.date, c.payment_days)) throw invalid('date', 'Sundays are not pay days');
      if (readAll('off_days').some(o => o.contract_id === c.id && o.date === d.date && o.id !== (prev ? prev.id : -1))) {
        throw invalid('date', 'This day is already marked as a day off');
      }
    },
    describe: r => `${r.driver_name || 'Driver'} · ${r.date} · ${String(r.reason).replace(/_/g, ' ')}${r.excused ? ' (excused)' : ''}`,
  },
  contracts: {
    table: 'contracts', entity: 'Contract',
    search: ['driver_name', 'reg_number', 'deposit_reference', 'manager_name'],
    filters: { driver_id: 'driver_id', vehicle_id: 'vehicle_id', status: 'status', type: 'type', manager_id: 'manager_id' },
    dateColumn: 'start_date',
    sortable: ['start_date', 'arrears', 'remaining_balance', 'driver_name', 'status'],
    defaultSort: ['start_date', 'desc'],
    prepare: (d, prev) => {
      const merged = Object.assign({}, prev || {}, d);
      const vehicle = findById('vehicles', merged.vehicle_id);
      if (!prev && d.daily_rate == null) d.daily_rate = defaultRate(merged.type, vehicle);
      if (merged.type === 'work_and_pay' && !merged.end_date && merged.start_date) {
        d.end_date = addDays(addYears(merged.start_date, Number(getSettings().contract_years) || 4), -1);
      }
      if (merged.type === 'daily_hire' && d.end_date === undefined && !prev) d.end_date = null;
      if (merged.status !== 'active' && !merged.ended_on) d.ended_on = today();
      if (merged.status === 'active' && prev && prev.status !== 'active') d.ended_on = null;
    },
    check: (d, prev) => {
      const st = getSettings();
      const money = n => `${st.currency} ${Number(n).toLocaleString()}`;
      if (d.status === 'active') {
        const others = readAll('contracts').filter(c => c.status === 'active' && c.id !== (prev ? prev.id : -1));
        if (others.some(c => c.driver_id === d.driver_id)) throw invalid('driver_id', 'This driver already has an active contract');
        if (others.some(c => c.vehicle_id === d.vehicle_id)) throw invalid('vehicle_id', 'This car is already with another driver');
        const drv = findById('drivers', d.driver_id);
        if (drv && drv.status === 'stopped') throw invalid('driver_id', 'This driver is marked Stopped. Change their status first.');
      }
      if (d.end_date && d.start_date && d.end_date < d.start_date) throw invalid('end_date', 'Must be after the start date');
      {
        const car = findById('vehicles', d.vehicle_id), drv = findById('drivers', d.driver_id);
        if (car && drv && car.manager_id && drv.manager_id && car.manager_id !== drv.manager_id) {
          const name = id => (findById('users', id) || {}).name || 'another manager';
          throw invalid('driver_id', `This car is in ${name(car.manager_id)}'s group but the driver is in ${name(drv.manager_id)}'s. Move one of them so they match.`);
        }
      }
      if (d.type === 'work_and_pay') {
        const min = Number(st.deposit_min) || 0, newCar = Number(st.deposit_new_car) || 0;
        if (d.deposit_amount == null) throw invalid('deposit_amount', `Work & pay needs a security deposit (from ${money(min)})`);
        if (d.deposit_amount < min) throw invalid('deposit_amount', `The minimum deposit is ${money(min)}`);
        if (!d.deposit_reference) throw invalid('deposit_reference', 'Enter the MoMo reference for the deposit');
        if (d.onboarding !== 'existing_driver' && !isRetrievedCar(d.vehicle_id, prev ? prev.id : null, d.driver_id) && d.deposit_amount < newCar) {
          throw invalid('vehicle_id', `This is a new car: it needs a deposit of ${money(newCar)}. Deposits below that get a retrieved car.`);
        }
      }
      if (d.deposit_reference && !isCash(d.deposit_reference)) {
        const ref = String(d.deposit_reference).toLowerCase();
        const clash = readAll('payments').some(p => String(p.momo_reference || '').toLowerCase() === ref)
          || readAll('contracts').some(c => c.id !== (prev ? prev.id : -1) && String(c.deposit_reference || '').toLowerCase() === ref);
        if (clash) throw invalid('deposit_reference', 'This MoMo reference has already been recorded');
      }
    },
    afterWrite: (row, prev) => {
      const v = findById('vehicles', row.vehicle_id);
      if (row.status === 'active') {
        const drvM = findById('drivers', row.driver_id);
        if (drvM && v) {
          if (!drvM.manager_id && v.manager_id) updateRow('drivers', drvM.id, { manager_id: v.manager_id });
          else if (drvM.manager_id && !v.manager_id) updateRow('vehicles', v.id, { manager_id: drvM.manager_id });
        }
        if (v && (v.assigned_driver_id !== row.driver_id || v.status === 'inactive')) {
          updateRow('vehicles', v.id, { assigned_driver_id: row.driver_id, status: v.status === 'inactive' ? 'active' : v.status });
        }
        const drv = findById('drivers', row.driver_id);
        if (drv && (drv.status !== 'active' || drv.arrangement !== row.type)) updateRow('drivers', drv.id, { status: 'active', arrangement: row.type });
      } else if (!prev || prev.status === 'active') {
        if (v && v.assigned_driver_id === row.driver_id) {
          updateRow('vehicles', v.id, { assigned_driver_id: null, status: row.status === 'completed' && row.type === 'work_and_pay' ? 'handed_over' : v.status });
        }
        if (row.status === 'stopped') {
          const stillActive = readAll('contracts').some(c => c.driver_id === row.driver_id && c.status === 'active');
          if (!stillActive) updateWhere('drivers', r => r.id === row.driver_id, { status: 'stopped' });
        }
      }
    },
    beforeDelete: id => {
      if (readAll('payments').some(p => p.contract_id === id)) throw new HttpError(409, 'This contract has payments recorded. Stop the contract instead of deleting it.');
    },
    describe: r => `${r.driver_name} · ${r.reg_number} (${r.type === 'work_and_pay' ? 'work & pay' : 'daily hire'})`,
  },
  payments: {
    table: 'payments', entity: 'Payment',
    search: ['momo_reference', 'driver_name', 'reg_number', 'momo_number', 'notes'],
    filters: { contract_id: 'contract_id', driver_id: 'driver_id', vehicle_id: 'vehicle_id', manager_id: 'manager_id', type: 'type', work_date: 'work_date' },
    dateColumn: 'paid_on',
    sortable: ['paid_on', 'work_date', 'amount', 'driver_name'],
    defaultSort: ['paid_on', 'desc'],
    prepare: (d, prev, user) => { if (!prev) d.recorded_by = user ? user.name : null; },
    check: (d, prev) => {
      if (d.type === 'daily' && !d.momo_reference) throw invalid('momo_reference', 'Enter the MTN MoMo transaction reference');
      if (d.type === 'daily' && !(d.amount > 0)) throw invalid('amount', 'Must be more than 0');
      if (d.type === 'waiver' && !(d.amount > 0)) throw invalid('amount', 'Enter the amount being excused');
      if (d.type === 'waiver' && !d.notes) throw invalid('notes', 'Give a reason, e.g. car in workshop, public holiday');
      if (d.paid_on && d.work_date && d.paid_on < d.work_date && d.type === 'daily') throw invalid('paid_on', 'Payment date is before the work date');
      if (d.momo_reference && !isCash(d.momo_reference)) {
        const ref = String(d.momo_reference).toLowerCase();
        const clash = readAll('payments').some(p => p.id !== (prev ? prev.id : -1) && String(p.momo_reference || '').toLowerCase() === ref)
          || readAll('contracts').some(c => String(c.deposit_reference || '').toLowerCase() === ref);
        if (clash) throw invalid('momo_reference', 'This MoMo reference has already been recorded');
      }
      const c = findById('contracts', d.contract_id);
      if (c && d.work_date && d.work_date < c.start_date) throw invalid('work_date', `Contract starts on ${c.start_date}`);
      if (c && d.type === 'daily') {
        const already = sum(readAll('payments').filter(p => p.contract_id === c.id && p.work_date === d.work_date && p.type === 'daily' && p.id !== (prev ? prev.id : -1)), p => p.amount);
        // Part-payments for the same day are fine (e.g. 300 now, 200 later). Only a day that is
        // already fully paid is refused, so the same payment can't be entered twice by mistake.
        if (already >= c.daily_rate) {
          throw invalid('work_date', `This day is already fully paid (${already}). Choose the next unpaid day (${contractStats(c, readAll('payments').filter(p => p.contract_id === c.id)).next_unpaid_day}).`);
        }
      }
    },
    afterWrite: row => {
      // A work & pay car is paid off when payments reach the contract value: close it and hand the car over.
      const c = findById('contracts', row.contract_id);
      if (!c || c.type !== 'work_and_pay' || c.status !== 'active') return;
      const st = contractStats(c, readAll('payments').filter(p => p.contract_id === c.id));
      if (st.contract_value && st.paid_total >= st.contract_value) {
        const done = updateRow('contracts', c.id, { status: 'completed', ended_on: today(), end_reason: 'Fully paid – car handed over to driver' });
        RESOURCES.contracts.afterWrite(done, c);
      }
    },
    describe: r => `${r.driver_name} ${r.amount} (${r.momo_reference || r.type})`,
  },
  checkins: {
    table: 'checkins', entity: 'Driver check-in',
    search: ['driver_name', 'reg_number', 'complaint', 'action_taken', 'manager_name'],
    filters: { driver_id: 'driver_id', manager_id: 'manager_id', intention: 'intention', complaint_status: 'complaint_status', car_condition: 'car_condition', vehicle_id: 'vehicle_id' },
    dateColumn: 'date',
    sortable: ['date', 'driver_name', 'intention'],
    defaultSort: ['date', 'desc'],
    prepare: (d, prev) => {
      const merged = Object.assign({}, prev || {}, d);
      if (!merged.vehicle_id && merged.driver_id) {
        const c = readAll('contracts').find(x => x.driver_id === merged.driver_id && x.status === 'active');
        if (c) d.vehicle_id = c.vehicle_id;
      }
      if (merged.complaint && (!merged.complaint_status || merged.complaint_status === 'none')) d.complaint_status = 'open';
      if (!merged.complaint && merged.complaint_status === 'open') d.complaint_status = 'none';
    },
    afterWrite: row => {
      if (row.vehicle_id) bumpOdometer(row.vehicle_id, row.odometer);
      if (row.vehicle_id && (row.car_condition === 'in_workshop' || row.car_condition === 'off_road' || row.car_condition === 'accident')) {
        const v = findById('vehicles', row.vehicle_id);
        if (v && v.status === 'active') updateRow('vehicles', v.id, { status: 'in_maintenance' });
      }
    },
    describe: r => `${r.driver_name}: ${r.intention.replace(/_/g, ' ')}${r.complaint ? ' – complaint' : ''}`,
  },
});

/** New until the car has been given to a second driver, or its first driver has stopped. */
function carCondition(v, m) {
  const had = m.carDrivers[v.id] ? Object.keys(m.carDrivers[v.id]).length : 0;
  if (!had) return 'new';
  if (had > 1 || !m.activeByVehicle[v.id]) return 'retrieved';
  return 'new';
}

/** "CASH" (any case) marks money paid in cash. It has no transaction ID, so it may repeat. */
function isCash(ref) { return /^\s*cash\s*$/i.test(String(ref || '')); }

/** Ghana Card: GHA-, nine digits, a dash, then one check digit. */
const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;
/** "gha 1234567890", "GHA1234567890" or "123456789-0" → "GHA-123456789-0"; null if it isn't 10 digits. */
function normalizeGhanaCard(v) {
  const d = String(v || '').toUpperCase().replace(/^\s*GHA/, '').replace(/\D/g, '');
  return d.length === 10 ? `GHA-${d.slice(0, 9)}-${d.slice(9)}` : null;
}

/** A car's manager must be an active user with the Manager or Admin role. */
function requireManagerUser(id) {
  if (id == null) return;
  const u = findById('users', id);
  if (!u || !u.active || (u.role !== 'manager' && u.role !== 'admin')) throw invalid('manager_id', 'Choose a user with the Manager or Admin role');
}

function syncVehicleStatus(vehicleId) {
  const v = findById('vehicles', vehicleId);
  if (!v) return;
  const open = readAll('maintenance_records').some(r => r.vehicle_id === vehicleId && r.status === 'in_progress');
  if (open && v.status === 'active') updateRow('vehicles', v.id, { status: 'in_maintenance' });
  if (!open && v.status === 'in_maintenance') updateRow('vehicles', v.id, { status: 'active' });
}

// ---------- Generic list / get / save / delete ----------

function view(res, row, m) { return VIEWS[res.table](row, m || maps()); }

// ---------- Manager groups ----------
// A manager sees only their own group: the cars assigned to them and the drivers under them,
// plus everything attached to those (contracts, payments, check-ins, maintenance, expenses).
// Only admins see the whole fleet; every other account sees only its own group.

/** The group a user is limited to, or null for admins (who see everything). */
function scopeFor(user) { return user && user.role !== 'admin' ? user.id : null; }

/** Which manager to report on: managers are always limited to themselves; admins may pick one. */
function pickManager(q, user) {
  const own = scopeFor(user);
  if (own) return own;
  return q && q.manager_id && q.manager_id !== 'all' ? (Number(q.manager_id) || null) : null;
}

/** Does this record belong to manager `mid`'s group? */
function inGroup(table, r, mid, m) {
  if (!r) return false;
  const carMgr = id => (m.v[id] || {}).manager_id;
  const drvMgr = id => (m.d[id] || {}).manager_id;
  switch (table) {
    case 'vehicles': return r.manager_id === mid;
    case 'drivers': return r.manager_id === mid;
    case 'contracts': return carMgr(r.vehicle_id) === mid || drvMgr(r.driver_id) === mid;
    case 'payments': case 'off_days': { const c = m.c[r.contract_id]; return !!c && (carMgr(c.vehicle_id) === mid || drvMgr(c.driver_id) === mid); }
    case 'checkins': return drvMgr(r.driver_id) === mid || (r.vehicle_id != null && carMgr(r.vehicle_id) === mid);
    case 'trips': case 'fuel_logs': return carMgr(r.vehicle_id) === mid || (r.driver_id != null && drvMgr(r.driver_id) === mid);
    default: return r.vehicle_id != null && carMgr(r.vehicle_id) === mid; // expenses, maintenance
  }
}

function notInGroup(res) { return new HttpError(404, `${res.entity} not found`); }

function list(res, q, user) {
  const m = maps();
  const mid = scopeFor(user);
  let rows = readAll(res.table).filter(r => !mid || inGroup(res.table, r, mid, m)).map(r => view(res, r, m));
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    rows = rows.filter(r => res.search.some(c => r[c] != null && String(r[c]).toLowerCase().indexOf(needle) >= 0));
  }
  Object.keys(res.filters || {}).forEach(param => {
    if (q[param] !== undefined && q[param] !== '' && q[param] !== null && q[param] !== 'all') {
      const col = res.filters[param];
      rows = rows.filter(r => String(r[col]) === String(q[param]));
    }
  });
  if (res.dateColumn) {
    if (q.from) rows = rows.filter(r => r[res.dateColumn] && r[res.dateColumn].slice(0, 10) >= String(q.from).slice(0, 10));
    if (q.to) rows = rows.filter(r => r[res.dateColumn] && r[res.dateColumn].slice(0, 10) <= String(q.to).slice(0, 10));
  }
  let key = res.defaultSort[0], dir = res.defaultSort[1];
  if (q.sort && res.sortable.indexOf(q.sort) >= 0) { key = q.sort; dir = q.dir === 'asc' ? 'asc' : 'desc'; }
  const sign = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === y) return b.id - a.id;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sign;
  });
  const total = rows.length;
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100000);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return { rows: rows.slice(offset, offset + limit), total, limit, offset };
}

function save(res, id, body, user) {
  requireRole(user, 'manager');
  const mid = scopeFor(user);
  const prev = id ? findById(res.table, id) : null;
  if (id && !prev) throw new HttpError(404, `${res.entity} not found`);
  if (mid && prev && !inGroup(res.table, prev, mid, maps())) throw notInGroup(res);
  // A manager's new cars and drivers go into their own group.
  if (mid && (res.table === 'vehicles' || res.table === 'drivers') && !prev && (body || {}).manager_id == null) body = Object.assign({}, body, { manager_id: mid });
  const data = validate(body || {}, FIELDS[res.table], !!id);
  if (res.prepare) res.prepare(data, prev, user);
  const merged = Object.assign({}, prev || {}, data);
  if (mid) {
    if ((res.table === 'vehicles' || res.table === 'drivers') && merged.manager_id !== mid) {
      throw new HttpError(403, `You can only manage ${res.table === 'vehicles' ? 'cars' : 'drivers'} in your own group. Ask an admin to move it to another manager.`);
    }
    const mp = maps();
    if (res.table !== 'vehicles' && res.table !== 'drivers' && !inGroup(res.table, merged, mid, mp)) {
      throw new HttpError(403, 'You can only record this for your own drivers and cars.');
    }
    // Any car or driver a record points to must also be in the manager's own group.
    if (merged.vehicle_id != null && (mp.v[merged.vehicle_id] || {}).manager_id !== mid) throw new HttpError(403, 'You can only use cars from your own group.');
    if (merged.driver_id != null && (mp.d[merged.driver_id] || {}).manager_id !== mid) throw new HttpError(403, 'You can only use drivers from your own group.');
  }
  if (res.unique && merged[res.unique]) {
    const dup = readAll(res.table).find(r => r.id !== (prev ? prev.id : -1) && String(r[res.unique]).toLowerCase() === String(merged[res.unique]).toLowerCase());
    if (dup) throw new HttpError(409, `A ${res.entity.toLowerCase()} with that value already exists`);
  }
  if (res.check) res.check(merged, prev);
  const row = id ? updateRow(res.table, id, data) : insertRow(res.table, data);
  if (res.afterWrite) res.afterWrite(row, prev);
  const out = view(res, findById(res.table, row.id));
  audit(user, id ? 'update' : 'create', res.entity, row.id, res.describe(out));
  return out;
}

function remove(res, id, user) {
  requireRole(user, 'manager');
  const row = findById(res.table, id);
  if (!row) throw new HttpError(404, `${res.entity} not found`);
  const mid = scopeFor(user);
  if (mid && !inGroup(res.table, row, mid, maps())) throw notInGroup(res);
  if (res.beforeDelete) res.beforeDelete(row.id);
  const described = res.describe(view(res, row));
  deleteWhere(res.table, r => r.id === row.id);
  if (res.onDelete) res.onDelete(row.id);
  audit(user, 'delete', res.entity, row.id, described);
  return { ok: true };
}

// ============================================================================
// Alerts, dashboard, reports
// ============================================================================

function computeAlerts() {
  const settings = getSettings();
  const windowDays = Number(settings.alert_days) || 30;
  const now = today();
  const horizon = addDays(now, windowDays);
  const alerts = [];

  const dateAlert = (date, base) => {
    if (!date || date > horizon) return;
    const days = daysBetween(now, date);
    alerts.push(Object.assign({}, base, {
      severity: days < 0 ? 'overdue' : days <= 7 ? 'urgent' : 'upcoming',
      due_date: date, days_left: days,
      detail: days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`,
    }));
  };

  readAll('vehicles').filter(v => v.status !== 'disposed').forEach(v => {
    const base = { category: 'document', vehicle_id: v.id, subject: v.reg_number, link: `/vehicles/${v.id}` };
    dateAlert(v.insurance_expiry, Object.assign({}, base, { kind: 'insurance', title: `Insurance – ${v.reg_number}` }));
    dateAlert(v.roadworthy_expiry, Object.assign({}, base, { kind: 'roadworthy', title: `Roadworthy certificate – ${v.reg_number}` }));
    dateAlert(v.registration_expiry, Object.assign({}, base, { kind: 'registration', title: `Registration – ${v.reg_number}` }));
  });
  readAll('drivers').filter(d => d.status !== 'inactive').forEach(d => {
    dateAlert(d.license_expiry, { category: 'document', kind: 'license', driver_id: d.id, subject: d.name, link: `/drivers/${d.id}`, title: `Driver's licence – ${d.name}` });
  });

  const vmap = maps().v;
  readAll('maintenance_schedules').forEach(s => {
    const v = vmap[s.vehicle_id];
    if (!s.active || !v || v.status === 'disposed') return;
    const base = { category: 'maintenance', kind: 'service_due', vehicle_id: s.vehicle_id, schedule_id: s.id, subject: v.reg_number, link: `/vehicles/${s.vehicle_id}`, title: `${s.service_type} – ${v.reg_number}` };
    let sev = null; const parts = []; let due_date = null; let km_left = null;
    if (s.interval_km) {
      km_left = Math.round((s.last_done_odometer || 0) + s.interval_km - (v.current_odometer || 0));
      const soon = Math.min(1000, s.interval_km * 0.1);
      if (km_left <= 0) { sev = 'overdue'; parts.push(`${(-km_left).toLocaleString()} km overdue`); }
      else if (km_left <= soon) { sev = 'urgent'; parts.push(`due in ${km_left.toLocaleString()} km`); }
    }
    if (s.interval_days) {
      if (!s.last_done_date) { sev = sev || 'upcoming'; parts.push('no service date on record'); }
      else {
        due_date = addDays(s.last_done_date, s.interval_days);
        const days = daysBetween(now, due_date);
        if (days < 0) { sev = 'overdue'; parts.push(`${-days} days overdue`); }
        else if (days <= 7) { sev = sev === 'overdue' ? sev : 'urgent'; parts.push(`due in ${days} days`); }
        else if (due_date <= horizon) { sev = sev || 'upcoming'; parts.push(`due ${due_date}`); }
      }
    }
    if (sev) alerts.push(Object.assign({}, base, { severity: sev, due_date, km_left, detail: parts.join(' · ') }));
  });

  readAll('maintenance_records').filter(r => r.status === 'scheduled' && r.date <= horizon).forEach(r => {
    const days = daysBetween(now, r.date);
    const reg = (vmap[r.vehicle_id] || {}).reg_number;
    alerts.push({
      category: 'maintenance', kind: 'booked_service', vehicle_id: r.vehicle_id, subject: reg, link: '/maintenance',
      title: `Booked: ${r.description} – ${reg}`, severity: days < 0 ? 'overdue' : days <= 7 ? 'urgent' : 'upcoming',
      due_date: r.date, days_left: days, detail: days < 0 ? `Was booked for ${r.date}, not marked done` : `Booked for ${r.date}`,
    });
  });

  // Payments and drivers
  const m = maps();
  const threshold = Number(settings.arrears_alert_days) || 3;
  const money = n => `${settings.currency} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  readAll('contracts').filter(c => c.status === 'active').forEach(c => {
    const st = contractStats(c, m.pay[c.id]);
    const d = m.d[c.driver_id] || {}, v = m.v[c.vehicle_id] || {};
    if (st.days_behind >= threshold) {
      alerts.push({
        category: 'payment', kind: 'arrears', driver_id: c.driver_id, vehicle_id: c.vehicle_id, subject: d.name, link: `/drivers/${c.driver_id}`,
        title: `Owing ${money(st.arrears)} – ${d.name}`,
        severity: st.days_behind >= threshold * 2 ? 'overdue' : 'urgent',
        detail: `${st.days_behind} days of payments behind on ${v.reg_number}${st.last_payment_on ? ` · last paid ${st.last_payment_on}` : ' · no payments yet'}`,
      });
    }
    if (c.type === 'work_and_pay' && c.end_date && c.end_date <= horizon) {
      alerts.push({
        category: 'payment', kind: 'contract_ending', driver_id: c.driver_id, vehicle_id: c.vehicle_id, subject: d.name, link: `/drivers/${c.driver_id}`,
        title: `Contract term ending – ${d.name}`, severity: c.end_date < now ? 'overdue' : 'upcoming', due_date: c.end_date,
        detail: st.remaining_balance > 0 ? `${money(st.remaining_balance)} still to pay on ${v.reg_number}` : `${v.reg_number} fully paid`,
      });
    }
    const ci = m.lastCheckin[c.driver_id];
    if (ci && ci.intention === 'wants_to_stop') {
      alerts.push({
        category: 'driver', kind: 'wants_to_stop', driver_id: c.driver_id, vehicle_id: c.vehicle_id, subject: d.name, link: `/drivers/${c.driver_id}`,
        title: `Wants to stop – ${d.name}`, severity: 'urgent', due_date: ci.date,
        detail: ci.complaint ? ci.complaint.slice(0, 120) : `Reported on ${ci.date}`,
      });
    }
  });
  readAll('checkins').filter(ci => ci.complaint_status === 'open').forEach(ci => {
    const d = m.d[ci.driver_id] || {};
    alerts.push({
      category: 'driver', kind: 'complaint', driver_id: ci.driver_id, vehicle_id: ci.vehicle_id, subject: d.name, link: '/checkins',
      title: `Open complaint – ${d.name}`, severity: daysBetween(ci.date, now) > 7 ? 'urgent' : 'upcoming', due_date: ci.date,
      detail: String(ci.complaint || '').slice(0, 120),
    });
  });

  // Tag each alert with the responsible manager (via the driver, or the car's current driver).
  // Driver alerts go to the driver's manager; car alerts go to the car's manager.
  alerts.forEach(a => {
    const fromDriver = a.driver_id && m.d[a.driver_id] ? m.d[a.driver_id].manager_id : null;
    const fromCar = a.vehicle_id && m.v[a.vehicle_id] ? m.v[a.vehicle_id].manager_id : null;
    a.manager_id = (a.category === 'payment' || a.category === 'driver' ? fromDriver || fromCar : fromCar || fromDriver) || null;
  });

  const rank = { overdue: 0, urgent: 1, upcoming: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  return alerts;
}

// ============================================================================
// Manager reports (daily / weekly / monthly) and collections
// ============================================================================

function periodRange(period, date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : dueThrough();
  if (period === 'week') {
    const dow = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
    const from = addDays(date, -dow);
    return { from, to: addDays(from, 6), label: `Week of ${from}` };
  }
  if (period === 'month') {
    const from = date.slice(0, 8) + '01';
    const to = addDays(addDays(from, 32).slice(0, 8) + '01', -1);
    return { from, to, label: date.slice(0, 7) };
  }
  return { from: date, to: date, label: date };
}

function managerReport(q, user) {
  const period = ['day', 'week', 'month'].indexOf(q.period) >= 0 ? q.period : 'day';
  const r = periodRange(period, q.date);
  const managerId = pickManager(q, user);
  const m = maps();
  const due = dueThrough();
  const settings = getSettings();
  const alerts = computeAlerts();

  const contracts = readAll('contracts').filter(c => {
    if (c.start_date > r.to) return false;
    const last = contractLastDay(c);
    if (last && last < r.from) return false;
    return !managerId || inGroup('contracts', c, managerId, m);
  });

  const rows = contracts.map(c => {
    const d = m.d[c.driver_id] || {}, v = m.v[c.vehicle_id] || {};
    const pays = m.pay[c.id] || [];
    const inPeriod = pays.filter(p => p.work_date >= r.from && p.work_date <= r.to);
    const daysDue = payDays(maxDate(r.from, c.start_date), minDate(r.to, due, contractLastDay(c)), c.payment_days);
    const expected = round(daysDue * c.daily_rate);
    const paid = round(sum(inPeriod.filter(p => MONEY_TYPES[p.type]), p => p.amount));
    const offInPeriod = offDaysFor(c.id).filter(o => o.excused && o.date >= r.from && o.date <= r.to && o.date <= due && isPayDay(o.date, c.payment_days));
    const waived = round(sum(inPeriod.filter(p => p.type === 'waiver'), p => p.amount) + offInPeriod.length * (c.daily_rate || 0));
    const st = contractStats(c, pays);
    const ci = m.lastCheckin[c.driver_id];
    const carAlerts = alerts.filter(a => a.vehicle_id === c.vehicle_id && a.category === 'maintenance' && a.severity !== 'upcoming');
    const docAlerts = alerts.filter(a => a.vehicle_id === c.vehicle_id && a.category === 'document' && a.severity !== 'upcoming');
    return {
      contract_id: c.id, driver_id: c.driver_id, driver_name: d.name, driver_phone: d.phone,
      manager_id: d.manager_id || null, manager_name: m.u[d.manager_id] ? m.u[d.manager_id].name : null,
      vehicle_id: c.vehicle_id, reg_number: v.reg_number, car: `${v.make || ''} ${v.model || ''}`.trim(),
      contract_type: c.type, contract_status: c.status, daily_rate: c.daily_rate,
      days_due: daysDue, expected, paid, waived, shortfall: round(expected - paid - waived),
      momo_references: inPeriod.filter(p => p.momo_reference).map(p => p.momo_reference).join(', '),
      arrears_total: st.arrears, days_behind: st.days_behind, remaining_balance: st.remaining_balance, progress: st.progress,
      last_payment_on: st.last_payment_on,
      vehicle_status: v.status, odometer: v.current_odometer,
      service_due: carAlerts.map(a => `${a.title.split(' – ')[0]}: ${a.detail}`).join('; ') || null,
      documents_due: docAlerts.map(a => `${a.title.split(' – ')[0]}: ${a.detail}`).join('; ') || null,
      last_checkin_on: ci ? ci.date : null, car_condition: ci ? ci.car_condition : null,
      intention: ci ? ci.intention : null, complaint: ci ? ci.complaint : null, complaint_status: ci ? ci.complaint_status : null,
    };
  }).sort((a, b) => String(a.manager_name || '').localeCompare(String(b.manager_name || '')) || b.shortfall - a.shortfall || String(a.driver_name).localeCompare(String(b.driver_name)));

  const summarise = list => {
    const expected = round(sum(list, x => x.expected)), paid = round(sum(list, x => x.paid)), waived = round(sum(list, x => x.waived));
    return {
      drivers: list.length, expected, collected: paid, waived, shortfall: round(expected - paid - waived),
      collection_rate: expected - waived > 0 ? round((paid / (expected - waived)) * 100, 1) : null,
      arrears_total: round(sum(list.filter(x => x.arrears_total > 0), x => x.arrears_total)),
      drivers_in_arrears: list.filter(x => x.days_behind >= 1).length,
      wants_to_stop: list.filter(x => x.intention === 'wants_to_stop' && x.contract_status === 'active').length,
      open_complaints: list.filter(x => x.complaint_status === 'open').length,
      service_due: list.filter(x => x.service_due).length,
      off_road: list.filter(x => x.vehicle_status === 'in_maintenance' || x.car_condition === 'off_road' || x.car_condition === 'in_workshop' || x.car_condition === 'accident').length,
    };
  };

  const byManager = {};
  rows.forEach(x => { const k = x.manager_id || 0; (byManager[k] = byManager[k] || []).push(x); });
  return {
    period, from: r.from, to: r.to, label: r.label, due_through: due, manager_id: managerId,
    manager_name: managerId && m.u[managerId] ? m.u[managerId].name : null,
    currency: settings.currency,
    summary: summarise(rows),
    by_manager: Object.keys(byManager).map(k => Object.assign({ manager_id: Number(k) || null, manager_name: (m.u[k] || {}).name || 'No manager' }, summarise(byManager[k]))),
    rows,
    idle_cars: readAll('vehicles').filter(v => (v.status === 'active' || v.status === 'in_maintenance') && !m.activeByVehicle[v.id] && (!managerId || v.manager_id === managerId)).map(v => ({
      vehicle_id: v.id, reg_number: v.reg_number, make: v.make, model: v.model, status: v.status,
      manager_name: m.u[v.manager_id] ? m.u[v.manager_id].name : null,
      service_due: alerts.filter(a => a.vehicle_id === v.id && a.category === 'maintenance' && a.severity !== 'upcoming').map(a => `${a.title.split(' – ')[0]}: ${a.detail}`).join('; ') || null,
    })),
    cars_without_manager: readAll('vehicles').filter(v => !v.manager_id && v.status !== 'disposed' && v.status !== 'handed_over').length,
  };
}

/** Expected vs collected for each of the last N days (by work date). */
function dailyCollections(days, managerId) {
  const m = maps();
  const end = dueThrough();
  const out = [];
  const contracts = readAll('contracts').filter(c => !managerId || inGroup('contracts', c, managerId, m));
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(end, -i);
    let expected = 0, collected = 0;
    contracts.forEach(c => {
      const last = contractLastDay(c);
      if (c.start_date <= day && (!last || last >= day) && isPayDay(day, c.payment_days) && !offDaysFor(c.id).some(o => o.excused && o.date === day)) expected += c.daily_rate || 0;
      collected += sum((m.pay[c.id] || []).filter(p => p.work_date === day && MONEY_TYPES[p.type]), p => p.amount);
    });
    out.push({ date: day, expected: round(expected), collected: round(collected) });
  }
  return out;
}

function collectionsSummary(managerId) {
  const m = maps();
  const now = today(), yesterday = dueThrough();
  const contracts = readAll('contracts').filter(c => !managerId || inGroup('contracts', c, managerId, m));
  const active = contracts.filter(c => c.status === 'active');
  const stats = active.map(c => Object.assign({ c }, contractStats(c, m.pay[c.id])));
  const ids = {}; contracts.forEach(c => { ids[c.id] = 1; });
  const payments = readAll('payments').filter(p => ids[p.contract_id] && MONEY_TYPES[p.type]);
  const yday = dailyCollections(1, managerId)[0];
  const unpaid = active.filter(c => c.start_date <= yesterday && isPayDay(yesterday, c.payment_days) &&
    !(m.pay[c.id] || []).some(p => p.work_date === yesterday) && !offDaysFor(c.id).some(o => o.excused && o.date === yesterday)).map(c => ({
      driver_id: c.driver_id, driver_name: (m.d[c.driver_id] || {}).name, reg_number: (m.v[c.vehicle_id] || {}).reg_number, daily_rate: c.daily_rate,
    }));
  return {
    collected_today: round(sum(payments.filter(p => p.paid_on === now), p => p.amount)),
    yesterday: { date: yesterday, expected: yday.expected, collected: yday.collected, unpaid },
    month_collected: round(sum(payments.filter(p => p.paid_on >= now.slice(0, 8) + '01'), p => p.amount)),
    arrears_total: round(sum(stats.filter(x => x.arrears > 0), x => x.arrears)),
    drivers_in_arrears: stats.filter(x => x.days_behind >= 1).length,
    active_contracts: active.length,
    work_and_pay: active.filter(c => c.type === 'work_and_pay').length,
    daily_hire: active.filter(c => c.type === 'daily_hire').length,
    deposits_held: round(sum(active, c => c.deposit_amount)),
    top_arrears: stats.filter(x => x.arrears > 0).sort((a, b) => b.arrears - a.arrears).slice(0, 6).map(x => ({
      driver_id: x.c.driver_id, driver_name: (m.d[x.c.driver_id] || {}).name, reg_number: (m.v[x.c.vehicle_id] || {}).reg_number,
      arrears: x.arrears, days_behind: x.days_behind, last_payment_on: x.last_payment_on,
    })),
    wants_to_stop: active.filter(c => m.lastCheckin[c.driver_id] && m.lastCheckin[c.driver_id].intention === 'wants_to_stop').length,
    open_complaints: readAll('checkins').filter(ci => ci.complaint_status === 'open' && (!managerId || inGroup('checkins', ci, managerId, m))).length,
    daily: dailyCollections(14, managerId),
  };
}

const inRange = (d, from, to) => d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

function vehicleReport(from, to, managerId) {
  const trips = readAll('trips'), fuel = readAll('fuel_logs'), recs = readAll('maintenance_records'), exps = readAll('expenses');
  return readAll('vehicles').filter(v => !managerId || v.manager_id === managerId).sort((a, b) => String(a.reg_number).localeCompare(String(b.reg_number))).map(v => {
    const t = trips.filter(x => x.vehicle_id === v.id && inRange(x.start_time, from, to));
    const done = t.filter(x => x.status === 'completed' && x.start_odometer != null && x.end_odometer != null);
    const f = fuel.filter(x => x.vehicle_id === v.id && inRange(x.date, from, to));
    const m = recs.filter(x => x.vehicle_id === v.id && x.status === 'completed' && inRange(x.date, from, to));
    const e = exps.filter(x => x.vehicle_id === v.id && inRange(x.date, from, to));
    const odos = [].concat(
      f.map(x => x.odometer), t.map(x => x.start_odometer), t.map(x => x.end_odometer),
      recs.filter(x => x.vehicle_id === v.id && inRange(x.date, from, to)).map(x => x.odometer),
    ).filter(x => x != null);
    const tripKm = sum(done, x => x.end_odometer - x.start_odometer);
    const odoKm = odos.length ? Math.max.apply(null, odos) - Math.min.apply(null, odos) : 0;
    const distance = round(Math.max(tripKm, odoKm), 1);
    const r = {
      vehicle_id: v.id, reg_number: v.reg_number, make: v.make, model: v.model, type: v.type, status: v.status,
      trips: done.length, distance_km: distance,
      fuel_liters: round(sum(f, x => x.liters)), fuel_cost: round(sum(f, x => x.cost)),
      maintenance_cost: round(sum(m, x => x.cost)), maintenance_jobs: m.length, downtime_days: round(sum(m, x => x.downtime_days), 1),
      other_cost: round(sum(e, x => x.amount)),
    };
    const total = r.fuel_cost + r.maintenance_cost + r.other_cost;
    r.total_cost = round(total);
    r.cost_per_km = distance > 0 ? round(total / distance) : null;
    r.km_per_liter = distance > 0 && r.fuel_liters > 0 ? round(distance / r.fuel_liters) : null;
    return r;
  });
}

function driverReport(from, to, managerId) {
  const trips = readAll('trips'), fuel = readAll('fuel_logs');
  return readAll('drivers').filter(d => !managerId || d.manager_id === managerId).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(d => {
    const t = trips.filter(x => x.driver_id === d.id && x.status === 'completed' && inRange(x.start_time, from, to));
    const f = fuel.filter(x => x.driver_id === d.id && inRange(x.date, from, to));
    return {
      driver_id: d.id, name: d.name, status: d.status, trips: t.length,
      distance_km: round(sum(t.filter(x => x.end_odometer != null && x.start_odometer != null), x => x.end_odometer - x.start_odometer), 1),
      fuel_liters: round(sum(f, x => x.liters)), fuel_cost: round(sum(f, x => x.cost)),
    };
  });
}

/** For reports limited to one manager: does this cost belong to one of their cars? */
function carFilter(managerId) {
  if (!managerId) return () => true;
  const mine = {};
  readAll('vehicles').forEach(v => { if (v.manager_id === managerId) mine[v.id] = 1; });
  return x => x.vehicle_id != null && !!mine[x.vehicle_id];
}

function monthlyCosts(from, to, managerId) {
  const ok = carFilter(managerId);
  const by = {};
  const add = (date, key, amt) => {
    if (!inRange(date, from, to)) return;
    const m = date.slice(0, 7);
    by[m] = by[m] || { month: m, fuel: 0, maintenance: 0, other: 0 };
    by[m][key] += Number(amt) || 0;
  };
  readAll('fuel_logs').filter(ok).forEach(x => add(x.date, 'fuel', x.cost));
  readAll('maintenance_records').filter(x => x.status === 'completed' && ok(x)).forEach(x => add(x.date, 'maintenance', x.cost));
  readAll('expenses').filter(ok).forEach(x => add(x.date, 'other', x.amount));
  const out = [];
  let y = Number(from.slice(0, 4)), mo = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${('0' + mo).slice(-2)}`;
    if (key > end) break;
    const r = by[key] || { month: key, fuel: 0, maintenance: 0, other: 0 };
    out.push({ month: key, fuel: round(r.fuel), maintenance: round(r.maintenance), other: round(r.other), total: round(r.fuel + r.maintenance + r.other) });
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

function categoryReport(from, to, managerId) {
  const ok = carFilter(managerId);
  const totals = {};
  const add = (k, a) => { totals[k] = (totals[k] || 0) + (Number(a) || 0); };
  readAll('fuel_logs').filter(x => ok(x) && inRange(x.date, from, to)).forEach(x => add('fuel', x.cost));
  readAll('maintenance_records').filter(x => ok(x) && x.status === 'completed' && inRange(x.date, from, to)).forEach(x => add('maintenance: ' + x.type, x.cost));
  readAll('expenses').filter(x => ok(x) && inRange(x.date, from, to)).forEach(x => add(x.category, x.amount));
  return Object.keys(totals).map(k => ({ category: k, amount: round(totals[k]) })).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
}

function range(q, defaultDays) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = re.test(q.to || '') ? q.to : today();
  const from = re.test(q.from || '') ? q.from : addDays(to, -(defaultDays || 90));
  return { from, to };
}

function dashboard(q, user) {
  const managerId = pickManager(q, user);
  const now = today();
  const monthStart = now.slice(0, 8) + '01';
  const prevEnd = addDays(monthStart, -1);
  const prevStart = prevEnd.slice(0, 8) + '01';
  const yearAgo = addDays(monthStart, -330).slice(0, 8) + '01';
  const allVehicles = readAll('vehicles');
  const vehicles = managerId ? allVehicles.filter(v => v.manager_id === managerId) : allVehicles;
  const count = (rows, key) => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});

  const spend = (from, to) => {
    const r = vehicleReport(from, to, managerId);
    const general = managerId ? 0 : sum(readAll('expenses').filter(x => x.vehicle_id == null && inRange(x.date, from, to)), x => x.amount);
    const o = {
      fuel: round(sum(r, x => x.fuel_cost)), maintenance: round(sum(r, x => x.maintenance_cost)),
      other: round(sum(r, x => x.other_cost) + general), distance_km: round(sum(r, x => x.distance_km), 0), liters: round(sum(r, x => x.fuel_liters)),
    };
    o.total = round(o.fuel + o.maintenance + o.other);
    return o;
  };

  const byType = count(vehicles.filter(v => v.status !== 'disposed'), 'type');
  const m = maps();
  const alerts = computeAlerts().filter(a => !managerId || a.manager_id === managerId);
  return {
    manager_id: managerId,
    collections: collectionsSummary(managerId),
    available_cars: vehicles.filter(v => v.status === 'active' && !m.activeByVehicle[v.id] && (!managerId || v.manager_id === managerId)).map(v => ({ id: v.id, reg_number: v.reg_number, make: v.make, model: v.model, manager_name: m.u[v.manager_id] ? m.u[v.manager_id].name : null })),
    cars_without_manager: scopeFor(user) ? 0 : allVehicles.filter(v => !v.manager_id && v.status !== 'disposed' && v.status !== 'handed_over').length,
    my_cars: managerId ? vehicles.filter(v => v.manager_id === managerId && v.status !== 'disposed' && v.status !== 'handed_over').length : null,
    fleet: count(vehicles, 'status'),
    fleet_total: vehicles.length,
    by_type: Object.keys(byType).map(k => ({ type: k, n: byType[k] })).sort((a, b) => b.n - a.n),
    drivers: count(readAll('drivers').filter(d => !managerId || d.manager_id === managerId), 'status'),
    this_month: spend(monthStart, now),
    last_month: spend(prevStart, prevEnd),
    monthly: monthlyCosts(yearAgo, now, managerId),
    top_vehicles: vehicleReport(addDays(now, -90), now, managerId).filter(v => v.total_cost > 0).sort((a, b) => b.total_cost - a.total_cost).slice(0, 5),
    active_trips: readAll('trips').filter(t => t.status === 'in_progress' && (!managerId || inGroup('trips', t, managerId, m))).map(t => VIEWS.trips(t, m)).sort((a, b) => String(b.start_time).localeCompare(String(a.start_time))),
    activity: readAll('audit_log').filter(a => !scopeFor(user) || a.user_id === user.id).slice(-8).reverse(),
    alerts: alerts.slice(0, 6),
    alert_counts: {
      total: alerts.length,
      overdue: alerts.filter(a => a.severity === 'overdue').length,
      urgent: alerts.filter(a => a.severity === 'urgent').length,
    },
  };
}

// ============================================================================
// Router
// ============================================================================

const USER_FIELDS = { name: FIELDS.users.name, email: FIELDS.users.email, role: FIELDS.users.role, active: FIELDS.users.active };
const SETTING_FIELDS = {
  company_name: { type: 'string', max: 100 }, currency: { type: 'string', max: 10 },
  distance_unit: { type: 'enum', values: ['km', 'mi'] }, alert_days: { type: 'int', min: 1, max: 365 },
  rate_work_and_pay: { type: 'number', min: 1 }, rate_cerio: { type: 'number', min: 1 }, rate_byd: { type: 'number', min: 1 },
  rate_other_daily: { type: 'number', min: 1 }, contract_years: { type: 'int', min: 1, max: 15 },
  deposit_min: { type: 'number', min: 0 }, deposit_new_car: { type: 'number', min: 0 }, arrears_alert_days: { type: 'int', min: 1, max: 60 },
  model_prices: { type: 'string', max: 5000 },
  logo: { type: 'string', max: 45000 },
};

function route(method, path, q, body, token) {
  path = '/' + String(path || '').replace(/^\/+|\/+$/g, '');
  q = q || {};

  if (path === '/health') return { ok: true };
  // Company name and logo for the sign-in page (no sign-in needed; nothing private).
  if (path === '/branding') { const st = getSettings(); return { company_name: st.company_name, logo: st.logo || null }; }
  if (path === '/auth/login' && method === 'POST') {
    const email = String((body && body.email) || '').trim().toLowerCase();
    const user = readAll('users').find(u => String(u.email).toLowerCase() === email);
    if (!user || !user.active || !checkPassword(String((body && body.password) || ''), user.password_hash)) throw new HttpError(401, 'Incorrect email or password');
    return { token: signToken(user), user: publicUser(user) };
  }

  const user = verifyToken(token);
  if (path === '/auth/me') return { user };
  if (path === '/auth/change-password' && method === 'POST') {
    const np = String((body && body.new_password) || '');
    if (np.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    const full = findById('users', user.id);
    if (!checkPassword(String(body.current_password || ''), full.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    updateRow('users', user.id, { password_hash: hashPassword(np) });
    return { ok: true };
  }

  // Insights
  if (path === '/alerts') {
    // Managers see alerts for their own drivers by default; pass manager_id=all for everything.
    const mid = pickManager(q, user);
    const alerts = computeAlerts().filter(a => !mid || a.manager_id === mid);
    const c = s => alerts.filter(a => a.severity === s).length;
    return { alerts, counts: { total: alerts.length, overdue: c('overdue'), urgent: c('urgent'), upcoming: c('upcoming') } };
  }
  if (path === '/dashboard') return dashboard(q, user);
  if (path === '/reports/manager') return managerReport(q, user);
  if (path === '/managers') {
    if (scopeFor(user)) return { rows: [{ id: user.id, name: user.name, role: user.role }] };
    return { rows: readAll('users').filter(u => u.active && (u.role === 'manager' || u.role === 'admin')).map(u => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  if (path === '/reports/vehicles') { const r = range(q); return { rows: vehicleReport(r.from, r.to, pickManager(q, user)) }; }
  if (path === '/reports/drivers') { const r = range(q); return { rows: driverReport(r.from, r.to, pickManager(q, user)) }; }
  if (path === '/reports/monthly') { const r = range(q, 365); return { rows: monthlyCosts(r.from, r.to, pickManager(q, user)) }; }
  if (path === '/reports/expense-categories') { const r = range(q); return { rows: categoryReport(r.from, r.to, pickManager(q, user)) }; }
  let mm = path.match(/^\/vehicles\/(\d+)\/summary$/);
  if (mm) {
    const id = Number(mm[1]);
    const now = today();
    if (scopeFor(user) && !inGroup('vehicles', findById('vehicles', id), scopeFor(user), maps())) throw new HttpError(404, 'Car not found');
    return {
      all_time: vehicleReport('1900-01-01', now).find(r => r.vehicle_id === id) || null,
      last_90_days: vehicleReport(addDays(now, -90), now).find(r => r.vehicle_id === id) || null,
      alerts: computeAlerts().filter(a => a.vehicle_id === id),
    };
  }

  // Settings
  if (path === '/settings') {
    if (method === 'GET') return getSettings();
    requireRole(user, 'admin');
    const data = validate(body || {}, SETTING_FIELDS, true);
    if (data.logo != null && data.logo !== '' && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(data.logo)) {
      throw invalid('logo', 'The logo must be a PNG, JPG or WebP image');
    }
    if (data.logo === null && body && body.logo === '') data.logo = '';
    if (data.model_prices != null) {
      let parsed;
      try { parsed = JSON.parse(data.model_prices); } catch (e) { parsed = null; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(k => !(Number(parsed[k]) > 0))) {
        throw invalid('model_prices', 'Each car model needs a price above 0');
      }
    }
    const clean = {};
    Object.keys(data).forEach(k => { if (data[k] !== null) clean[k] = data[k]; });
    const s = saveSettings(clean);
    audit(user, 'update', 'Settings', null, Object.keys(clean).join(', '));
    return s;
  }

  // Users
  if (path === '/users' || path.indexOf('/users/') === 0) {
    requireRole(user, 'admin');
    const id = Number(path.split('/')[2]) || null;
    if (method === 'GET') return { rows: readAll('users').slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(publicUser) };
    if (method === 'DELETE') {
      if (id === user.id) throw new HttpError(400, "You can't delete your own account");
      const u = findById('users', id);
      if (!u) throw new HttpError(404, 'User not found');
      deleteWhere('users', r => r.id === id);
      updateWhere('drivers', r => r.manager_id === id, { manager_id: null });
      updateWhere('vehicles', r => r.manager_id === id, { manager_id: null });
      audit(user, 'delete', 'User', id, u.email);
      return { ok: true };
    }
    const data = validate(body || {}, USER_FIELDS, !!id);
    if (data.email !== undefined && data.email !== null) {
      data.email = String(data.email).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(data.email)) throw invalid('email', 'Invalid email');
      const dup = readAll('users').find(u => u.email === data.email && u.id !== id);
      if (dup) throw new HttpError(409, 'A user with that email already exists');
    }
    const pw = body && body.password ? String(body.password) : '';
    if ((!id || pw) && pw.length < 8) throw invalid('password', 'At least 8 characters');
    if (pw) data.password_hash = hashPassword(pw);
    if (id) {
      const u = findById('users', id);
      if (!u) throw new HttpError(404, 'User not found');
      if (u.role === 'admin' && ((data.role && data.role !== 'admin') || data.active === 0)) {
        const others = readAll('users').filter(x => x.role === 'admin' && x.active && x.id !== id).length;
        if (!others) throw new HttpError(400, 'There must be at least one active admin');
      }
      const saved = updateRow('users', id, data);
      audit(user, 'update', 'User', id, saved.email);
      return publicUser(saved);
    }
    const saved = insertRow('users', data);
    audit(user, 'create', 'User', saved.id, `${saved.email} (${saved.role})`);
    return publicUser(saved);
  }

  // Start again: delete every car, driver and record, and all non-admin users. Admins and Settings are kept.
  if (path === '/admin/reset' && method === 'POST') {
    requireRole(user, 'admin');
    if (String((body && body.confirm) || '') !== 'DELETE') throw invalid('confirm', 'Type DELETE to confirm');
    const counts = wipeAllData();
    audit(user, 'delete', 'All data', null, `Started again: ${counts.vehicles || 0} cars, ${counts.drivers || 0} drivers, ${counts.payments || 0} payments, ${counts.users} users removed`);
    return { ok: true, removed: counts };
  }

  if (path === '/audit') {
    requireRole(user, 'manager');
    const limit = Math.min(parseInt(q.limit, 10) || 100, 500);
    // Managers see their own changes; admins see everyone's.
    return { rows: readAll('audit_log').filter(a => !scopeFor(user) || a.user_id === user.id).slice(-limit).reverse() };
  }

  // Resources: /vehicles, /vehicles/12, /maintenance/records/3 ...
  mm = path.match(/^\/(vehicles|drivers|trips|fuel|expenses|contracts|payments|off-days|checkins|maintenance\/schedules|maintenance\/records)(?:\/(\d+))?$/);
  if (mm) {
    const res = RESOURCES[mm[1]];
    const id = mm[2] ? Number(mm[2]) : null;
    if (method === 'GET') {
      if (!id) return list(res, q, user);
      const row = findById(res.table, id);
      if (!row) throw new HttpError(404, `${res.entity} not found`);
      if (scopeFor(user) && !inGroup(res.table, row, scopeFor(user), maps())) throw notInGroup(res);
      return view(res, row);
    }
    if (method === 'POST' && !id) return save(res, null, body, user);
    if ((method === 'PUT' || method === 'PATCH') && id) return save(res, id, body, user);
    if (method === 'DELETE' && id) return remove(res, id, user);
  }
  throw new HttpError(404, 'Not found');
}

// ============================================================================
// Web app entry points
// ============================================================================

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  const method = String(req.method || 'GET').toUpperCase();
  const isWrite = method !== 'GET' || req.path === '/auth/login';
  const lock = isWrite ? LockService.getScriptLock() : null;
  try {
    if (lock) lock.waitLock(30000);
    Object.keys(_cache).forEach(k => delete _cache[k]);
    const data = route(method, req.path, req.query, req.body, req.token);
    return { ok: true, status: 200, data };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, status: e.status, error: e.message, details: e.details };
    console.error(e && e.stack || e);
    return { ok: false, status: 500, error: 'Something went wrong in the Google Sheet script: ' + (e && e.message || e) };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

/** The web app sends POST requests with a JSON body: {method, path, query, body, token}. */
function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return respond({ ok: false, status: 400, error: 'Invalid request' }); }
  return respond(handle(req));
}

/** Opening the Web App URL in a browser shows this — handy for checking it is deployed. */
function doGet() {
  return respond({ ok: true, app: 'FleetPro', message: 'The FleetPro API is running. Put this URL in client/public/config.js.' });
}

// ============================================================================
// Setup (run once from the Apps Script editor)
// ============================================================================

function setup() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (book) PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
  const s = ss();

  TABLES.forEach(t => {
    let sh = s.getSheetByName(t);
    if (!sh) sh = s.insertSheet(t);
    const cols = columnsOf(t);
    // Add any missing columns without disturbing existing data.
    _checked[t] = true;
    syncColumns(t, sh);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#263035').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  });

  let st = s.getSheetByName('settings');
  if (!st) {
    st = s.insertSheet('settings');
    st.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold').setBackground('#263035').setFontColor('#ffffff');
    st.setFrozenRows(1);
    st.getRange(1, 1, st.getMaxRows(), 2).setNumberFormat('@');
  }
  saveSettings({});

  const blank = s.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && s.getSheets().length > 1) s.deleteSheet(blank);

  secret();
  Object.keys(_cache).forEach(k => delete _cache[k]);
  if (!readAll('users').length) {
    insertRow('users', { name: 'Administrator', email: 'admin@fleet.local', role: 'admin', active: 1, password_hash: hashPassword('admin12345') });
    console.log('Created admin account: admin@fleet.local / admin12345 — change the password after signing in.');
  }
  console.log('Setup complete. Now deploy: Deploy → New deployment → Web app.');
}

/** Deletes every car, driver and record, and all non-admin users. Admin accounts and Settings are kept. */
function wipeAllData() {
  const wipe = ['payments', 'off_days', 'contracts', 'checkins', 'trips', 'fuel_logs', 'expenses', 'maintenance_records', 'maintenance_schedules', 'vehicles', 'drivers', 'audit_log'];
  const counts = {};
  wipe.forEach(t => { if (FIELDS[t] && ss().getSheetByName(t)) { counts[t] = readAll(t).length; writeAll(t, []); } });
  const before = readAll('users');
  writeAll('users', before.filter(u => u.role === 'admin'));
  counts.users = before.length - readAll('users').length;
  return counts;
}

/**
 * START AGAIN — run this from the Apps Script editor (choose "startAgain" next to Debug, then Run).
 * Permanently deletes all cars, drivers, contracts, payments, days off, check-ins, maintenance,
 * expenses, the activity log and every manager account. Admin accounts and Settings are kept.
 * Make a backup first: in the Google Sheet, File → Make a copy.
 */
function startAgain() {
  Object.keys(_cache).forEach(k => delete _cache[k]);
  const c = wipeAllData();
  console.log(`Done. Removed ${c.vehicles || 0} cars, ${c.drivers || 0} drivers, ${c.contracts || 0} contracts, ${c.payments || 0} payments and ${c.users} manager/viewer accounts. Admin accounts and Settings were kept.`);
}

/** Wipes vehicles, drivers and all records, then loads a demo work-and-pay fleet. */
function loadDemoData() {
  setup();
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const now = today();
  const yesterday = addDays(now, -1);
  const stamp = nowStamp();
  const T = { vehicles: [], drivers: [], contracts: [], payments: [], checkins: [], trips: [], fuel_logs: [], expenses: [], maintenance_schedules: [], maintenance_records: [] };
  const add = (t, row) => { row.id = T[t].length + 1; row.created_at = stamp; row.updated_at = stamp; T[t].push(row); return row.id; };
  let refSeq = 61000000000 + Math.floor(rnd() * 900000000);
  const momoRef = () => String(refSeq += 1 + Math.floor(rnd() * 5000));
  const phone = () => pick(['024', '054', '055', '059']) + String(1000000 + Math.floor(rnd() * 8999999));

  // Managers (users)
  const managers = [['Samuel Adjei', 'manager@fleet.local'], ['Grace Mensah', 'grace@fleet.local'], ['Daniel Owusu', 'daniel@fleet.local']].map(([name, email]) => {
    const u = readAll('users').find(x => x.email === email) || insertRow('users', { name, email, role: 'manager', active: 1, password_hash: hashPassword('demo12345') });
    return u.id;
  });
  if (!readAll('users').find(u => u.email === 'viewer@fleet.local')) {
    insertRow('users', { name: 'Accounts Viewer', email: 'viewer@fleet.local', role: 'viewer', active: 1, password_hash: hashPassword('demo12345') });
  }

  // Cars: 15 work & pay cars + 3 Cerio + 3 BYD electric cars
  const cars = [
    ['GR-4521-21', 'Toyota', 'Vitz', 2019], ['GR-7790-22', 'Toyota', 'Vitz', 2020], ['GT-1182-22', 'Toyota', 'Vitz', 2019],
    ['GE-3307-23', 'Toyota', 'Vitz', 2021], ['GW-5590-23', 'Toyota', 'Vitz', 2021], ['GR-2208-23', 'Toyota', 'Corolla', 2018],
    ['GT-6612-24', 'Toyota', 'Corolla', 2019], ['GN-9034-24', 'Toyota', 'Corolla', 2020], ['GR-3381-24', 'Hyundai', 'Elantra', 2018],
    ['GE-7745-24', 'Hyundai', 'Elantra', 2019], ['GW-1156-25', 'Kia', 'Rio', 2020], ['GR-8823-25', 'Kia', 'Rio', 2021],
    ['GT-4470-25', 'Suzuki', 'Dzire', 2022], ['GN-2291-25', 'Suzuki', 'Dzire', 2022], ['GR-6018-20', 'Toyota', 'Vitz', 2017],
    ['GR-1001-25', 'Cerio', 'EV', 2025], ['GR-1002-25', 'Cerio', 'EV', 2025], ['GR-1003-25', 'Cerio', 'EV', 2025],
    ['GR-2001-25', 'BYD', 'Dolphin', 2025], ['GR-2002-25', 'BYD', 'Seagull', 2025], ['GR-2003-25', 'BYD', 'Dolphin', 2025],
  ];
  const vehicles = cars.map((c, i) => {
    const ev = c[1] === 'Cerio' || c[1] === 'BYD';
    const row = {
      reg_number: c[0], make: c[1], model: c[2], year: c[3], type: 'car', fuel_type: ev ? 'electric' : 'petrol',
      vin: 'JT' + Math.floor(rnd() * 1e12), color: pick(['White', 'Silver', 'Black', 'Grey', 'Blue']), status: 'active', current_odometer: 0,
      purchase_date: ev ? addDays(now, -Math.floor(between(250, 330))) : `${2020 + (i % 5)}-0${1 + (i % 9)}-10`,
      purchase_price: ev ? (c[1] === 'BYD' ? 420000 : 310000) : Math.round(between(120000, 210000) / 1000) * 1000,
      insurance_expiry: i === 3 ? addDays(now, 6) : i === 9 ? addDays(now, -4) : addDays(now, Math.floor(between(40, 330))),
      roadworthy_expiry: i === 12 ? addDays(now, 18) : addDays(now, Math.floor(between(40, 360))),
      registration_expiry: addDays(now, Math.floor(between(60, 365))),
    };
    return { id: add('vehicles', row), row, ev };
  });

  const names = ['Kwame Asante', 'Yaw Boateng', 'Kofi Annan Mensah', 'Kojo Appiah', 'Ebo Quansah', 'Kwesi Arthur', 'Nana Kwaku Darko', 'Isaac Tetteh',
    'Emmanuel Ofori', 'Michael Agyei', 'Richard Amoah', 'Prince Osei', 'Felix Nkrumah', 'Joseph Addai', 'Collins Amponsah', 'Bright Asare',
    'Eric Danso', 'Godfred Ansah', 'Patrick Frimpong', 'Ibrahim Mahama', 'Stephen Otoo', 'Abdul Rahman Yakubu', 'Daniel Kumi', 'Solomon Bekoe'];
  const drivers = names.map((n, i) => add('drivers', {
    name: n, manager_id: managers[i % 3], phone: phone(), momo_number: null, id_number: 'GHA-' + (700000000 + Math.floor(rnd() * 99999999)) + '-' + (i % 9),
    license_number: 'DL-' + (100000 + i * 7331), license_class: 'B',
    license_expiry: i === 4 ? addDays(now, 10) : i === 17 ? addDays(now, -6) : addDays(now, Math.floor(between(90, 1100))),
    hire_date: null, status: 'active',
  }));
  T.drivers.forEach(d => { d.momo_number = d.phone; });

  const cutoff = addDays(now, -84); // detailed daily payments for the last 12 weeks; earlier history is one opening balance
  const profile = {}; // driver id -> behaviour
  const contract = (o) => {
    const id = add('contracts', Object.assign({ payment_days: 'mon_sat', status: 'active', ended_on: null, end_reason: null, notes: null, deposit_amount: null, deposit_reference: null, deposit_date: null, end_date: null }, o));
    const c = T.contracts[id - 1];
    T.drivers[c.driver_id - 1].hire_date = T.drivers[c.driver_id - 1].hire_date || c.start_date;
    return c;
  };

  // Former drivers who stopped, so their cars became "retrieved" cars
  const formerA = contract({ driver_id: drivers[20], vehicle_id: vehicles[1].id, type: 'work_and_pay', start_date: addDays(now, -700), daily_rate: 400, deposit_amount: 15000, deposit_reference: momoRef(), deposit_date: addDays(now, -701), status: 'stopped', ended_on: addDays(now, -150), end_reason: 'Driver relocated to Kumasi' });
  const formerB = contract({ driver_id: drivers[21], vehicle_id: vehicles[5].id, type: 'work_and_pay', start_date: addDays(now, -640), daily_rate: 400, deposit_amount: 15000, deposit_reference: momoRef(), deposit_date: addDays(now, -641), status: 'stopped', ended_on: addDays(now, -95), end_reason: 'Could not keep up with payments' });
  const formerC = contract({ driver_id: drivers[22], vehicle_id: vehicles[14].id, type: 'work_and_pay', start_date: addDays(now, -900), daily_rate: 400, deposit_amount: 15000, deposit_reference: momoRef(), deposit_date: addDays(now, -901), status: 'stopped', ended_on: addDays(now, -9), end_reason: 'Driver chose to stop – medical reasons' });
  [20, 21, 22].forEach(i => { T.drivers[drivers[i] - 1].status = 'stopped'; });
  T.drivers[drivers[23] - 1].status = 'on_leave';
  profile[formerA.id] = 'good'; profile[formerB.id] = 'behind'; profile[formerC.id] = 'good';

  // Current work & pay drivers (cars 0–13). Cars 1 and 5 are retrieved cars on smaller deposits.
  const starts = [520, 410, 300, 610, 250, 80, 180, 450, 130, 365, 95, 60, 220, 40];
  const behaviours = ['good', 'good', 'late', 'good', 'behind', 'good', 'good', 'late', 'good', 'very_behind', 'good', 'good', 'ahead', 'good'];
  for (let i = 0; i < 14; i++) {
    const retrieved = i === 1 || i === 5;
    const start = retrieved ? addDays(i === 1 ? formerA.ended_on : formerB.ended_on, 10) : addDays(now, -starts[i]);
    const c = contract({
      driver_id: drivers[i], vehicle_id: vehicles[i].id, type: 'work_and_pay', start_date: start, daily_rate: 400,
      deposit_amount: retrieved ? (i === 1 ? 10000 : 7500) : 15000, deposit_reference: momoRef(), deposit_date: addDays(start, -2),
      notes: retrieved ? 'Retrieved car' : null,
    });
    profile[c.id] = behaviours[i];
  }
  // Electric daily hire: Cerio = 500, BYD = 700
  for (let i = 0; i < 6; i++) {
    const v = vehicles[15 + i];
    const c = contract({ driver_id: drivers[14 + i], vehicle_id: v.id, type: 'daily_hire', start_date: addDays(now, -Math.floor(between(45, 240))), daily_rate: v.row.make === 'BYD' ? 700 : 500 });
    profile[c.id] = i === 4 ? 'behind' : i === 1 ? 'late' : 'good';
  }
  T.contracts.forEach(c => {
    if (c.type === 'work_and_pay') c.end_date = addDays(addYears(c.start_date, 4), -1);
    const v = T.vehicles[c.vehicle_id - 1];
    if (c.status === 'active') v.assigned_driver_id = c.driver_id;
  });

  // Payments
  const workshopCar = vehicles[6].id; // one car spent 3 days in the workshop recently (excused days)
  const workshopDays = [addDays(now, -9), addDays(now, -8), addDays(now, -7)].filter(d => isPayDay(d, 'mon_sat'));
  T.contracts.forEach(c => {
    const beh = profile[c.id] || 'good';
    const last = minDate(yesterday, c.ended_on, c.end_date);
    const openingTo = minDate(addDays(cutoff, -1), last);
    if (c.start_date <= openingTo) {
      const days = payDays(c.start_date, openingTo, c.payment_days);
      const factor = beh === 'behind' ? 0.985 : beh === 'very_behind' ? 0.99 : 1;
      add('payments', { contract_id: c.id, type: 'adjustment', work_date: openingTo, paid_on: openingTo, amount: Math.round(days * c.daily_rate * factor), momo_reference: null, momo_number: null, recorded_by: 'Opening balance', notes: `Total paid for ${days} days before FleetPro was set up` });
    }
    let owedCarry = 0;
    for (let d = maxDate(c.start_date, cutoff); d <= last; d = addDays(d, 1)) {
      if (!isPayDay(d, c.payment_days)) continue;
      const drv = T.drivers[c.driver_id - 1];
      if (c.vehicle_id === workshopCar && workshopDays.indexOf(d) >= 0) continue;
      let amount = c.daily_rate, delay = 1;
      const r = rnd();
      if (beh === 'late' && r < 0.25) delay = 2 + Math.floor(rnd() * 2);
      if (beh === 'behind' && r < 0.18) { owedCarry += c.daily_rate; continue; }
      if (beh === 'very_behind' && d >= addDays(now, -12) && r < 0.75) { continue; }
      if (beh === 'very_behind' && r < 0.1) { amount = c.daily_rate / 2; }
      if (beh === 'behind' && owedCarry && r > 0.85) { amount += c.daily_rate; owedCarry -= c.daily_rate; }
      if (beh === 'ahead' && r < 0.08) amount += c.daily_rate;
      const paidOn = addDays(d, delay);
      if (paidOn > now) continue;
      add('payments', { contract_id: c.id, type: 'daily', work_date: d, paid_on: paidOn, amount, momo_reference: momoRef(), momo_number: drv.momo_number, recorded_by: pick(['Samuel Adjei', 'Grace Mensah', 'Daniel Owusu']), notes: null });
    }
    if (c.vehicle_id === workshopCar && workshopDays.length) {
      add('payments', { contract_id: c.id, type: 'waiver', work_date: workshopDays[0], paid_on: workshopDays[workshopDays.length - 1], amount: workshopDays.length * c.daily_rate, momo_reference: null, momo_number: null, recorded_by: 'Grace Mensah', notes: `Car in workshop ${workshopDays.length} days – clutch repair (company cost)` });
    }
  });

  // Odometers: work-and-pay cars run ~180 km a working day, EVs ~150
  vehicles.forEach(v => {
    const cs = T.contracts.filter(c => c.vehicle_id === v.id);
    const days = cs.reduce((n, c) => n + payDays(c.start_date, minDate(yesterday, c.ended_on, c.end_date), 'mon_sat'), 0);
    v.row.current_odometer = Math.round((v.ev ? 30 : 40000 + rnd() * 30000) + days * (v.ev ? 150 : 180) * between(0.85, 1.15));
  });
  T.vehicles[14].assigned_driver_id = null; // retrieved, waiting for a new driver
  T.vehicles.forEach(v => {
    const c = T.contracts.filter(x => x.vehicle_id === v.id).slice(-1)[0];
    v.manager_id = c ? T.drivers[c.driver_id - 1].manager_id : managers[0];
  });

  // Service schedules and history
  const garages = ['Toyota Ghana Service', 'Rana Motors', 'Mechanic Hub Spintex', 'Silver Star Auto', 'Tyre Plus Accra', 'BYD Service Centre Accra'];
  vehicles.forEach((v, i) => {
    const odo = v.row.current_odometer;
    if (v.ev) {
      const sid = add('maintenance_schedules', { vehicle_id: v.id, service_type: 'EV inspection & tyre rotation', interval_km: 10000, interval_days: 180, last_done_date: addDays(now, -Math.floor(between(20, 150))), last_done_odometer: Math.max(0, odo - Math.floor(between(1000, 9000))), active: 1 });
      if (i === 19) T.maintenance_schedules[sid - 1].last_done_odometer = odo - 10400;
      return;
    }
    const lastOdo = odo - (i === 8 ? 5300 : i === 2 ? 4650 : Math.floor(between(400, 4200)));
    const lastDate = addDays(now, -(i === 10 ? 86 : Math.floor(between(10, 75))));
    const sid = add('maintenance_schedules', { vehicle_id: v.id, service_type: 'Oil & filter change', interval_km: 5000, interval_days: 90, last_done_date: lastDate, last_done_odometer: lastOdo, active: 1 });
    add('maintenance_records', { vehicle_id: v.id, schedule_id: sid, date: lastDate, odometer: lastOdo, type: 'service', description: 'Engine oil and filter change', vendor: pick(garages), cost: Math.round(between(450, 750)), status: 'completed', downtime_days: 0.5 });
    add('maintenance_schedules', { vehicle_id: v.id, service_type: 'Brake pads & full inspection', interval_km: 20000, interval_days: 365, last_done_date: addDays(now, -Math.floor(between(30, 300))), last_done_odometer: odo - Math.floor(between(3000, 16000)), active: 1 });
    if (rnd() < 0.45) add('maintenance_records', { vehicle_id: v.id, date: addDays(now, -Math.floor(between(12, 80))), odometer: odo - Math.floor(between(500, 6000)), type: 'repair', description: pick(['Brake pads replaced', 'Shock absorbers', 'AC regas', 'Battery replacement', 'CV joint', 'Wheel bearing']), vendor: pick(garages), cost: Math.round(between(350, 2400)), status: 'completed', downtime_days: 1 });
  });
  add('maintenance_records', { vehicle_id: workshopCar, date: workshopDays[0] || addDays(now, -9), odometer: T.vehicles[workshopCar - 1].current_odometer - 900, type: 'repair', description: 'Clutch plate replacement', vendor: 'Rana Motors', cost: 1850, status: 'completed', downtime_days: workshopDays.length });
  add('maintenance_records', { vehicle_id: vehicles[11].id, date: now, odometer: T.vehicles[vehicles[11].id - 1].current_odometer, type: 'repair', description: 'Engine misfire – diagnosis', vendor: 'Mechanic Hub Spintex', cost: 0, status: 'in_progress' });
  T.vehicles[vehicles[11].id - 1].status = 'in_maintenance';
  add('maintenance_records', { vehicle_id: vehicles[14].id, date: addDays(now, 3), type: 'service', description: 'Full service before reassigning to new driver', vendor: 'Toyota Ghana Service', cost: 900, status: 'scheduled' });

  // Weekly check-ins by managers
  const complaints = [
    ['Car pulls to the left when braking', 'Booked brake check at Rana Motors', 'resolved'],
    ['Says passengers are few in his area, wants to move to Tema route', 'Discussed route change, will review next week', 'open'],
    ['AC not cooling', 'Sent for AC regas', 'resolved'],
    ['Wants to stop – says daily 400 is too much this season', 'Asked him to think about it and talk to the CEO', 'open'],
    ['Police stopped him twice over expired roadworthy sticker', 'Renewing roadworthy this week', 'open'],
  ];
  T.contracts.filter(c => c.status === 'active').forEach((c, k) => {
    for (let w = 3; w >= 0; w--) {
      const date = addDays(now, -(w * 7 + Math.floor(rnd() * 3) + 1));
      if (date < c.start_date) continue;
      let intention = 'continue', complaint = null, action = null, cstatus = 'none', cond = rnd() < 0.85 ? 'good' : 'needs_attention';
      if (w === 0 && k === 9) { intention = 'wants_to_stop'; [complaint, action, cstatus] = complaints[3]; }
      else if (w === 0 && k === 4) { intention = 'undecided'; [complaint, action, cstatus] = complaints[1]; }
      else if (w === 0 && k === 12) { [complaint, action, cstatus] = complaints[4]; }
      else if (w === 1 && k === 2) { [complaint, action, cstatus] = complaints[0]; cond = 'needs_attention'; }
      else if (w === 2 && k === 7) { [complaint, action, cstatus] = complaints[2]; }
      if (w === 0 && c.vehicle_id === vehicles[11].id) cond = 'in_workshop';
      const v = T.vehicles[c.vehicle_id - 1];
      add('checkins', { driver_id: c.driver_id, vehicle_id: c.vehicle_id, date, odometer: Math.round(v.current_odometer - w * 1000 - between(0, 300)), car_condition: cond, intention, complaint, complaint_status: cstatus, action_taken: action });
    }
  });

  // Company expenses
  vehicles.forEach(v => {
    add('expenses', { vehicle_id: v.id, date: addDays(now, -Math.floor(between(20, 300))), category: 'insurance', amount: Math.round(between(1800, 4200)), vendor: pick(['SIC Insurance', 'Enterprise Insurance', 'Star Assurance']), description: 'Annual comprehensive cover' });
    add('expenses', { vehicle_id: v.id, date: addDays(now, -Math.floor(between(20, 300))), category: 'licensing', amount: Math.round(between(150, 400)), vendor: 'DVLA', description: 'Roadworthy and road use fee' });
  });
  for (let i = 0; i < 25; i++) add('expenses', { vehicle_id: pick(vehicles).id, date: addDays(now, -Math.floor(between(0, 120))), category: pick(['tyres', 'tyres', 'fines', 'other', 'cleaning']), amount: Math.round(between(80, 1600)), vendor: 'Various', description: null });
  add('expenses', { date: addDays(now, -15), category: 'other', amount: 1500, vendor: 'Tracker Co.', description: 'GPS tracker subscription – whole fleet' });

  Object.keys(T).forEach(t => writeAll(t, T[t].map(r => {
    if (t === 'vehicles') return Object.assign(r, vehicles.find(v => v.id === r.id).row, { assigned_driver_id: r.assigned_driver_id || null });
    return r;
  })));
  writeAll('audit_log', []);
  console.log(`Demo data loaded: ${vehicles.length} cars, ${drivers.length} drivers, ${T.contracts.length} contracts, ${T.payments.length} payments. Logins: admin@fleet.local / admin12345; managers manager@fleet.local, grace@fleet.local, daniel@fleet.local / demo12345`);
}
