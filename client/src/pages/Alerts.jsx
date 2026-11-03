import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { PageHead, fmtDate } from '../ui';

const GROUPS = [
  { key: 'overdue', title: 'Overdue or serious', empty: 'Nothing overdue.' },
  { key: 'urgent', title: 'Act this week', empty: 'Nothing urgent this week.' },
  { key: 'upcoming', title: 'Coming up', empty: 'Nothing else coming up.' },
];

export default function Alerts() {
  const { settings } = useApp();
  const [data, setData] = useState(null);
  const [cat, setCat] = useState('');
  useEffect(() => { api('/alerts').then(setData).catch(() => {}); }, []);
  if (!data) return <div className="loading">Loading alerts…</div>;
  const list = data.alerts.filter(a => !cat || a.category === cat);

  return (
    <>
      <PageHead title="Alerts" sub={`Drivers behind on payments, drivers who want to stop, open complaints, services due and expiring paperwork (${settings.alert_days} days ahead).`}>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Show">
          <option value="">All alerts</option>
          <option value="payment">Payments & contracts</option>
          <option value="driver">Driver feedback & complaints</option>
          <option value="document">Paperwork & licences</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </PageHead>
      {GROUPS.map(g => {
        const items = list.filter(a => a.severity === g.key);
        return (
          <section key={g.key} className={`alert-group sev-${g.key}`}>
            <h2>{g.title} <span className="count">{items.length}</span></h2>
            {items.length === 0 ? <p className="empty">{g.empty}</p> : (
              <ul className="alert-list">
                {items.map((a, i) => (
                  <li key={i} className={`sev-${a.severity}`}>
                    <Link to={a.link}>
                      <strong>{a.title}</strong>
                      <span>{a.detail}</span>
                      {a.due_date && <span className="dim">{fmtDate(a.due_date)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
