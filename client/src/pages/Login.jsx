import { useState } from 'react';
import { useApp } from '../context';
import { apiUrl } from '../api';
import { Brand } from '../ui';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await login(email, password); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-screen">
      <div className="login-road" aria-hidden />
      <form className="login-card" onSubmit={submit}>
        <Brand big />
        <p className="sub">Sign in to manage drivers, daily payments and cars.</p>
        {!apiUrl() && (
          <div className="form-error" role="alert">
            Not connected to your Google Sheet yet. Open <code>config.js</code> and paste your Apps Script Web App URL, then reload this page.
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
