import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Plate, fmtDate, invalidateOptions, normalizeGhanaCard, useOptions } from '../ui';
import { splitLine, toISODate } from './ImportVehicles';

// Column names people commonly use, mapped to FleetPro fields.
const HEADERS = {
  name: ['driver name', 'name', 'names', 'driver', 'full name', 'drivers name'],
  phone: ['phone', 'contact', 'phone number', 'mobile', 'telephone', 'tel', 'contact number'],
  momo_number: ['momo number', 'momo', 'mobile money', 'mobile money number', 'momo no'],
  id_number: ['ghana card number', 'ghana card', 'id number', 'national id', 'id'],
  license_number: ['licence number', 'license number', 'licence', 'license', 'licence no', 'license no'],
  license_expiry: ['licence expiry', 'license expiry', 'licence expires', 'license expires'],
  manager: ['manager', 'manager name', 'managed by', 'supervisor'],
  car: ['car number', 'car', 'reg no', 'reg number', 'registration', 'number plate', 'plate', 'vehicle number', 'car no'],
  arrangement: ['arrangement', 'type', 'contract type', 'payment type', 'plan'],
  start_date: ['start date', 'started', 'start', 'date started', 'joined'],
  daily_rate: ['daily payment', 'daily rate', 'daily amount', 'rate', 'per day'],
  deposit_amount: ['deposit amount', 'deposit', 'security deposit'],
  deposit_reference: ['deposit momo reference', 'deposit reference', 'deposit ref', 'deposit momo ref', 'momo reference'],
  deposit_date: ['deposit paid on', 'deposit date', 'date of deposit'],
  paid_so_far: ['total paid so far', 'paid so far', 'amount paid so far', 'total paid'],
  notes: ['notes', 'note', 'comments', 'remarks'],
};

export const DRIVER_TEMPLATE_COLUMNS = [
  ['Driver name *', 30], ['Phone', 13], ['MoMo number', 13], ['Ghana Card number', 18], ['Licence number', 15], ['Licence expiry', 14],
  ['Manager', 16], ['Car number', 13], ['Arrangement', 13], ['Start date', 12], ['Daily payment', 13], ['Deposit amount', 14],
  ['Deposit MoMo reference', 22], ['Deposit paid on', 15], ['Total paid so far', 16], ['Notes', 30],
];

export async function downloadDriverTemplate() {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const head = DRIVER_TEMPLATE_COLUMNS.map(([v]) => ({ value: v, fontWeight: 'bold', backgroundColor: '#F2B705', height: 22 }));
  const help = [
    [{ value: 'How to fill in the FleetPro driver list', fontWeight: 'bold', height: 24 }],
    [''],
    ['1. Use the "Drivers" sheet. One driver per row, starting on row 2. Keep the header row as it is.'],
    ['2. Only the driver name is required. Phone numbers: type them with the leading 0, e.g. 0244123456. Ghana Card: GHA-XXXXXXXXX-X, e.g. GHA-123456789-0.'],
    ['3. To give the driver a car at the same time, fill in Car number, Arrangement and Start date. The car must already be in FleetPro (Cars → Import cars).'],
    ['4. Arrangement: "Work & pay" (daily payments for 4 years, driver owns the car) or "Daily hire" (e.g. Cerio, BYD). Leave Daily payment empty for the standard rate.'],
    ['5. Work & pay needs the Deposit amount and the Deposit MoMo reference. New cars need the full new-car deposit (15,000); retrieved cars from 5,000.'],
    ['6. Total paid so far: for drivers who started before FleetPro, the total of their daily payments up to yesterday. This stops them showing as owing for days they already paid.'],
    ['7. Dates: type them as 31/12/2026 (day/month/year).'],
    ['8. Save the file, then in FleetPro go to Drivers → Import drivers → Upload the filled-in file. Drivers already in FleetPro (same phone number) are not added twice.'],
    [''],
    [{ value: 'Example (do not copy into the Drivers sheet):', fontWeight: 'bold' }],
    head.map(h => ({ ...h, backgroundColor: '#E7ECEA' })),
    ['Kwame Asante', '0244123456', '0244123456', 'GHA-123456789-0', 'DL-12345', '18/12/2028', 'Erica', 'GW 4850-26', 'Work & pay', '01/06/2026', 400, 15000, '61000055323', '30/05/2026', 52000, ''],
  ];
  await writeExcelFile([
    { data: [head], sheet: 'Drivers', columns: DRIVER_TEMPLATE_COLUMNS.map(([, w]) => ({ width: w })), stickyRowsCount: 1 },
    { data: help, sheet: 'How to fill', columns: DRIVER_TEMPLATE_COLUMNS.map(([, w], i) => ({ width: i === 0 ? 24 : w })) },
  ]).toFile('FleetPro driver list.xlsx');
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const digits = s => String(s ?? '').replace(/\D/g, '');
/** Excel often drops the leading 0 from phone numbers: 244123456 → 0244123456. */
const fixPhone = v => { const d = digits(v); return !d ? '' : d.length === 9 ? '0' + d : d.startsWith('233') && d.length === 12 ? '0' + d.slice(3) : d; };
const carKey = s => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
const money = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };

export function parseDriverRows(input) {
  let rows = input.filter(r => r && r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
  if (!rows.length) return [];
  // Find the header row (it may not be the first, e.g. a title row above it).
  let map = null, headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 5) && !map; i++) {
    const found = {};
    rows[i].forEach((c, j) => {
      const h = String(c ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[*.]/g, '').replace(/[^a-z/& ]/g, ' ').replace(/\s+/g, ' ').trim();
      for (const [field, names] of Object.entries(HEADERS)) if (!(field in found) && names.includes(h)) { found[field] = j; break; }
    });
    if ('name' in found) { map = found; headerAt = i; }
  }
  if (!map) { map = { name: 0, phone: 1, car: 2 }; headerAt = -1; }
  rows = rows.slice(headerAt + 1);

  return rows.map((r, i) => {
    const raw = f => (map[f] !== undefined ? r[map[f]] : null);
    const get = f => { const v = raw(f); return v == null ? '' : String(v).trim(); };
    const badDates = [];
    const date = (f, label) => { const d = toISODate(raw(f)); if (d === undefined) badDates.push(label); return d || null; };
    const arr = get('arrangement').toLowerCase();
    const car = get('car');
    return {
      line: i + 1,
      name: titleCase(get('name').replace(/\s+/g, ' ')),
      phone: fixPhone(raw('phone')),
      momo_number: fixPhone(raw('momo_number')) || fixPhone(raw('phone')),
      id_number: get('id_number') ? (normalizeGhanaCard(get('id_number')) || get('id_number')) : null,
      license_number: get('license_number') || null,
      license_expiry: date('license_expiry', 'Licence expiry'),
      manager_text: get('manager'),
      car: car.toUpperCase().replace(/\s+/g, ' '),
      type: !car ? null : /daily|hire/.test(arr) ? 'daily_hire' : 'work_and_pay',
      arrangement: /daily|hire/.test(arr) ? 'daily_hire' : /work|pay|w&p/.test(arr) ? 'work_and_pay' : (car ? 'work_and_pay' : null),
      start_date: date('start_date', 'Start date'),
      daily_rate: money(raw('daily_rate')),
      deposit_amount: money(raw('deposit_amount')),
      deposit_reference: get('deposit_reference') ? String(raw('deposit_reference')).replace(/\.0+$/, '').trim() : null,
      deposit_date: date('deposit_date', 'Deposit paid on'),
      paid_so_far: money(raw('paid_so_far')),
      notes: get('notes') || null,
      badDates,
    };
  });
}

function parseText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : '\t';
  return parseDriverRows(lines.map(l => splitLine(l, delim)));
}

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ImportDrivers({ onClose, onDone }) {
  const { user, money: fmtMoney, settings } = useApp();
  const managers = useOptions('manager');
  const [managerId, setManagerId] = useState(user.role === 'manager' ? String(user.id) : '');
  const [text, setText] = useState('');
  const [fileRows, setFileRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [ctx, setCtx] = useState(null); // { cars: Map(key → car), drivers: [...] }
  const [progress, setProgress] = useState(null);

  const rows = useMemo(() => (fileRows ? parseDriverRows(fileRows) : parseText(text)), [text, fileRows]);
  useEffect(() => {
    if ((!text && !fileRows) || ctx) return;
    Promise.all([api('/vehicles', { query: { limit: 5000 } }), api('/drivers', { query: { limit: 5000 } })])
      .then(([v, d]) => setCtx({ cars: new Map(v.rows.map(c => [carKey(c.reg_number), c])), drivers: d.rows }))
      .catch(() => setCtx({ cars: new Map(), drivers: [] }));
  }, [text, fileRows, ctx]);

  const minDeposit = Number(settings.deposit_min) || 5000;
  const findManager = name => managers.find(m => m.label.trim().toLowerCase() === name.trim().toLowerCase());
  const carsSeen = new Map(), refsSeen = new Map(), phonesSeen = new Map(), cardsSeen = new Map();
  const checked = rows.map(r => {
    const problems = [];
    const fromFile = r.manager_text ? findManager(r.manager_text) : null;
    const manager_id = user.role === 'manager' ? user.id : fromFile ? fromFile.value : (managerId ? Number(managerId) : null);
    const manager_label = (managers.find(m => m.value === manager_id) || {}).label || null;
    const existing = ctx && ctx.drivers.find(d => (r.phone && digits(d.phone) === r.phone) || d.name.trim().toLowerCase() === r.name.toLowerCase());
    const car = r.car && ctx ? ctx.cars.get(carKey(r.car)) : null;

    if (!r.name) problems.push('No driver name');
    if (user.role !== 'manager' && r.manager_text && !fromFile) problems.push(`No manager called "${r.manager_text}"`);
    if (!manager_id && !existing) problems.push('Choose a manager');
    if (r.badDates.length) problems.push(`Check date: ${r.badDates.join(', ')}`);
    if (r.phone && phonesSeen.has(r.phone)) problems.push('Phone number listed twice');
    if (r.phone) phonesSeen.set(r.phone, 1);
    if (r.id_number && !/^GHA-\d{9}-\d$/.test(r.id_number)) problems.push(`Ghana Card "${r.id_number}" should look like GHA-123456789-0`);
    if (r.id_number && cardsSeen.has(r.id_number)) problems.push('Ghana Card listed twice');
    if (r.id_number) cardsSeen.set(r.id_number, 1);
    if (r.id_number && ctx && ctx.drivers.some(d => d.id_number === r.id_number && !(existing && d.id === existing.id))) problems.push('Ghana Card already used by another driver');

    let carStatus = null;
    if (r.car) {
      if (!ctx) carStatus = 'checking';
      else if (!car) problems.push(`Car ${r.car} isn't in FleetPro – import it first`);
      else if (car.assigned_driver_id && !(existing && car.assigned_driver_id === existing.id)) problems.push(`${car.reg_number} already has a driver (${car.driver_name || 'someone else'})`);
      else if (existing && existing.contract_id) problems.push(`${existing.name} already has a car`);
      else if (car.manager_id && manager_id && car.manager_id !== manager_id) problems.push(`${car.reg_number} is in ${car.manager_name || 'another manager'}'s group`);
      if (carsSeen.has(carKey(r.car))) problems.push(`${r.car} listed twice`);
      carsSeen.set(carKey(r.car), 1);
      if (!r.start_date) problems.push('Needs a start date');
      if (r.type === 'work_and_pay') {
        if (r.deposit_amount == null) problems.push('Needs the deposit amount');
        else if (r.deposit_amount < minDeposit) problems.push(`Deposit below ${fmtMoney(minDeposit)}`);
        if (!r.deposit_reference) problems.push('Needs the deposit MoMo reference');
      }
      if (r.deposit_reference) {
        const k = r.deposit_reference.toLowerCase();
        if (refsSeen.has(k)) problems.push('Deposit reference listed twice');
        refsSeen.set(k, 1);
      }
      if (r.start_date && r.start_date > todayISO()) problems.push('Start date is in the future');
    }
    const willAdd = existing ? (r.car ? 'Car only' : 'Already in FleetPro') : r.car ? 'Driver + car' : 'Driver only';
    return { ...r, manager_id, manager_label, existing, vehicle: car, problems, carStatus, willAdd };
  });
  const good = checked.filter(r => !r.problems.length && r.willAdd !== 'Already in FleetPro');
  const withCars = good.filter(r => r.car).length;

  const onFile = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress(null); setFileName(f.name);
    if (/\.xls$/i.test(f.name)) { setProgress({ done: 0, total: 0, errors: ['This is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.'] }); return; }
    if (/\.xlsx$/i.test(f.name)) {
      import('read-excel-file/browser').then(async ({ readSheet }) => {
        let data;
        try { data = await readSheet(f, 'Drivers'); } catch { data = await readSheet(f); }
        setFileRows(data); setText('');
      }).catch(() => setProgress({ done: 0, total: 0, errors: ["Couldn't read that Excel file. Check it's saved as .xlsx."] }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setFileRows(null); setText(String(reader.result)); };
    reader.readAsText(f);
  };

  const run = async () => {
    const errors = [];
    const done = { drivers: 0, contracts: 0 };
    setProgress({ done: 0, total: good.length, errors, ...done });
    for (let i = 0; i < good.length; i++) {
      const r = good[i];
      try {
        let driverId = r.existing && r.existing.id;
        if (!driverId) {
          const d = await api('/drivers', { method: 'POST', body: {
            name: r.name, phone: r.phone || null, momo_number: r.momo_number || null, id_number: r.id_number, arrangement: r.arrangement,
            license_number: r.license_number, license_expiry: r.license_expiry, manager_id: r.manager_id, status: 'active',
            hire_date: r.start_date, notes: r.notes,
          } });
          driverId = d.id; done.drivers++;
        }
        if (r.car && r.vehicle) {
          let c;
          try {
            c = await api('/contracts', { method: 'POST', body: {
              driver_id: driverId, vehicle_id: r.vehicle.id, type: r.type, status: 'active', start_date: r.start_date,
              daily_rate: r.daily_rate, deposit_amount: r.deposit_amount, deposit_reference: r.deposit_reference,
              deposit_date: r.deposit_date || r.start_date, payment_days: 'mon_sat',
              onboarding: (r.paid_so_far > 0 || (r.start_date && r.start_date < todayISO())) ? 'existing_driver' : 'new_driver',
            } });
          } catch (e) {
            throw new Error(`driver added, but the car wasn't given: ${e.message}${e.details && Object.values(e.details).length ? ' – ' + Object.values(e.details).join(', ') : ''}`);
          }
          done.contracts++;
          if (r.paid_so_far > 0) {
            const workDate = yesterday() < r.start_date ? r.start_date : yesterday();
            try {
              await api('/payments', { method: 'POST', body: {
                contract_id: c.id, type: 'adjustment', work_date: workDate, paid_on: todayISO(), amount: r.paid_so_far,
                notes: 'Total paid before FleetPro (opening balance)',
              } });
            } catch (e) { errors.push(`${r.name}: car given, but "paid so far" wasn't saved – ${e.message}. Add it under Payments as an Adjustment.`); }
          }
        }
      } catch (e) {
        errors.push(`${r.name}: ${e.message}${!String(e.message).startsWith('driver added') && e.details && Object.values(e.details).length ? ' – ' + Object.values(e.details).join(', ') : ''}`);
      }
      setProgress({ done: i + 1, total: good.length, errors: [...errors], ...done });
    }
    invalidateOptions();
    onDone(done.drivers, done.contracts);
  };

  const finished = progress && progress.total > 0 && progress.done === progress.total;
  const running = progress && progress.total > 0 && !finished;

  return (
    <Modal title="Import drivers" onClose={running ? () => {} : onClose} wide>
      <div className="form import">
        {!progress?.total && (
          <>
            <ol className="import-steps">
              <li>
                <strong>Download the Excel template</strong> and fill in one driver per row. Add the car number, start date and deposit to give the driver their car at the same time.
                <div><button type="button" className="btn ghost sm" onClick={() => downloadDriverTemplate().catch(() => setProgress({ done: 0, total: 0, errors: ["Couldn't create the template. Check your internet connection and try again."] }))}>Download Excel template</button></div>
              </li>
              <li>
                <strong>Upload the filled-in file</strong>, then check the preview below. Import cars first: each driver's car must already be in FleetPro.
                <div className="upload-row">
                  <label className="btn primary sm file-btn">
                    Upload filled-in file
                    <input type="file" accept=".xlsx,.xls,.csv,.txt,.tsv" onChange={onFile} />
                  </label>
                  {fileName && <span className="dim">{fileName}</span>}
                </div>
              </li>
            </ol>
            <details className="paste-instead" open={!!text}>
              <summary>Or paste from Excel or Google Sheets instead</summary>
              <div className="field">
                <label htmlFor="import-drivers-text">Paste your list</label>
                <textarea id="import-drivers-text" rows={6} value={text} onChange={e => { setText(e.target.value); setFileRows(null); setFileName(''); setProgress(null); }}
                  placeholder={'Driver name\tPhone\tCar number\nKwame Asante\t0244123456\tGW 4850-26'} spellCheck={false} />
              </div>
            </details>
            {progress?.errors?.length > 0 && <div className="form-error">{progress.errors[0]}</div>}
          </>
        )}

        {checked.length > 0 && !progress?.total && (
          <>
            {user.role !== 'manager' && (
              <div className="toolbar manager-pick">
                <label className="inline-label" htmlFor="import-drivers-manager">Manager for these drivers
                  <select id="import-drivers-manager" value={managerId} onChange={e => setManagerId(e.target.value)}>
                    <option value="">Choose manager…</option>
                    {managers.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <span className="dim">Rows with a manager in the file keep that manager. Cars without a manager join the driver's manager.</span>
              </div>
            )}
            <p className="import-count">
              <strong>{good.length}</strong> ready{withCars > 0 && <> ({withCars} with a car)</>}
              {checked.length > good.length && <> · <span className="txt-warn">{checked.length - good.length} need attention or are already in FleetPro</span></>}
            </p>
            <div className="table-wrap import-preview tall">
              <table className="data">
                <thead><tr><th>Driver</th><th>Phone</th><th>Manager</th><th>Car</th><th>Start</th><th className="num">Deposit</th><th className="num">Paid so far</th><th>Status</th></tr></thead>
                <tbody>
                  {checked.map(r => (
                    <tr key={r.line} className={r.problems.length || r.willAdd === 'Already in FleetPro' ? 'skip' : ''}>
                      <td><strong>{r.name || <span className="dim">—</span>}</strong></td>
                      <td>{r.phone || <span className="dim">—</span>}</td>
                      <td>{r.manager_label || r.manager_text || <span className="dim">—</span>}</td>
                      <td>{r.car ? <><Plate>{r.car}</Plate><div className="dim">{r.type === 'daily_hire' ? 'Daily hire' : 'Work & pay'}{r.daily_rate ? ` · ${fmtMoney(r.daily_rate)}` : ''}</div></> : <span className="dim">No car</span>}</td>
                      <td>{r.start_date ? fmtDate(r.start_date) : <span className="dim">—</span>}</td>
                      <td className="num">{r.deposit_amount != null ? <>{fmtMoney(r.deposit_amount)}<div className="dim mono">{r.deposit_reference}</div></> : <span className="dim">—</span>}</td>
                      <td className="num">{r.paid_so_far != null ? fmtMoney(r.paid_so_far) : <span className="dim">—</span>}</td>
                      <td className="wrap">{r.problems.length
                        ? <span className="txt-warn">{r.problems.join(' · ')}</span>
                        : r.willAdd === 'Already in FleetPro' ? <span className="dim">Already in FleetPro</span>
                        : <span className="txt-ok">Ready: {r.willAdd.toLowerCase()}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Rows that need attention are skipped. Fix them in Excel and upload the file again: drivers already added are recognised by phone number and won't be added twice.</p>
          </>
        )}

        {progress?.total > 0 && (
          <div className="import-progress" role="status">
            <p><strong>{finished
              ? `Done: ${progress.drivers} driver${progress.drivers === 1 ? '' : 's'} added, ${progress.contracts} given a car.`
              : `Importing ${progress.done} of ${progress.total}…`}</strong></p>
            <div className="progress big"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            {!finished && <p className="dim">Each driver takes a few seconds to save to your Google Sheet. Keep this window open.</p>}
            {progress.errors.length > 0 && (
              <div className="form-error">
                {progress.errors.length} problem{progress.errors.length === 1 ? '' : 's'}:
                <ul>{progress.errors.map(e => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <footer className="form-actions">
          {finished ? <button type="button" className="btn primary" onClick={onClose}>Done</button> : (
            <>
              <button type="button" className="btn ghost" onClick={onClose} disabled={running}>Cancel</button>
              <button type="button" className="btn primary" onClick={run} disabled={!good.length || running || !ctx}>
                {running ? 'Importing…' : `Import ${good.length || ''} driver${good.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}
