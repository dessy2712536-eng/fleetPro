import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from './api';

const Ctx = createContext(null);
const RANK = { viewer: 1, manager: 2, admin: 3 };

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({ currency: 'GHS', distance_unit: 'km', company_name: 'My Fleet' });
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);

  const loadSettings = useCallback(() => api('/settings').then(setSettings).catch(() => {}), []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('fleetpro:logout', onLogout);
    if (getToken()) {
      api('/auth/me').then(r => { setUser(r.user); return loadSettings(); }).catch(() => {}).finally(() => setReady(true));
    } else setReady(true);
    return () => window.removeEventListener('fleetpro:logout', onLogout);
  }, [loadSettings]);

  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token);
    setUser(r.user);
    loadSettings();
  };
  const logout = () => { setToken(null); setUser(null); };
  const can = role => user && RANK[user.role] >= RANK[role];
  const notify = useCallback((message, kind = 'ok') => {
    setToast({ message, kind, id: Date.now() });
    setTimeout(() => setToast(t => (t && Date.now() - t.id >= 3400 ? null : t)), 3500);
  }, []);

  const money = n => {
    if (n == null || n === '') return '—';
    const v = Number(n);
    const whole = Math.abs(v - Math.round(v)) < 0.005;
    return `${settings.currency} ${v.toLocaleString(undefined, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
  };
  const dist = n => n == null ? '—' : `${Math.round(Number(n)).toLocaleString()} ${settings.distance_unit}`;

  return (
    <Ctx.Provider value={{ user, ready, login, logout, can, settings, setSettings, loadSettings, notify, toast, money, dist }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
