import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from './context';
import { api } from './api';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/alerts', label: 'Alerts', badge: true },
  { to: '/payments', label: 'Payments' },
  { to: '/reports/manager', label: 'Manager reports' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/checkins', label: 'Driver check-ins' },
  { to: '/contracts', label: 'Contracts' },
  { group: 'Fleet' },
  { to: '/vehicles', label: 'Cars' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/reports', label: 'Cost reports', end: true },
  { to: '/trips', label: 'Trips' },
  { to: '/fuel', label: 'Fuel' },
  { group: '' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { user, logout, settings, toast } = useApp();
  const [alertCount, setAlertCount] = useState(null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
    api('/alerts').then(r => setAlertCount(r.counts.overdue + r.counts.urgent)).catch(() => {});
  }, [loc.pathname]);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" />FleetPro</div>
        <div className="company">{settings.company_name}</div>
        <nav>
          {NAV.map((n, i) => n.group !== undefined ? <div key={i} className="nav-group">{n.group}</div> : (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
              {n.badge && alertCount > 0 && <span className="nav-count" aria-label={`${alertCount} need attention`}>{alertCount}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div><strong>{user.name}</strong><div className="dim">{user.role}</div></div>
          <button className="link-btn" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <div className="topbar">
        <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
        <div className="brand"><span className="brand-mark" />FleetPro</div>
      </div>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main className="content"><Outlet /></main>
      {toast && <div key={toast.id} className={`toast tone-${toast.kind}`} role="status">{toast.message}</div>}
    </div>
  );
}
