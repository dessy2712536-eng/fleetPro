import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Plate, invalidateOptions, useOptions } from '../ui';

/** Give many cars a manager at once. Cars without a manager are ticked to start with. */
export default function AssignManager({ onClose, onDone }) {
  const { user } = useApp();
  const managers = useOptions('manager');
  const [cars, setCars] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [managerId, setManagerId] = useState(user.role === 'manager' ? String(user.id) : '');
  const [filter, setFilter] = useState('');
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    api('/vehicles', { query: { limit: 5000, sort: 'reg_number', dir: 'asc' } }).then(r => {
      const list = r.rows.filter(v => v.status !== 'disposed' && v.status !== 'handed_over');
      setCars(list);
      setPicked(new Set(list.filter(v => !v.manager_id).map(v => v.id)));
    });
  }, []);

  const shown = useMemo(() => (cars || []).filter(v => !filter || `${v.reg_number} ${v.make} ${v.model} ${v.manager_name || ''}`.toLowerCase().includes(filter.toLowerCase())), [cars, filter]);
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownPicked = shown.length > 0 && shown.every(v => picked.has(v.id));
  const toggleAll = () => setPicked(p => { const n = new Set(p); shown.forEach(v => (allShownPicked ? n.delete(v.id) : n.add(v.id))); return n; });

  const run = async () => {
    const ids = [...picked];
    const errors = [];
    setProgress({ done: 0, total: ids.length, errors });
    for (let i = 0; i < ids.length; i++) {
      const car = cars.find(c => c.id === ids[i]);
      try { await api(`/vehicles/${ids[i]}`, { method: 'PUT', body: { manager_id: Number(managerId) } }); }
      catch (e) { errors.push(`${car.reg_number}: ${e.message}`); }
      setProgress({ done: i + 1, total: ids.length, errors: [...errors] });
    }
    invalidateOptions();
    onDone(ids.length - errors.length, (managers.find(m => String(m.value) === managerId) || {}).label);
  };
  const finished = progress && progress.done === progress.total;
  const running = progress && !finished;
  const managerName = (managers.find(m => String(m.value) === managerId) || {}).label;

  return (
    <Modal title="Assign manager" onClose={running ? () => {} : onClose} wide>
      <div className="form import">
        {!progress ? (
          <>
            <p className="sub">Tick the cars, choose their manager, then click Assign. Cars without a manager are already ticked. A car's current driver moves to the new manager with it.</p>
            <div className="toolbar">
              <label className="inline-label" htmlFor="assign-manager">Manager
                <select id="assign-manager" value={managerId} onChange={e => setManagerId(e.target.value)}>
                  <option value="">Choose manager…</option>
                  {managers.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <input className="search" type="search" placeholder="Find a car" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Find a car" />
            </div>
            {!cars ? <p className="dim">Loading cars…</p> : (
              <div className="table-wrap import-preview">
                <table className="data">
                  <thead><tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="Tick all shown" /></th>
                    <th>Car</th><th>Make & model</th><th>Current manager</th>
                  </tr></thead>
                  <tbody>
                    {shown.map(v => (
                      <tr key={v.id} className="clickable" onClick={e => e.target.tagName !== 'INPUT' && toggle(v.id)}>
                        <td><input type="checkbox" checked={picked.has(v.id)} onChange={() => toggle(v.id)} aria-label={`Tick ${v.reg_number}`} /></td>
                        <td><Plate>{v.reg_number}</Plate></td>
                        <td>{v.make} {v.model}</td>
                        <td>{v.manager_name || <span className="txt-bad">No manager</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {managers.length === 0 && <div className="form-error">There are no managers yet. Add them in Settings → Users with the Manager role.</div>}
          </>
        ) : (
          <div className="import-progress" role="status">
            <p><strong>{finished ? `Assigned ${progress.done - progress.errors.length} car${progress.done - progress.errors.length === 1 ? '' : 's'} to ${managerName}.` : `Assigning ${progress.done} of ${progress.total}…`}</strong></p>
            <div className="progress big"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            {!finished && <p className="dim">Each car takes a second or two to save to your Google Sheet. Keep this window open.</p>}
            {progress.errors.length > 0 && <div className="form-error">Some cars were not changed:<ul>{progress.errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
          </div>
        )}
        <footer className="form-actions">
          {finished ? <button type="button" className="btn primary" onClick={onClose}>Done</button> : (
            <>
              <button type="button" className="btn ghost" onClick={onClose} disabled={running}>Cancel</button>
              <button type="button" className="btn primary" onClick={run} disabled={!managerId || !picked.size || running}>
                {running ? 'Assigning…' : `Assign ${picked.size} car${picked.size === 1 ? '' : 's'}${managerName ? ` to ${managerName}` : ''}`}
              </button>
            </>
          )}
        </footer>
      </div>
    </Modal>
  );
}
