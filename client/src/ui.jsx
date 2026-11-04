import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadCsv } from './api';
import { useApp } from './context';

const ACRONYMS = { new_driver: 'New driver', existing_driver: 'Existing driver (before FleetPro)', suv: 'SUV', lpg: 'LPG', cng: 'CNG', mon_sat: 'Mon–Sat', every_day: 'Every day', work_and_pay: 'Work & pay', none: 'No complaint', continue: 'Continuing', daily: 'Daily payment', waiver: 'Excused days' };
/** Ghana Card: "gha 1234567890" → "GHA-123456789-0". Returns null unless there are exactly 10 digits. */
export const normalizeGhanaCard = v => {
  const d = String(v ?? '').toUpperCase().replace(/^\s*GHA/, '').replace(/\D/g, '');
  return d.length === 10 ? `GHA-${d.slice(0, 9)}-${d.slice(9)}` : null;
};
export const GHANA_CARD_RE = /^GHA-\d{9}-\d$/;
/** Formats as the user types: digits only, GHA- added in front and a dash before the last digit. */
const formatGhanaCardTyping = v => {
  const raw = String(v ?? '').toUpperCase();
  const d = raw.replace(/^\s*G?H?A?-?/, '').replace(/\D/g, '').slice(0, 10);
  if (!d) return /^[GHA-]*$/.test(raw) ? raw.slice(0, 4) : '';
  return `GHA-${d.slice(0, 9)}${d.length > 9 ? '-' + d.slice(9) : ''}`;
};

/** The company's logo and name when a logo is set; otherwise the FleetPro mark. */
export function Brand({ big = false }) {
  const { branding } = useApp();
  const name = branding.company_name && branding.company_name !== 'My Fleet' ? branding.company_name : null;
  if (branding.logo) {
    return (
      <div className={`brand has-logo ${big ? 'big' : ''}`}>
        <img src={branding.logo} alt="" className="brand-logo" />
        <span className="brand-name">{name || 'FleetPro'}</span>
      </div>
    );
  }
  return <div className={`brand ${big ? 'big' : ''}`}><span className="brand-mark" />{big && name ? name : 'FleetPro'}</div>;
}

export const human = v => (v == null || v === '' ? '—' : ACRONYMS[v] || String(v).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()));
export const fmtDate = v => (v ? new Date(v.length === 10 ? v + 'T00:00' : v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = v => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

/** Registration numbers are shown as number plates — the app's signature element. */
export function Plate({ children, to }) {
  const p = <span className="plate">{children}</span>;
  return to ? <Link to={to} className="plate-link">{p}</Link> : p;
}

const TONE = {
  active: 'ok', completed: 'ok', in_progress: 'info', planned: 'muted', scheduled: 'muted',
  in_maintenance: 'warn', on_leave: 'warn', urgent: 'warn', upcoming: 'muted',
  inactive: 'muted', disposed: 'muted', cancelled: 'muted', overdue: 'bad',
  admin: 'info', manager: 'ok', viewer: 'muted',
  stopped: 'bad', handed_over: 'info', wants_to_stop: 'bad', undecided: 'warn', continue: 'ok',
  good: 'ok', needs_attention: 'warn', in_workshop: 'warn', accident: 'bad', off_road: 'bad',
  open: 'warn', resolved: 'ok', none: 'muted', work_and_pay: 'info', daily_hire: 'muted',
  daily: 'ok', waiver: 'warn', adjustment: 'muted', new: 'ok', retrieved: 'info',
};
export const Badge = ({ value, tone }) => <span className={`badge tone-${tone || TONE[value] || 'muted'}`}>{human(value)}</span>;

export function ExpiryCell({ date }) {
  if (!date) return <span className="dim">—</span>;
  const days = Math.round((new Date(date + 'T00:00') - new Date(todayStr() + 'T00:00')) / 86400000);
  const tone = days < 0 ? 'bad' : days <= 30 ? 'warn' : '';
  return <span className={tone ? `txt-${tone}` : ''} title={days < 0 ? `Expired ${-days} days ago` : `${days} days left`}>{fmtDate(date)}</span>;
}

/**
 * While a menu or pop-up is open, the page behind it stays still: only the menu/pop-up scrolls.
 * Works on laptops, iPads and phones (iOS Safari ignores overflow:hidden on body, so the body is pinned in place).
 */
let locks = 0, savedY = 0;
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (locks++ === 0) {
      savedY = window.scrollY;
      const b = document.body.style;
      const gap = window.innerWidth - document.documentElement.clientWidth; // stop the page jumping when the scrollbar hides
      Object.assign(b, { position: 'fixed', top: `-${savedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden', paddingRight: gap > 0 ? `${gap}px` : '' });
    }
    return () => {
      if (--locks === 0) {
        const b = document.body.style;
        Object.assign(b, { position: '', top: '', left: '', right: '', width: '', overflow: '', paddingRight: '' });
        window.scrollTo(0, savedY);
      }
    };
  }, [active]);
}

export function Modal({ title, onClose, children, wide }) {
  useScrollLock(true);
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></header>
        {children}
      </div>
    </div>
  );
}

// ---- Option lookups (vehicles, drivers, schedules), cached per session ----
const cache = {};
export function invalidateOptions(kind) { if (kind) delete cache[kind]; else Object.keys(cache).forEach(k => delete cache[k]); }
export const cachedOption = (kind, id) => (cache[kind] || []).find(o => o.value === Number(id));
export function useOptions(kind) {
  const [opts, setOpts] = useState(cache[kind] || []);
  useEffect(() => {
    if (cache[kind]) return setOpts(cache[kind]);
    const path = { vehicle: '/vehicles', driver: '/drivers', schedule: '/maintenance/schedules', contract: '/contracts', manager: '/managers' }[kind];
    api(path, { query: { limit: 1000 } }).then(r => {
      const label = x => ({
        vehicle: () => `${x.reg_number} · ${x.make} ${x.model}`,
        driver: () => x.name,
        schedule: () => `${x.reg_number} · ${x.service_type}`,
        contract: () => `${x.driver_name} · ${x.reg_number}${x.status !== 'active' ? ` (${x.status})` : ''}`,
        manager: () => x.name,
      })[kind]();
      cache[kind] = r.rows.map(x => ({
        value: x.id, label: label(x),
        vehicle_id: x.vehicle_id, status: x.status, daily_rate: x.daily_rate, type: x.type, contract_id: x.contract_id, next_unpaid_day: x.next_unpaid_day, manager_id: x.manager_id,
        reg_number: x.reg_number, make: x.make, model: x.model, assigned_driver_id: x.assigned_driver_id, driver_name: x.driver_name, manager_name: x.manager_name,
        condition: x.condition, next_condition: x.next_condition,
      })).sort((a, b) => (kind === 'contract' ? (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) : 0) || a.label.localeCompare(b.label));
      setOpts(cache[kind]);
    }).catch(() => {});
  }, [kind]);
  return opts;
}

/**
 * Payment form: lists every car the user can see. Picking a car selects its current driver's contract
 * (the field's value is the contract id). Cars without a driver are listed but can't be picked.
 */
function PayCarPick({ value, onChange, ...rest }) {
  const { user } = useApp();
  const cars = useOptions('vehicle').filter(o => o.status !== 'disposed' && o.status !== 'handed_over');
  const contracts = useOptions('contract');
  const byCar = new Map(contracts.filter(c => c.status === 'active').map(c => [c.vehicle_id, c]));
  const fmt = n => Number(n).toLocaleString();
  const carLabel = o => `${o.reg_number} · ${o.make} ${o.model}`;
  const ready = cars.filter(o => byCar.has(o.value)).sort((a, b) => a.reg_number.localeCompare(b.reg_number));
  const notReady = cars.filter(o => !byCar.has(o.value)).sort((a, b) => a.reg_number.localeCompare(b.reg_number));
  // When editing an old payment whose contract has ended, keep it selectable.
  const current = value && !ready.some(o => byCar.get(o.value).value === value) ? contracts.find(c => c.value === value) : null;
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} {...rest}>
      <option value="">{cars.length ? 'Select car…' : 'No cars yet'}</option>
      {current && <option value={current.value}>{current.label}</option>}
      {ready.length > 0 && (
        <optgroup label={`${user.role === 'manager' ? 'Your cars' : 'Cars'} with a driver (${ready.length})`}>
          {ready.map(o => { const c = byCar.get(o.value); return (
            <option key={o.value} value={c.value}>{carLabel(o)} – {c.driver_name} ({c.type === 'daily_hire' ? 'daily hire' : 'work & pay'}, {fmt(c.daily_rate)}/day)</option>
          ); })}
        </optgroup>
      )}
      {notReady.length > 0 && (
        <optgroup label={`Can't take payments yet (${notReady.length})`}>
          {notReady.map(o => <option key={o.value} value="" disabled>{carLabel(o)} – {o.assigned_driver_id ? `${o.driver_name || 'driver'}: set up contract first` : 'no driver'}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/** Every car the user can see. Free cars can be picked; cars that already have a driver are shown but greyed out. */
function CarPick({ value, onChange, allowDriverId, ...rest }) {
  const { user } = useApp();
  const all = useOptions('vehicle').filter(o => o.status !== 'disposed' && o.status !== 'handed_over');
  const free = all.filter(o => !o.assigned_driver_id || (allowDriverId && o.assigned_driver_id === allowDriverId));
  const taken = all.filter(o => o.assigned_driver_id && !(allowDriverId && o.assigned_driver_id === allowDriverId));
  const cond = o => (o.assigned_driver_id ? '' : o.next_condition === 'retrieved' ? ' · Retrieved' : o.next_condition === 'new' ? ' · New' : '');
  const label = o => `${o.reg_number} · ${o.make} ${o.model}${cond(o)}${o.status === 'in_maintenance' ? ' (in workshop)' : ''}${user.role === 'admin' && o.manager_name ? ` · ${o.manager_name}` : ''}`;
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} {...rest}>
      <option value="">{all.length ? 'No car for now' : 'No cars yet – add cars first'}</option>
      {free.length > 0 && <optgroup label={`Available (${free.length})`}>{free.map(o => <option key={o.value} value={o.value}>{label(o)}</option>)}</optgroup>}
      {taken.length > 0 && <optgroup label={`Already has a driver (${taken.length})`}>{taken.map(o => <option key={o.value} value={o.value} disabled>{label(o)} – {o.driver_name || 'driver'}</option>)}</optgroup>}
    </select>
  );
}

function RefSelect({ kind, value, onChange, filterVehicle, onlyManager, onlyFree, ...rest }) {
  let opts = useOptions(kind);
  if (onlyManager !== undefined) opts = opts.filter(o => o.manager_id === onlyManager || o.value === value);
  if (onlyFree) opts = opts.filter(o => (!o.contract_id && o.status === 'active') || o.value === value);
  if (kind === 'schedule' && filterVehicle) opts = opts.filter(o => o.vehicle_id === Number(filterVehicle));
  if (kind === 'contract') opts = opts.filter(o => o.status === 'active' || o.value === value);
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} {...rest}>
      <option value="">{onlyFree && opts.length === 0 ? 'No free drivers in this group – add a driver first' : kind === 'schedule' ? 'Not linked to a schedule' : kind === 'manager' ? (rest.required ? 'Select manager…' : 'No manager') : kind === 'contract' ? 'Select driver…' : `Select ${kind}…`}</option>
      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ f, value, onChange, error, form }) {
  const id = `f-${f.name}`;
  const common = { id, name: f.name, required: f.required, 'aria-invalid': !!error };
  let input;
  switch (f.type) {
    case 'select':
      input = (
        <select {...common} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
          {!f.required && <option value="">—</option>}
          {f.options.map(o => <option key={o} value={o}>{human(o)}</option>)}
        </select>
      );
      break;
    case 'paycar':
      input = <PayCarPick {...common} value={value} onChange={onChange} />;
      break;
    case 'carpick':
      input = <CarPick {...common} value={value} onChange={onChange} allowDriverId={typeof f.allowDriverId === 'function' ? f.allowDriverId(form || {}) : f.allowDriverId} />;
      break;
    case 'vehicle': case 'driver': case 'schedule': case 'contract': case 'manager':
      input = <RefSelect {...common} kind={f.type} value={value} onChange={onChange} filterVehicle={form?.vehicle_id} onlyManager={f.onlyManager} onlyFree={f.onlyFree} />;
      break;
    case 'ghanacard':
      input = (
        <input {...common} type="text" inputMode="numeric" autoComplete="off" placeholder="GHA-XXXXXXXXX-X" maxLength={15}
          value={value ?? ''} onChange={e => onChange(formatGhanaCardTyping(e.target.value))} />
      );
      break;
    case 'hidden':
      return null;
    case 'heading':
      return <div className="form-heading span-2"><h3>{f.label}</h3>{f.hint && <small className="hint">{typeof f.hint === 'function' ? f.hint(form || {}) : f.hint}</small>}</div>;
    case 'textarea':
      input = <textarea {...common} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
      break;
    case 'checkbox':
      return (
        <label className="check span-2">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? 1 : 0)} /> {f.label}
        </label>
      );
    default:
      input = (
        <input {...common}
          type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'}
          step={f.type === 'number' ? 'any' : undefined}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)} />
      );
  }
  return (
    <div className={`field ${f.span === 2 || f.type === 'textarea' ? 'span-2' : ''}`}>
      <label htmlFor={id}>{f.label}{f.required && <span className="req" aria-hidden> *</span>}</label>
      {input}
      {f.hint && !error && <small className="hint">{typeof f.hint === 'function' ? f.hint(form || {}) : f.hint}</small>}
      {error && <small className="err">{error}</small>}
    </div>
  );
}

export function RecordForm({ fields, initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setMsg(''); setErrors({});
    try { await onSubmit(form); }
    catch (err) {
      const details = err.details || {};
      // Errors for fields this form doesn't show (e.g. the car, when the car is fixed) go in the message itself.
      const shown = new Set(fields.filter(f => !f.showIf || f.showIf(form)).map(f => f.name));
      const hidden = Object.entries(details).filter(([k]) => !shown.has(k)).map(([, v]) => v);
      setMsg(hidden.length ? hidden.join(' ') : err.message);
      setErrors(details);
    }
    finally { setBusy(false); }
  };
  const visible = fields.filter(f => !f.showIf || f.showIf(form));
  return (
    <form onSubmit={submit} className="form" noValidate>
      {msg && <div className="form-error" role="alert">{msg}</div>}
      <div className="grid-2">
        {visible.map(f => (
          <Field key={f.name} f={f} form={form} value={form[f.name]} error={errors[f.name]}
            onChange={v => setForm(p => ({ ...p, [f.name]: v, ...(f.derive ? f.derive(v, p) : {}) }))} />
        ))}
      </div>
      <footer className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </footer>
    </form>
  );
}

/**
 * Generic list + create/edit/delete page for one API resource.
 * Used directly as a page, or embedded (e.g. a vehicle's history) with `fixed` query params.
 */
const NO_FIXED = {};
export function ResourceTable({ cfg, fixed: fixedProp = NO_FIXED, embedded = false, onChanged }) {
  const fixedKey = JSON.stringify(fixedProp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fixed = useMemo(() => fixedProp, [fixedKey]);
  const { can, notify } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(embedded ? {} : (cfg.initialFilters || {}));
  const [sort, setSort] = useState(cfg.initialSort || {});
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null); // null | {} (new) | row
  const pageSize = embedded ? 10 : 25;
  const debounce = useRef();
  const [qDebounced, setQDebounced] = useState('');

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setQDebounced(q); setPage(0); }, 250);
  }, [q]);

  const query = useMemo(() => ({ ...filters, ...fixed, q: qDebounced, sort: sort.key, dir: sort.dir }), [filters, fixed, qDebounced, sort]);

  const load = useCallback(() => {
    setLoading(true);
    api(cfg.endpoint, { query: { ...query, limit: pageSize, offset: page * pageSize } })
      .then(r => { setRows(r.rows); setTotal(r.total); setError(''); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [cfg.endpoint, query, page, pageSize]);
  useEffect(load, [load]);

  const save = async form => {
    const body = { ...form };
    let message = null;
    if (cfg.save) message = await cfg.save(body, editing);
    else if (editing.id) await api(`${cfg.endpoint}/${editing.id}`, { method: 'PUT', body });
    else await api(cfg.endpoint, { method: 'POST', body });
    notify(message || (editing.id ? `${cfg.singular} updated` : (cfg.addedMessage || `${cfg.singular} added`)));
    setEditing(null);
    invalidateOptions();
    load();
    onChanged?.();
  };
  const remove = async row => {
    if (!window.confirm(`Delete this ${cfg.singular.toLowerCase()}? This can't be undone.`)) return;
    try {
      await api(`${cfg.endpoint}/${row.id}`, { method: 'DELETE' });
      notify(`${cfg.singular} deleted`);
      setEditing(null); invalidateOptions(); load(); onChanged?.();
    } catch (e) { notify(e.message, 'bad'); }
  };

  const toggleSort = key => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const writable = can('manager');
  const fields = cfg.fields.filter(f => !(f.name in fixed));
  const pages = Math.ceil(total / pageSize);

  return (
    <section className={embedded ? 'embedded' : ''}>
      <div className="toolbar">
        <input className="search" type="search" placeholder={cfg.searchPlaceholder || 'Search…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        {(cfg.filters || []).filter(f => !(f.name in fixed) && !(embedded && f.name === 'manager_id')).map(f => (
          <FilterSelect key={f.name} f={f} value={filters[f.name]} onChange={v => { setFilters(p => ({ ...p, [f.name]: v })); setPage(0); }} />
        ))}
        {cfg.dateRange && (
          <>
            <input type="date" aria-label="From" value={filters.from || ''} onChange={e => { setFilters(p => ({ ...p, from: e.target.value })); setPage(0); }} />
            <input type="date" aria-label="To" value={filters.to || ''} onChange={e => { setFilters(p => ({ ...p, to: e.target.value })); setPage(0); }} />
          </>
        )}
        <span className="spacer" />
        {!embedded && <button className="btn ghost" onClick={() => downloadCsv(cfg.endpoint, query, `${cfg.exportName || 'export'}.csv`).catch(e => notify(e.message, 'bad'))}>Export CSV</button>}
        {writable && <button className="btn primary" onClick={() => setEditing({})}>{cfg.addLabel || `Add ${cfg.singular.toLowerCase()}`}</button>}
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {cfg.columns.filter(c => !(c.hideIn && c.hideIn in fixed)).map(c => (
                <th key={c.key} className={c.num ? 'num' : ''}>
                  {c.sort ? <button className="th-sort" onClick={() => toggleSort(c.sort)}>{c.label}{sort.key === c.sort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button> : c.label}
                </th>
              ))}
              {writable && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={cfg.rowLink ? 'clickable' : ''} onClick={e => cfg.rowLink && !e.target.closest('button,a') && navigate(cfg.rowLink(r))}>
                {cfg.columns.filter(c => !(c.hideIn && c.hideIn in fixed)).map(c => (
                  <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : (r[c.key] ?? <span className="dim">—</span>)}</td>
                ))}
                {writable && (
                  <td className="row-actions">
                    <button className="link-btn" onClick={() => setEditing(r)}>Edit</button>
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={99} className="empty">
                {qDebounced || Object.values(filters).some(Boolean) ? 'Nothing matches these filters.' : cfg.emptyText || 'No records yet.'}
                {writable && !qDebounced && <> <button className="link-btn" onClick={() => setEditing({})}>Add the first one</button></>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page + 1} of {pages} · {total} records</span>
          <button className="btn ghost sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? `Edit ${cfg.singular.toLowerCase()}` : (cfg.addLabel || `Add ${cfg.singular.toLowerCase()}`)} onClose={() => setEditing(null)} wide={fields.length > 8}>
          <RecordForm
            fields={fields}
            initial={editing.id ? { ...pick(editing, cfg.fields), ...(cfg.editExtras ? cfg.editExtras(editing) : {}), __editing: true } : { ...(cfg.defaults?.() || {}), ...fixed }}
            onSubmit={f => save({ ...f, ...fixed })}
            onCancel={() => setEditing(null)}
            submitLabel={editing.id ? 'Save changes' : (cfg.addLabel || `Add ${cfg.singular.toLowerCase()}`)}
          />
          {editing.id && can('admin') && (
            <div className="danger-zone"><button className="link-btn danger" onClick={() => remove(editing)}>Delete this {cfg.singular.toLowerCase()}</button></div>
          )}
        </Modal>
      )}
    </section>
  );
}

const pick = (row, fields) => Object.fromEntries(fields.map(f => [f.name, f.type === 'datetime' && row[f.name] ? row[f.name].slice(0, 16) : row[f.name]]));

function FilterSelect({ f, value, onChange }) {
  const refOpts = useOptions(f.ref || 'vehicle');
  const options = f.ref ? refOpts.map(o => ({ value: o.value, label: o.label.split(' · ')[0] })) : f.options.map(o => ({ value: o, label: human(o) }));
  return (
    <select aria-label={f.label} value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">{f.label}: all</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const PageHead = ({ title, sub, children }) => (
  <div className="page-head">
    <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
    <div className="page-head-actions">{children}</div>
  </div>
);
