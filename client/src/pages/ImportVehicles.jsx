import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Modal, Plate, invalidateOptions } from '../ui';

// Column names people commonly use, mapped to FleetPro fields.
const HEADERS = {
  reg_number: ['reg', 'registration', 'reg number', 'reg no', 'car number', 'number plate', 'plate', 'number', 'vehicle number', 'car no', 'plate number'],
  make: ['make', 'brand', 'manufacturer'],
  model: ['model', 'car', 'vehicle', 'car model', 'make and model', 'make & model', 'make/model'],
  year: ['year', 'model year'],
  color: ['color', 'colour'],
  vin: ['vin', 'chassis', 'chassis number', 'chassis no'],
  fuel_type: ['fuel', 'fuel type'],
  current_odometer: ['odometer', 'mileage', 'km'],
};
const EV_MAKES = /cerio|byd/i;

function splitLine(line, delim) {
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
  let rows = lines.map(l => splitLine(l, delim));

  // Header row?
  let map = null;
  const first = rows[0].map(c => c.toLowerCase().replace(/[^a-z/& ]/g, '').trim());
  const found = {};
  first.forEach((h, i) => {
    for (const [field, names] of Object.entries(HEADERS)) if (!(field in found) && names.includes(h)) { found[field] = i; break; }
  });
  if ('reg_number' in found || Object.keys(found).length >= 2) { map = found; rows = rows.slice(1); }
  if (!map) map = rows[0].length >= 3 ? { reg_number: 0, make: 1, model: 2 } : { reg_number: 0, model: 1 };

  return rows.map((r, i) => {
    const get = f => (map[f] !== undefined ? (r[map[f]] || '').trim() : '');
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
    };
  });
}

const SAMPLE = 'Car number\tMake\tModel\nGR 4521-21\tToyota\tVitz\nGT 1182-22\tToyota\tCorolla\nGR 1001-25\tCerio\tEV\nGR 2001-25\tBYD\tDolphin';

export default function ImportVehicles({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [existing, setExisting] = useState(null);
  const [progress, setProgress] = useState(null); // {done, total, errors: []}

  const rows = useMemo(() => parseCars(text), [text]);
  const loadExisting = async () => {
    if (existing) return existing;
    const r = await api('/vehicles', { query: { limit: 5000 } });
    const set = new Set(r.rows.map(v => v.reg_number.toUpperCase().replace(/[\s-]/g, '')));
    setExisting(set);
    return set;
  };
  useEffect(() => {
    if (text && !existing) loadExisting().catch(() => setExisting(new Set()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const key = r => r.reg_number.replace(/[\s-]/g, '');
  const seen = new Map();
  const checked = rows.map(r => {
    let problem = null;
    if (!r.reg_number) problem = 'No car number';
    else if (!r.make || !r.model) problem = 'No make/model';
    else if (existing && existing.has(key(r))) problem = 'Already in FleetPro';
    else if (seen.has(key(r))) problem = 'Listed twice';
    seen.set(key(r), true);
    return { ...r, problem };
  });
  const good = checked.filter(r => !r.problem);

  const onFile = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      setProgress({ done: 0, total: 0, errors: ['Excel files can\'t be read directly. Open the file, select the columns, copy (Command + C) and paste into the box instead, or save it as CSV.'] });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result)); setProgress(null); };
    reader.readAsText(f);
  };

  const run = async () => {
    const errors = [];
    setProgress({ done: 0, total: good.length, errors });
    for (let i = 0; i < good.length; i++) {
      const { line, problem, ...body } = good[i];
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
            <p className="sub">Copy your list from Excel or Google Sheets and paste it below. Include the car number and the make and model, in separate columns or together like <em>Toyota Vitz</em>. A header row is optional.</p>
            <div className="field">
              <label htmlFor="import-text">Paste your list</label>
              <textarea id="import-text" rows={7} value={text} onChange={e => { setText(e.target.value); setProgress(null); }} placeholder={SAMPLE} spellCheck={false} />
              <small className="hint">Or choose a CSV file: <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" onChange={onFile} aria-label="Choose CSV file" /></small>
            </div>
            {progress?.errors?.length > 0 && <div className="form-error">{progress.errors[0]}</div>}
          </>
        )}

        {checked.length > 0 && !progress?.total && (
          <>
            <p className="import-count"><strong>{good.length}</strong> car{good.length === 1 ? '' : 's'} ready to import{checked.length > good.length && <> · <span className="txt-warn">{checked.length - good.length} will be skipped</span></>}</p>
            <div className="table-wrap import-preview">
              <table className="data">
                <thead><tr><th>Car number</th><th>Make</th><th>Model</th><th>Fuel</th><th>Year</th><th /></tr></thead>
                <tbody>
                  {checked.map(r => (
                    <tr key={r.line} className={r.problem ? 'skip' : ''}>
                      <td>{r.reg_number ? <Plate>{r.reg_number}</Plate> : <span className="dim">—</span>}</td>
                      <td>{r.make || <span className="dim">—</span>}</td>
                      <td>{r.model || <span className="dim">—</span>}</td>
                      <td>{r.fuel_type === 'electric' ? 'Electric' : 'Petrol'}</td>
                      <td>{r.year || <span className="dim">—</span>}</td>
                      <td>{r.problem ? <span className="txt-warn">{r.problem}</span> : <span className="txt-ok">Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Cerio and BYD cars are set as electric; everything else as petrol. You can edit any car after importing to add insurance and roadworthy dates.</p>
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
