import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import { useAsync, Empty } from '../components/ui.jsx';
import { timeAgo } from '../util.js';

export default function Dashboard() {
  const { data, error, reload } = useAsync(() => get('/dashboard'), []);
  useEffect(() => { const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  if (error) return <div className="error">{error.message}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const s = data.sets;
  return (
    <>
      <div className="topbar"><h1>Dashboard</h1><span className="muted small">refreshes every 15 s</span></div>
      <div className="cards">
        <div className="stat"><div className="n">{s.total}</div><div className="l">sets registered</div></div>
        <div className="stat ok"><div className="n">{s.online}</div><div className="l">online (last 3 min) · {data.ws_connected} live</div></div>
        <div className={'stat ' + (s.offline ? 'bad' : '')}><div className="n">{s.offline}</div><div className="l">offline</div></div>
        <div className={'stat ' + (s.unassigned ? 'warn' : '')}><div className="n">{s.unassigned}</div><div className="l">without room or group</div></div>
        <div className="stat"><div className="n">{data.groups}</div><div className="l">groups</div></div>
        <div className="stat"><div className="n">{data.layouts}</div><div className="l">layouts</div></div>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Offline sets</h2>
          {data.offline.length === 0 ? <Empty>Everything is online.</Empty> : (
            <table><thead><tr><th>Room</th><th>Serial</th><th>Group</th><th>Last seen</th></tr></thead><tbody>
              {data.offline.map((x) => <tr key={x.id}><td><Link to={`/sets/${x.id}`}>{x.room_number || <span className="muted">—</span>}</Link></td><td className="mono">{x.serial}</td><td>{x.group_name || <span className="muted">—</span>}</td><td className="muted">{timeAgo(x.last_seen)}</td></tr>)}
            </tbody></table>)}
        </div>
        <div className="card">
          <h2>Recent activity</h2>
          {data.events.length === 0 ? <Empty>No events yet.</Empty> : (
            <table><tbody>
              {data.events.map((e) => <tr key={e.id}><td className="muted small" style={{ whiteSpace: 'nowrap' }}>{timeAgo(e.created_at)}</td><td><span className="pill">{e.type}</span></td><td className="mono small">{e.room_number ? `room ${e.room_number}` : e.serial}</td></tr>)}
            </tbody></table>)}
        </div>
      </div>
    </>
  );
}
