import React, { useState } from 'react';
import { Field } from './ui.jsx';

export const RF_TYPES = ['terrestrial', 'terrestrial_2', 'cable', 'cable_2', 'satellite', 'satellite_2', 'satellite_cs1', 'satellite_cs2', 'satellite_s3_bs', 'satellite_s3_cs'];
export const POLARIZATIONS = ['', 'horizontal', 'vertical', 'left', 'right'];
export const VIDEO_STREAM_TYPES = ['', 'MPEG2', 'H264', 'HEVC'];

export function emptyChannel() { return { number: '', name: '', logo_url: '', type: 'ip', enabled: true, params: { ipBroadcastType: 'udp', ip: '', port: '' } }; }

export function describeParams(c) {
  const p = c.params || {};
  if (c.type === 'rf') return `${p.rfBroadcastType || '?'} ${p.frequency ? (p.frequency / 1e6).toFixed(3) + ' MHz' : ''} prog ${p.programNumber ?? '?'}${p.plpId != null ? ` plp ${p.plpId}` : ''}${p.majorNumber != null ? ` · ${p.majorNumber}${p.minorNumber != null ? '-' + p.minorNumber : ''}` : ''}${p.videoStreamType ? ` · ${p.videoStreamType}` : ''}`;
  if (p.url) return `${p.url}${p.mimeType ? ` (${p.mimeType})` : ''}`;
  return `${p.ipBroadcastType || 'udp'}://${p.ip || '?'}:${p.port || '?'}${p.sourceAddress ? ` from ${p.sourceAddress}` : ''}${p.videoStreamType ? ` · ${p.videoStreamType}` : ''}`;
}

// Client-side validation mirrors server/src/channels.js so mistakes show before saving.
export function validate(ch) {
  const errors = {};
  const n = Number(ch.number);
  if (ch.number === '' || !Number.isInteger(n) || n < 0 || n > 9999) errors.number = 'Whole number 0–9999';
  if (!String(ch.name || '').trim()) errors.name = 'Required';
  const p = ch.params || {};
  if (ch.type === 'ip') {
    if (ch.ipMode === 'url' || (p.url && ch.ipMode !== 'multicast')) {
      if (!/^(https?|rtsp|rtp|udp):\/\//i.test(p.url || '')) errors.url = 'Must start with http://, https://, rtsp://, rtp:// or udp://';
    } else {
      if (!/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(p.ip || '')) errors.ip = 'IPv4 address, e.g. 239.1.1.10';
      const port = Number(p.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '1–65535';
      if (p.sourceAddress && !/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(p.sourceAddress)) errors.sourceAddress = 'IPv4 address';
    }
  } else {
    if (!RF_TYPES.includes(p.rfBroadcastType)) errors.rfBroadcastType = 'Choose a broadcast type';
    if (!Number.isInteger(Number(p.frequency)) || Number(p.frequency) <= 0) errors.frequency = 'Positive integer (Hz)';
    if (p.programNumber === '' || p.programNumber == null || !Number.isInteger(Number(p.programNumber)) || Number(p.programNumber) < 0) errors.programNumber = 'Whole number';
  }
  return errors;
}

// Build the payload the API expects (strips the ipMode helper, converts numbers).
export function toPayload(ch) {
  const p = { ...ch.params };
  let params;
  if (ch.type === 'ip') {
    if (ch.ipMode === 'url' || (p.url && ch.ipMode !== 'multicast')) params = { url: p.url, mimeType: p.mimeType || undefined };
    else {
      params = { ipBroadcastType: p.ipBroadcastType || 'udp', ip: p.ip, port: Number(p.port) };
      if (p.sourceAddress) params.sourceAddress = p.sourceAddress;
      if (p.videoStreamType) params.videoStreamType = p.videoStreamType;
    }
  } else {
    params = { rfBroadcastType: p.rfBroadcastType, frequency: Number(p.frequency), programNumber: Number(p.programNumber) };
    for (const k of ['majorNumber', 'minorNumber', 'satelliteId', 'symbolRate', 'plpId']) if (p[k] !== '' && p[k] != null) params[k] = Number(p[k]);
    if (p.polarization) params.polarization = p.polarization;
    if (p.videoStreamType) params.videoStreamType = p.videoStreamType;
  }
  return { id: ch.id, number: Number(ch.number), name: ch.name.trim(), logo_url: ch.logo_url || null, type: ch.type, enabled: !!ch.enabled, params };
}

export default function ChannelForm({ channel, onSave, onCancel }) {
  const [ch, setCh] = useState(() => ({ ...channel, ipMode: channel.params && channel.params.url ? 'url' : 'multicast', params: { ...(channel.params || {}) } }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = validate(ch);
  const set = (k, v) => setCh((c) => ({ ...c, [k]: v }));
  const setP = (k, v) => setCh((c) => ({ ...c, params: { ...c.params, [k]: v } }));
  const err = (k) => touched && errors[k] ? <div className="error small">{errors[k]}</div> : null;
  async function submit(e) {
    e.preventDefault(); setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try { await onSave(toPayload(ch)); } catch { /* toast shown by caller */ } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate>
      <div className="row">
        <Field label="Number"><input value={ch.number} onChange={(e) => set('number', e.target.value)} inputMode="numeric" aria-label="Number" />{err('number')}</Field>
        <Field label="Name"><input value={ch.name} onChange={(e) => set('name', e.target.value)} aria-label="Name" style={{ minWidth: 200 }} />{err('name')}</Field>
      </div>
      <div className="row">
        <Field label="Type"><select value={ch.type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="ip">IP</option><option value="rf">RF</option></select></Field>
        <Field label="Logo URL"><input value={ch.logo_url || ''} onChange={(e) => set('logo_url', e.target.value)} placeholder="/procentric/application/assets/cnn.png" /></Field>
        <Field label="Enabled"><label className="inline" style={{ color: 'var(--text)', fontSize: 13, marginTop: 6 }}><input type="checkbox" checked={!!ch.enabled} onChange={(e) => set('enabled', e.target.checked)} /> shown in lineups</label></Field>
      </div>
      {ch.type === 'ip' ? (
        <>
          <Field label="IP source">
            <div className="inline" style={{ gap: 14, color: 'var(--text)', fontSize: 13 }}>
              <label className="inline"><input type="radio" name="ipMode" checked={ch.ipMode === 'multicast'} onChange={() => set('ipMode', 'multicast')} /> Multicast (channel tuner)</label>
              <label className="inline"><input type="radio" name="ipMode" checked={ch.ipMode === 'url'} onChange={() => set('ipMode', 'url')} /> Stream URL (media player)</label>
            </div>
          </Field>
          {ch.ipMode === 'multicast' ? (<>
            <div className="row">
              <Field label="Broadcast"><select value={ch.params.ipBroadcastType || 'udp'} onChange={(e) => setP('ipBroadcastType', e.target.value)} aria-label="ipBroadcastType"><option value="udp">udp</option><option value="rtp">rtp</option></select></Field>
              <Field label="Multicast IP"><input value={ch.params.ip || ''} onChange={(e) => setP('ip', e.target.value)} placeholder="239.1.1.10" aria-label="Multicast IP" />{err('ip')}</Field>
              <Field label="Port"><input value={ch.params.port || ''} onChange={(e) => setP('port', e.target.value)} placeholder="5000" inputMode="numeric" aria-label="Port" />{err('port')}</Field>
            </div>
            <div className="row">
              <Field label="Source address (IGMPv3, optional)"><input value={ch.params.sourceAddress || ''} onChange={(e) => setP('sourceAddress', e.target.value)} placeholder="10.0.0.9" aria-label="Source address" />{err('sourceAddress')}</Field>
              <Field label="Video codec"><select value={ch.params.videoStreamType || ''} onChange={(e) => setP('videoStreamType', e.target.value)} aria-label="Video stream type">{VIDEO_STREAM_TYPES.map((v) => <option key={v} value={v}>{v || 'auto'}</option>)}</select></Field>
            </div>
          </>) : (
            <div className="row">
              <Field label="URL"><input value={ch.params.url || ''} onChange={(e) => setP('url', e.target.value)} placeholder="http://host/stream.m3u8" aria-label="URL" style={{ minWidth: 260 }} />{err('url')}</Field>
              <Field label="MIME type"><input value={ch.params.mimeType || ''} onChange={(e) => setP('mimeType', e.target.value)} placeholder="application/x-mpegURL (auto)" /></Field>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row">
            <Field label="RF broadcast type"><select value={ch.params.rfBroadcastType || ''} onChange={(e) => setP('rfBroadcastType', e.target.value)} aria-label="rfBroadcastType"><option value="">—</option>{RF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>{err('rfBroadcastType')}</Field>
            <Field label="Frequency (Hz)"><input value={ch.params.frequency || ''} onChange={(e) => setP('frequency', e.target.value)} placeholder="63000000" inputMode="numeric" aria-label="Frequency" />{err('frequency')}</Field>
            <Field label="Program number"><input value={ch.params.programNumber ?? ''} onChange={(e) => setP('programNumber', e.target.value)} placeholder="1" inputMode="numeric" aria-label="Program number" />{err('programNumber')}</Field>
          </div>
          <div className="row">
            <Field label="Major"><input value={ch.params.majorNumber ?? ''} onChange={(e) => setP('majorNumber', e.target.value)} inputMode="numeric" /></Field>
            <Field label="Minor"><input value={ch.params.minorNumber ?? ''} onChange={(e) => setP('minorNumber', e.target.value)} inputMode="numeric" /></Field>
            <Field label="Symbol rate"><input value={ch.params.symbolRate ?? ''} onChange={(e) => setP('symbolRate', e.target.value)} inputMode="numeric" /></Field>
            <Field label="Video codec"><select value={ch.params.videoStreamType || ''} onChange={(e) => setP('videoStreamType', e.target.value)} aria-label="Video stream type">{VIDEO_STREAM_TYPES.map((v) => <option key={v} value={v}>{v || 'auto'}</option>)}</select></Field>
          </div>
          {ch.params.rfBroadcastType === 'terrestrial_2' && <div className="row">
            <Field label="PLP ID (DVB-T2)"><input value={ch.params.plpId ?? ''} onChange={(e) => setP('plpId', e.target.value)} inputMode="numeric" aria-label="PLP ID" /></Field>
          </div>}
          {/^satellite/.test(ch.params.rfBroadcastType || '') && (
            <div className="row">
              <Field label="Satellite ID"><input value={ch.params.satelliteId ?? ''} onChange={(e) => setP('satelliteId', e.target.value)} inputMode="numeric" /></Field>
              <Field label="Polarization"><select value={ch.params.polarization || ''} onChange={(e) => setP('polarization', e.target.value)}>{POLARIZATIONS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}</select></Field>
            </div>
          )}
        </>
      )}
      <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
