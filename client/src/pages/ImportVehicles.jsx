import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Plate, fmtDate, invalidateOptions, useOptions } from '../ui';

// Column names people commonly use, mapped to FleetPro fields.
const HEADERS = {
  reg_number: ['reg', 'registration', 'reg number', 'reg no', 'car number', 'number plate', 'plate', 'number', 'vehicle number', 'car no', 'plate number'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model', 'car', 'vehicle', 'car model', 'make and model', 'make & model', 'make/model'],
  year: ['year', 'model year'],
  color: ['color', 'colour'],
  vin: ['vin', 'chassis', 'chassis number', 'chassis no'],
  fuel_type: ['fuel', 'fuel type'],
  current_odometer: ['odometer', 'mileage', 'km', 'odometer km'],
  insurance_expiry: ['insurance expiry', 'insurance', 'insurance expires'],
  roadworthy_expiry: ['roadworthy expiry', 'roadworthy', 'roadworthy expires'],
  registration_expiry: ['registration expiry', 'registration expires', 'dvla expiry'],
  purchase_date: ['purchase date', 'date bought', 'bought on'],
  purchase_price: ['purchase price', 'price', 'cost'],
  notes: ['notes', 'note', 'comments', 'remarks'],
  manager: ['manager', 'manager name', 'managed by', 'supervisor'],
};
const DATE_FIELDS = ['insurance_expiry', 'roadworthy_expiry', 'registration_expiry', 'purchase_date'];
const LABELS = { insurance_expiry: 'Insurance expiry', roadworthy_expiry: 'Roadworthy expiry', registration_expiry: 'Registration expiry', purchase_date: 'Purchase date' };

/** Excel date, "31/12/2026", "2026-12-31" or "31 Dec 2026" → "2026-12-31". Returns undefined if unreadable. */
export function toISODate(v) {
  if (v == null || v === '') return null;
  const pad = n => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial number
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // day first, as used in Ghana
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; if (+m[2] <= 12 && +m[1] <= 31) return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  const parsed = Date.parse(t + ' 12:00 UTC');
  if (!isNaN(parsed)) { const d = new Date(parsed); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  return undefined;
}

const TEMPLATE_COLUMNS = [
  ['Car number *', 16], ['Make *', 14], ['Model *', 14], ['Manager', 18], ['Year', 8], ['Fuel type', 11], ['Colour', 10], ['Chassis number', 20],
  ['Odometer (km)', 14], ['Insurance expiry', 16], ['Roadworthy expiry', 17], ['Registration expiry', 18], ['Purchase date', 14], ['Purchase price', 14], ['Notes', 30],
];

export async function downloadTemplate() {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const head = TEMPLATE_COLUMNS.map(([v]) => ({ value: v, fontWeight: 'bold', backgroundColor: '#F2B705', height: 22 }));
  const help = [
    [{ value: 'How to fill in the FleetPro car list', fontWeight: 'bold', height: 24 }],
    [''],
    ['1. Use the "Cars" sheet. Put one car on each row, starting on row 2. Keep the header row as it is.'],
    ['2. Car number, Make and Model are required. Everything else is optional and can be added later in FleetPro.'],
    ['   Manager: type the manager\'s name exactly as it appears in FleetPro (Settings → Users), or leave it empty and choose one manager for all the cars when you upload.'],
    ['3. Fuel type: Petrol, Diesel, Electric or Hybrid. Leave it empty and Cerio/BYD cars become Electric, others Petrol.'],
    ['4. Dates: type them as 31/12/2026 (day/month/year) or pick them from Excel\'s date picker.'],
    ['5. Save the file, then in FleetPro go to Cars → Import cars → Upload the filled-in file.'],
    ['6. Cars already in FleetPro are skipped, so you can upload the same file again safely.'],
    [''],
    [{ value: 'Examples (do not type these into the Cars sheet unless they are your cars):', fontWeight: 'bold' }],
    head.map(h => ({ ...h, backgroundColor: '#E7ECEA' })),
    ['GR 4521-21', 'Toyota', 'Vitz', 'Samuel Adjei', 2019, 'Petrol', 'Silver', 'JT1234567890', 85000, '31/03/2027', '15/06/2027', '10/01/2027', '15/02/2024', 145000, 'Work & pay car'],
    ['GR 1001-25', 'Cerio', 'EV', 'Grace Mensah', 2025, 'Electric', 'White', '', 12000, '20/08/2027', '', '', '', '', 'Daily hire, GHS 500'],
    ['GR 2001-25', 'BYD', 'Dolphin', '', 2025, 'Electric', 'Blue', '', 9000, '', '', '', '', '', 'Daily hire, GHS 700'],
  ];
  await writeExcelFile([
    { data: [head], sheet: 'Cars', columns: TEMPLATE_COLUMNS.map(([, w]) => ({ width: w })), stickyRowsCount: 1 },
    { data: help, sheet: 'How to fill', columns: TEMPLATE_COLUMNS.map(([, w], i) => ({ width: i === 0 ? 18 : w })) },
  ]).toFile('FleetPro car list.xlsx');
}
const EV_MAKES = /cerio|byd/i;

export function splitLine(line, delim) {
  if (delim === '\t') return line.split('\t').map(s => s.trim());
  // simple CSV with quotes
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCars(text) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : lines[0].includes(';') ? ';' : '\t';
  return parseRows(lines.map(l => splitLine(l, delim)));
}

export function parseRows(input) {
  let rows = input.filter(r => r && r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
  if (!rows.length) return [];

  // Header row?
  let map = null;
  const first = rows[0].map(c => String(c ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z/& ]/g, '').replace(/\s+/g, ' ').trim());
  const found = {};
  first.forEach((h, i) => {
    for (const [field, names] of Object.entries(HEADERS)) if (!(field in found) && names.includes(h)) { found[field] = i; break; }
  });
  if ('reg_number' in found || Object.keys(found).length >= 2) { map = found; rows = rows.slice(1); }
  if (!map) map = rows[0].length >= 3 ? { reg_number: 0, make: 1, model: 2 } : { reg_number: 0, model: 1 };

  return rows.map((r, i) => {
    const raw = f => (map[f] !== undefined ? r[map[f]] : null);
    const get = f => { const v = raw(f); return v == null ? '' : String(v).trim(); };
    const dates = {}; const badDates = [];
    DATE_FIELDS.forEach(f => { const d = toISODate(raw(f)); if (d === undefined) badDates.push(LABELS[f]); dates[f] = d || null; });
    const price = parseFloat(get('purchase_price').replace(/[^\d.]/g, ''));
    let make = get('make'), model = get('model');
    if (!make && model) { // "Toyota Vitz" in one column
      const parts = model.split(/\s+/);
      make = parts[0];
      model = parts.slice(1).join(' ') || (EV_MAKES.test(parts[0]) ? 'EV' : parts[0]);
    }
    if (make && !model) model = EV_MAKES.test(make) ? 'EV' : make;
    const fuel = (get('fuel_type') || '').toLowerCase();
    const yearNum = parseInt(get('year'), 10);
    const odo = parseFloat(get('current_odometer').replace(/[^\d.]/g, ''));
    return {
      line: i + 1,
      reg_number: get('reg_number').toUpperCase().replace(/\s+/g, ' '),
      make: make ? make.charAt(0).toUpperCase() + make.slice(1) : '',
      model,
      year: yearNum > 1950 && yearNum < 2100 ? yearNum : null,
      color: get('color') || null,
      vin: get('vin') || null,
      current_odometer: Number.isFinite(odo) ? odo : 0,
      fuel_type: ['petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng'].includes(fuel) ? fuel : (EV_MAKES.test(make) ? 'electric' : 'petrol'),
      type: 'car',
      status: 'active',
      purchase_price: Number.isFinite(price) ? price : null,
      notes: get('notes') || null,
      manager_text: get('manager'),
      ...dates,
      badDates,
    };
  });
}

const SAMPLE = 'Car number\tMake\tModel\nGR 4521-21\tToyota\tVitz\nGT 1182-22\tToyota\tCorolla\nGR 1001-25\tCerio\tEV\nGR 2001-25\tBYD\tDolphin';

export default function ImportVehicles({ onClose, onDone }) {
  const { user } = useApp();
  const managers = useOptions('manager');
  const [managerId, setManagerId] = useState(user.role === 'manager' ? String(user.id) : '');
  const [text, setText] = useState('');
  const [existing, setExisting] = useState(null);
  const [progress, setProgress] = useState(null); // {done, total, errors: []}

  const [fileRows, setFileRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const rows = useMemo(() => (fileRows ? parseRows(fileRows) : parseCars(text)), [text, fileRows]);
  const loadExisting = async () => {
    if (existing) return existing;
    const r = await api('/vehicles', { query: { limit: 5000 } });
    const set = new Set(r.rows.map(v => v.reg_number.toUpperCase().replace(/[\s-]/g, '')));
    setExisting(set);
    return set;
  };
  useEffect(() => {
    if ((text || fileRows) && !existing) loadExisting().catch(() => setExisting(new Set()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fileRows]);

  const key = r => r.reg_number.replace(/[\s-]/g, '');
  const seen = new Map();
  const findManager = name => managers.find(m => m.label.trim().toLowerCase() === name.trim().toLowerCase());
  const checked = rows.map(r => {
    let problem = null;
    const fromFile = r.manager_text ? findManager(r.manager_text) : null;
    const manager_id = user.role === 'manager' ? user.id : fromFile ? fromFile.value : (managerId ? Number(managerId) : null);
    const manager_label = (managers.find(m => m.value === manager_id) || {}).label || null;
    if (!r.reg_number) problem = 'No car number';
    else if (user.role !== 'manager' && r.manager_text && !fromFile) problem = `No manager called "${r.manager_text}"`;
    else if (!manager_id) problem = 'Choose a manager';
    else if (!r.make || !r.model) problem = 'No make/model';
    else if (r.badDates.length) problem = `Check date: ${r.badDates.join(', ')}`;
    else if (existing && existing.has(key(r))) problem = 'Already in FleetPro';
    else if (seen.has(key(r))) problem = 'Listed twice';
    seen.set(key(r), true);
    return { ...r, manager_id, manager_label, problem };
  });
  const good = checked.filter(r => !r.problem);

  const onFile = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress(null); setFileName(f.name);
    if (/\.xls$/i.test(f.name)) {
      setProgress({ done: 0, total: 0, errors: ['This is an old Excel file (.xls). In Excel choose File → Save As → Excel Workbook (.xlsx), then upload that.'] });
      return;
    }
    if (/\.xlsx$/i.test(f.name)) {
      import('read-excel-file/browser').then(async ({ readSheet }) => {
        let data;
        try { data = await readSheet(f, 'Cars'); } catch { data = await readSheet(f); }
        setFileRows(data); setText('');
      }).catch(() => setProgress({ done: 0, total: 0, errors: ["Couldn't read that Excel file. Check it's the FleetPro template saved as .xlsx."] }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setFileRows(null); setText(String(reader.result)); };
    reader.readAsText(f);
  };

  const run = async () => {
    const errors = [];
    setProgress({ done: 0, total: good.length, errors });
    for (let i = 0; i < good.length; i++) {
      const { line, problem, badDates, manager_text, manager_label, ...body } = good[i];
      try { await api('/vehicles', { method: 'POST', body }); }
      catch (e) { errors.push(`${body.reg_number}: ${e.message}${e.details && Object.values(e.details).length ? ' – ' + Object.values(e.details).join(', ') : ''}`); }
      setProgress({ done: i + 1, total: good.length, errors: [...errors] });
    }
    invalidateOptions();
    onDone(good.length - errors.length);
  };

  const finished = progress && progress.total > 0 && progress.done === progress.total;
  const running = progress && progress.total > 0 && !finished;

  return (
    <Modal title="Import cars" onClose={running ? () => {} : onClose} wide>
      <div className="form import">
        {!progress?.total && (
          <>
            <ol className="import-steps">
              <li>
                <strong>Download the Excel template</strong> and fill in one car per row: car number, make and model, plus any dates you have.
                <div><button type="button" className="btn ghost sm" onClick={() => downloadTemplate().catch(() => setProgress({ done: 0, total: 0, errors: ["Couldn't create the template. Check your internet connection and try again."] }))}>Download Excel template</button></div>
              </li>
              <li>
                <strong>Upload the filled-in file</strong>, then check the preview below.
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
                <label htmlFor="import-text">Paste your list</label>
                <textarea id="import-text" rows={6} value={text} onChange={e => { setText(e.target.value); setFileRows(null); setFileName(''); setProgress(null); }} placeholder={SAMPLE} spellCheck={false} />
              </div>
            </details>
            {progress?.errors?.length > 0 && <div className="form-error">{progress.errors[0]}</div>}
          </>
        )}

        {checked.length > 0 && !progress?.total && (
          <>
            {user.role !== 'manager' && (
              <div className="toolbar manager-pick">
                <label className="inline-label" htmlFor="import-manager">Manager for these cars
                  <select id="import-manager" value={managerId} onChange={e => setManagerId(e.target.value)}>
                    <option value="">Choose manager…</option>
                    {managers.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </label>
                <span className="dim">Rows with a manager in the file keep that manager.</span>
              </div>
            )}
            <p className="import-count"><strong>{good.length}</strong> car{good.length === 1 ? '' : 's'} ready to import{checked.length > good.length && <> · <span className="txt-warn">{checked.length - good.length} will be skipped</span></>}</p>
            <div className="table-wrap import-preview">
              <table className="data">
                <thead><tr><th>Car number</th><th>Make</th><th>Model</th><th>Manager</th><th>Fuel</th><th>Year</th><th>Insurance</th><th>Roadworthy</th><th /></tr></thead>
                <tbody>
                  {checked.map(r => (
                    <tr key={r.line} className={r.problem ? 'skip' : ''}>
                      <td>{r.reg_number ? <Plate>{r.reg_number}</Plate> : <span className="dim">—</span>}</td>
                      <td>{r.make || <span className="dim">—</span>}</td>
                      <td>{r.model || <span className="dim">—</span>}</td>
                      <td>{r.manager_label || r.manager_text || <span className="dim">—</span>}</td>
                      <td>{r.fuel_type === 'electric' ? 'Electric' : 'Petrol'}</td>
                      <td>{r.year || <span className="dim">—</span>}</td>
                      <td>{r.insurance_expiry ? fmtDate(r.insurance_expiry) : <span className="dim">—</span>}</td>
                      <td>{r.roadworthy_expiry ? fmtDate(r.roadworthy_expiry) : <span className="dim">—</span>}</td>
                      <td>{r.problem ? <span className="txt-warn">{r.problem}</span> : <span className="txt-ok">Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Cerio and BYD cars are set as electric unless your file says otherwise. You can edit any car after importing.</p>
          </>
        )}

        {progress?.total > 0 && (
          <div className="import-progress" role="status">
            <p><strong>{finished ? `Imported ${progress.done - progress.errors.length} of ${progress.total} cars.` : `Importing ${progress.done} of ${progress.total}…`}</strong></p>
            <div className="progress big"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            {!finished && <p className="dim">Each car takes a second or two to save to your Google Sheet. Keep this window open.</p>}
            {progress.errors.length > 0 && (
              <div className="form-error">
                {progress.errors.length} car{progress.errors.length === 1 ? '' : 's'} could not be imported:
                <ul>{progress.errors.map(e => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <footer className="form-actions">
          {finished ? (
            <button type="button" className="btn primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn ghost" onClick={onClose} disabled={running}>Cancel</button>
              <button type="button" className="btn primary" onClick={run} disabled={!good.length || running || !existing}>
                {running ? 'Importing…' : `Import ${good.length || ''} car${good.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}
