import React, { useState } from 'react';
import { post } from '../api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onLogin(await post('/login', { username, password })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand"><div className="logo">C</div><div><b>CoopCentric</b><small>{location.hostname}</small></div></div>
        <div className="field"><label htmlFor="u">Username</label><input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" /></div>
        <div className="field"><label htmlFor="p">Password</label><input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" style={{ width: '100%', marginTop: 6 }} disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
