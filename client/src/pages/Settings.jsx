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
      <ChangePassword />
      {can('admin') && <Users />}
      {can('manager') && <Activity />}
    </>
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
