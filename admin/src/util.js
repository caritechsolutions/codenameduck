export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export function classNames(...xs) { return xs.filter(Boolean).join(' '); }
export const INSTANT_POWER_LABELS = { 0: 'Off', 1: 'Instant On + update-on-off', 2: 'Instant On', 10: 'Always On' };
export function instantPowerLabel(v) { return v == null ? null : (INSTANT_POWER_LABELS[v] || `unknown (${v})`); }
