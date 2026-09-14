import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { get, post } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sets from './pages/Sets.jsx';
import Groups from './pages/Groups.jsx';
import Layouts from './pages/Layouts.jsx';
import LayoutEdit from './pages/LayoutEdit.jsx';
import Channels from './pages/Channels.jsx';
import Lineups from './pages/Lineups.jsx';

export const SessionCtx = React.createContext(null);

const NAV = [
  ['/', 'Dashboard', '▦'],
  ['/sets', 'Sets', '▭'],
  ['/groups', 'Groups', '⊞'],
  ['/layouts', 'Layouts', '▤'],
  ['/channels', 'Channels', '▶'],
  ['/lineups', 'Lineups', '☰'],
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    get('/me').then(setSession, () => setSession(null));
    const onUnauth = () => setSession(null);
    window.addEventListener('cc:unauthorized', onUnauth);
    return () => window.removeEventListener('cc:unauthorized', onUnauth);
  }, []);

  if (session === undefined) return <div className="login"><div className="muted">Loading…</div></div>;
  if (!session) {
    if (loc.pathname !== '/login') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
    return <ToastProvider><Login onLogin={(s) => { setSession(s); nav((loc.state && loc.state.from) || '/', { replace: true }); }} /></ToastProvider>;
  }
  if (loc.pathname === '/login') return <Navigate to="/" replace />;

  const logout = async () => { await post('/logout'); setSession(null); };

  return (
    <SessionCtx.Provider value={{ ...session, refresh: () => get('/me').then(setSession) }}>
      <ToastProvider>
        <div className="shell">
          <nav className="sidebar">
            <div className="brand"><div className="logo">C</div><div><b>CoopCentric</b><small>{session.tenant.display_name}</small></div></div>
            <div className="nav">
              {NAV.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === '/'}><span aria-hidden>{icon}</span>{label}</NavLink>)}
            </div>
            <div className="me"><b>{session.user.username}</b>{session.user.role} · {session.tenant.hostname}<div style={{ marginTop: 8 }}><button className="sm" onClick={logout}>Log out</button></div></div>
          </nav>
          <main className="main">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sets" element={<Sets />} />
              <Route path="/sets/:id" element={<Sets />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/layouts" element={<Layouts />} />
              <Route path="/layouts/:id" element={<LayoutEdit />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/lineups" element={<Lineups />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </SessionCtx.Provider>
  );
}
