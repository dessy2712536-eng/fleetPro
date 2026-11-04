import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Badge, Modal, PageHead, RecordForm, fmtDateTime } from '../ui';

export default function Settings() {
  const { can } = useApp();
  return (
    <>
      <PageHead title="Settings" />
      <CompanySettings />
      <CarPrices />
      <ChangePassword />
      {can('admin') && <Users />}
      {can('manager') && <Activity />}
      {can('admin') && <StartAgain />}
    </>
  );
}

/** Price a work & pay driver pays to own each car model, e.g. Livan X3 Pro = 500,000. */
function CarPrices() {
  const { settings, setSettings, can, notify, money } = useApp();
  const parse = () => { try { return Object.entries(JSON.parse(settings.model_prices || '{}')).map(([model, price]) => ({ model, price: String(price) })); } catch { return []; } };
  const [rows, setRows] = useState(parse);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(parse()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [settings.model_prices]);
  const admin = can('admin');
  const save = async () => {
    setError('');
    const clean = rows.filter(r => r.model.trim() || r.price);
    if (clean.some(r => !r.model.trim() || !(Number(String(r.price).replace(/,/g, '')) > 0))) { setError('Give every row a car model and a price above 0.'); return; }
    const obj = Object.fromEntries(clean.map(r => [r.model.trim(), Number(String(r.price).replace(/,/g, ''))]));
    setBusy(true);
    try { setSettings(await api('/settings', { method: 'PUT', body: { model_prices: JSON.stringify(obj) } })); notify('Car prices saved'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <section className="panel settings-block">
      <h2>Car prices (work & pay)</h2>
      <p className="dim">What a work & pay driver pays in total to own each car model. It applies to every driver on that model, including drivers who already have the car. The model must match how the car is named in FleetPro, e.g. <em>Livan X3 Pro</em> (spaces and capitals don't matter). Models without a price use the daily payment × every working day in the term.</p>
      {!admin ? (
        <dl className="facts-inline">{rows.length ? rows.map(r => <div key={r.model}><dt>{r.model}</dt><dd>{money(r.price)}</dd></div>) : <div><dd className="dim">No prices set</dd></div>}</dl>
      ) : (
        <div className="form">
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="price-rows">
            {rows.map((r, i) => (
              <div className="price-row" key={i}>
                <input aria-label="Car model" placeholder="Car model, e.g. Livan X3 Pro" value={r.model} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, model: e.target.value } : x))} />
                <input aria-label="Price" inputMode="numeric" placeholder="Price, e.g. 500000" value={r.price} onChange={e => setRows(rs => rs.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
                <button type="button" className="link-btn danger" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          <footer className="form-actions">
            <button type="button" className="btn ghost" onClick={() => setRows(rs => [...rs, { model: '', price: '' }])}>Add a car model</button>
            <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save car prices'}</button>
          </footer>
        </div>
      )}
    </section>
  );
}

/** Delete every car, driver and record, plus all non-admin users, so everything can be entered again. */
function StartAgain() {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/admin/reset', { method: 'POST', body: { confirm: typed } });
      const n = r.removed || {};
      notify(`Started again: removed ${n.vehicles || 0} cars, ${n.drivers || 0} drivers, ${n.payments || 0} payments and ${n.users || 0} users`);
      setOpen(false); setTyped('');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <section className="panel settings-block danger-block">
      <h2>Start again</h2>
      <p>Permanently deletes <strong>all cars, drivers, contracts, payments, days off, check-ins, maintenance, expenses and the activity log</strong>, and <strong>every manager account</strong>. Admin accounts and these Settings (rates, car prices, deposits) are kept. This can't be undone.</p>
      <p className="dim">Before you do this, make a backup: in your FleetPro Google Sheet choose <em>File → Make a copy</em>.</p>
      <button type="button" className="btn danger" onClick={() => setOpen(true)}>Delete all data…</button>
      {open && (
        <Modal title="Delete all data?" onClose={() => !busy && setOpen(false)}>
          <div className="form">
            {error && <div className="form-error" role="alert">{error}</div>}
            <p>Everything except admin accounts and Settings will be deleted from your Google Sheet. Have you made a backup copy of the Sheet?</p>
            <div className="field">
              <label htmlFor="confirm-delete">Type <strong>DELETE</strong> to confirm</label>
              <input id="confirm-delete" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoFocus />
            </div>
            <footer className="form-actions">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn danger" onClick={run} disabled={typed !== 'DELETE' || busy}>{busy ? 'Deleting…' : 'Delete all data'}</button>
            </footer>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Shrink an image file to a small data URL that fits in one Google Sheets cell (under ~44,000 characters). */
async function shrinkLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
    let side = 256;
    for (let attempt = 0; attempt < 8; attempt++, side = Math.round(side * 0.8)) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth || side, img.naturalHeight || side));
      const w = Math.max(1, Math.round((img.naturalWidth || side) * scale)), h = Math.max(1, Math.round((img.naturalHeight || side) * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let data = c.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/png'); // browsers without WebP
      if (data.length > 44000) {
        const j = document.createElement('canvas'); j.width = w; j.height = h;
        const ctx = j.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        const jpg = j.toDataURL('image/jpeg', 0.82);
        if (jpg.length < data.length) data = jpg;
      }
      if (data.length <= 44000) return data;
    }
    throw new Error('too big');
  } finally { URL.revokeObjectURL(url); }
}

function LogoUpload() {
  const { settings, setSettings, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async logo => {
    setBusy(true); setError('');
    try { setSettings(await api('/settings', { method: 'PUT', body: { logo } })); notify(logo ? 'Logo saved' : 'Logo removed'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const onFile = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { setError('Choose an image file (PNG, JPG or WebP).'); return; }
    try { await save(await shrinkLogo(f)); }
    catch { setError("Couldn't use that image. Try a PNG or JPG."); }
  };
  return (
    <div className="logo-row">
      <div className="logo-preview" aria-hidden>{settings.logo ? <img src={settings.logo} alt="" /> : <span className="dim">No logo</span>}</div>
      <div className="logo-actions">
        <strong>Logo</strong>
        <span className="dim small">Shown next to your company name in the menu and on the sign-in page. A square logo works best; it's resized automatically.</span>
        <div className="upload-row">
          <label className={`btn ghost sm file-btn ${busy ? 'is-loading' : ''}`}>
            {busy ? 'Saving…' : settings.logo ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={onFile} disabled={busy} />
          </label>
          {settings.logo && <button type="button" className="link-btn danger" onClick={() => save('')} disabled={busy}>Remove</button>}
        </div>
        {error && <span className="err">{error}</span>}
      </div>
    </div>
  );
}

function CompanySettings() {
  const { settings, setSettings, can, notify } = useApp();
  const fields = [
    { name: 'company_name', label: 'Company name' },
    { name: 'currency', label: 'Currency code', hint: 'Shown before every amount, e.g. GHS, USD, NGN' },
    { name: 'distance_unit', label: 'Distance unit', type: 'select', options: ['km', 'mi'], required: true },
    { name: 'alert_days', label: 'Warn this many days ahead', type: 'number', hint: 'For expiring documents and services due' },
    { name: 'rate_work_and_pay', label: 'Work & pay daily payment', type: 'number' },
    { name: 'contract_years', label: 'Work & pay term (years)', type: 'number' },
    { name: 'rate_cerio', label: 'Cerio daily payment', type: 'number' },
    { name: 'rate_byd', label: 'BYD daily payment', type: 'number' },
    { name: 'rate_other_daily', label: 'Other daily hire payment', type: 'number' },
    { name: 'arrears_alert_days', label: 'Alert when a driver is this many days behind', type: 'number' },
    { name: 'deposit_min', label: 'Minimum deposit (retrieved car)', type: 'number' },
    { name: 'deposit_new_car', label: 'Deposit for a new car', type: 'number' },
  ];
  const [key, setKey] = useState(0);
  if (!can('admin')) {
    return (
      <section className="panel settings-block">
        <h2>Company</h2>
        <dl className="facts-inline">{fields.map(f => <div key={f.name}><dt>{f.label}</dt><dd>{settings[f.name]}</dd></div>)}</dl>
        <p className="dim">Only admins can change these.</p>
      </section>
    );
  }
  return (
    <section className="panel settings-block">
      <h2>Company</h2>
      <LogoUpload />
      <RecordForm key={key} fields={fields} initial={settings} submitLabel="Save settings" onCancel={() => setKey(k => k + 1)}
        onSubmit={async f => { setSettings(await api('/settings', { method: 'PUT', body: f })); notify('Settings saved'); }} />
    </section>
  );
}

function ChangePassword() {
  const { notify } = useApp();
  const [key, setKey] = useState(0);
  const fields = [
    { name: 'current_password', label: 'Current password', type: 'password', required: true },
    { name: 'new_password', label: 'New password', type: 'password', required: true, hint: 'At least 8 characters' },
  ];
  return (
    <section className="panel settings-block">
      <h2>Your password</h2>
      <RecordForm key={key} fields={fields} initial={{}} submitLabel="Change password" onCancel={() => setKey(k => k + 1)}
        onSubmit={async f => { await api('/auth/change-password', { method: 'POST', body: f }); notify('Password changed'); setKey(k => k + 1); }} />
    </section>
  );
}

const ROLE_HELP = 'Managers see and manage only the cars and drivers assigned to them. Admins see the whole fleet and manage users and settings.';

function Users() {
  const { notify, user: me } = useApp();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api('/users').then(r => setRows(r.rows));
  useEffect(() => { load(); }, []);

  const fields = [
    { name: 'name', label: 'Name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', options: editing?.role === 'viewer' ? ['viewer', 'manager', 'admin'] : ['manager', 'admin'], required: true, hint: ROLE_HELP, span: 2 },
    { name: 'password', label: editing?.id ? 'New password (optional)' : 'Password', type: 'password', required: !editing?.id },
    { name: 'active', label: 'Can sign in', type: 'checkbox' },
  ];
  const save = async f => {
    if (editing.id) await api(`/users/${editing.id}`, { method: 'PUT', body: f });
    else await api('/users', { method: 'POST', body: f });
    notify(editing.id ? 'User updated' : 'User added'); setEditing(null); load();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${editing.email}?`)) return;
    try { await api(`/users/${editing.id}`, { method: 'DELETE' }); notify('User deleted'); setEditing(null); load(); }
    catch (e) { notify(e.message, 'bad'); }
  };

  return (
    <section className="panel settings-block">
      <header className="panel-head"><h2>Users</h2><button className="btn primary sm" onClick={() => setEditing({})}>Add user</button></header>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th /></tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong>{u.id === me.id && <span className="dim"> (you)</span>}</td>
                <td>{u.email}</td>
                <td><Badge value={u.role} /></td>
                <td>{u.active ? 'Can sign in' : <span className="txt-bad">Disabled</span>}</td>
                <td className="row-actions"><button className="link-btn" onClick={() => setEditing(u)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'Add user'} onClose={() => setEditing(null)}>
          <RecordForm fields={fields} initial={editing.id ? { ...editing, active: editing.active ? 1 : 0 } : { role: 'manager', active: 1 }}
            onSubmit={save} onCancel={() => setEditing(null)} submitLabel={editing.id ? 'Save changes' : 'Add user'} />
          {editing.id && editing.id !== me.id && <div className="danger-zone"><button className="link-btn danger" onClick={remove}>Delete this user</button></div>}
        </Modal>
      )}
    </section>
  );
}

function Activity() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api('/audit', { query: { limit: 50 } }).then(r => setRows(r.rows)).catch(() => {}); }, []);
  return (
    <section className="panel settings-block">
      <h2>Activity log</h2>
      <p className="dim">The last 50 changes, newest first.</p>
      <ul className="activity">
        {rows.map(a => (
          <li key={a.id}>
            <Badge value={a.action} tone={a.action === 'delete' ? 'bad' : a.action === 'create' ? 'ok' : 'info'} />
            <span><strong>{a.user_name || 'System'}</strong> {a.action}d {a.entity.toLowerCase()} {a.summary && <span className="dim">{a.summary}</span>}</span>
            <span className="dim when">{fmtDateTime(a.created_at)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="empty">No changes recorded yet.</li>}
      </ul>
    </section>
  );
}
