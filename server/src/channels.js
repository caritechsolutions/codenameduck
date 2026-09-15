'use strict';
// Channel definitions. params map 1:1 onto idcap://tv/channel/change/request (or the media
// player path for URL streams). Store what the TV needs; do not reinterpret.
const IP_BROADCAST = ['udp', 'rtp'];
const RF_BROADCAST = ['terrestrial', 'terrestrial_2', 'cable', 'cable_2', 'satellite', 'satellite_2', 'satellite_cs1', 'satellite_cs2', 'satellite_s3_bs', 'satellite_s3_cs'];
const POLARIZATION = ['horizontal', 'vertical', 'left', 'right'];
const VIDEO_STREAM = ['MPEG2', 'H264', 'HEVC'];   // maps to LG VideoStreamType (2, 27, 36)
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function validateChannel(input = {}) {
  const errors = [];
  const out = {};
  const number = Number(input.number);
  if (!Number.isInteger(number) || number < 0 || number > 9999) errors.push('number must be an integer 0–9999');
  out.number = number;
  out.name = String(input.name || '').trim().slice(0, 80);
  if (!out.name) errors.push('name required');
  out.logo_url = input.logo_url ? String(input.logo_url).trim().slice(0, 500) : null;
  out.type = input.type === 'rf' ? 'rf' : input.type === 'ip' ? 'ip' : null;
  if (!out.type) errors.push('type must be ip or rf');
  out.enabled = input.enabled === undefined ? 1 : input.enabled ? 1 : 0;
  out.sort = Number.isFinite(Number(input.sort)) ? Number(input.sort) : number;
  const p = input.params && typeof input.params === 'object' ? input.params : {};
  const params = {};
  if (out.type === 'ip') {
    if (p.url) {
      params.url = String(p.url).trim();
      if (!/^(https?|rtsp|rtp|udp):\/\//i.test(params.url)) errors.push('url must start with http://, https://, rtsp://, rtp:// or udp://');
      params.mimeType = String(p.mimeType || guessMime(params.url)).trim();
    } else {
      params.ipBroadcastType = IP_BROADCAST.includes(p.ipBroadcastType) ? p.ipBroadcastType : 'udp';
      params.ip = String(p.ip || '').trim();
      if (!IPV4.test(params.ip)) errors.push('ip must be an IPv4 address (e.g. 239.1.1.10)');
      params.port = Number(p.port);
      if (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535) errors.push('port must be 1–65535');
      if (p.sourceAddress) { params.sourceAddress = String(p.sourceAddress).trim(); if (!IPV4.test(params.sourceAddress)) errors.push('sourceAddress (IGMPv3) must be an IPv4 address'); }
      if (p.videoStreamType) { if (VIDEO_STREAM.includes(p.videoStreamType)) params.videoStreamType = p.videoStreamType; else errors.push(`videoStreamType must be one of ${VIDEO_STREAM.join(', ')}`); }
    }
  } else if (out.type === 'rf') {
    params.rfBroadcastType = RF_BROADCAST.includes(p.rfBroadcastType) ? p.rfBroadcastType : null;
    if (!params.rfBroadcastType) errors.push(`rfBroadcastType must be one of ${RF_BROADCAST.join(', ')}`);
    params.frequency = Number(p.frequency);
    if (!Number.isInteger(params.frequency) || params.frequency <= 0) errors.push('frequency must be a positive integer (Hz for terrestrial/cable, kHz for satellite as LG expects)');
    params.programNumber = Number(p.programNumber);
    if (!Number.isInteger(params.programNumber) || params.programNumber < 0) errors.push('programNumber must be a non-negative integer');
    for (const k of ['majorNumber', 'minorNumber', 'symbolRate', 'satelliteId', 'plpId']) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== '') {
        const n = Number(p[k]);
        if (!Number.isInteger(n) || n < 0) errors.push(`${k} must be a non-negative integer`); else params[k] = n;
      }
    }
    if (p.polarization) { if (POLARIZATION.includes(p.polarization)) params.polarization = p.polarization; else errors.push(`polarization must be one of ${POLARIZATION.join(', ')}`); }
    if (p.modulation) params.modulation = String(p.modulation).slice(0, 32);
    if (p.videoStreamType) { if (VIDEO_STREAM.includes(p.videoStreamType)) params.videoStreamType = p.videoStreamType; else errors.push(`videoStreamType must be one of ${VIDEO_STREAM.join(', ')}`); }
  }
  out.params = params;
  return { channel: out, errors };
}

function guessMime(url) {
  const u = String(url).toLowerCase().split('?')[0];
  if (u.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (u.endsWith('.mpd')) return 'application/dash+xml';
  if (u.endsWith('.mp4')) return 'video/mp4';
  if (u.startsWith('rtsp://')) return 'application/x-rtsp';
  if (u.startsWith('udp://') || u.startsWith('rtp://')) return 'video/mp2t';
  return 'application/x-mpegURL';
}

function rowToApi(c) {
  return { id: c.id, number: c.number, name: c.name, logo_url: c.logo_url, type: c.type, params: safe(c.params_json), enabled: !!c.enabled, sort: c.sort };
}
function safe(s) { try { return JSON.parse(s); } catch { return {}; } }

// Parse the CSV format of the Channels page export/import (step 5 wires the UI):
// number,name,type,logo_url,ip,port,ipBroadcastType,url,mimeType,rfBroadcastType,frequency,programNumber,majorNumber,minorNumber,satelliteId,polarization,symbolRate
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['empty file'] };
  const header = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = []; const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsv(lines[i]);
    const rec = {}; header.forEach((h, j) => { rec[h] = (cells[j] || '').trim(); });
    const input = { number: rec.number, name: rec.name, type: (rec.type || (rec.frequency ? 'rf' : 'ip')).toLowerCase(), logo_url: rec.logo_url || null,
      params: rec.url ? { url: rec.url, mimeType: rec.mimetype } : rec.frequency ? { rfBroadcastType: rec.rfbroadcasttype, frequency: rec.frequency, programNumber: rec.programnumber, majorNumber: rec.majornumber, minorNumber: rec.minornumber, satelliteId: rec.satelliteid, polarization: rec.polarization, symbolRate: rec.symbolrate, plpId: rec.plpid, videoStreamType: rec.videostreamtype || undefined }
        : { ip: rec.ip, port: rec.port, ipBroadcastType: rec.ipbroadcasttype || 'udp', sourceAddress: rec.sourceaddress || undefined, videoStreamType: rec.videostreamtype || undefined } };
    const { channel, errors: errs } = validateChannel(input);
    if (errs.length) errors.push(`line ${i + 1}: ${errs.join('; ')}`); else rows.push(channel);
  }
  return { rows, errors };
}
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function toCsv(channels) {
  const cols = ['number', 'name', 'type', 'logo_url', 'ip', 'port', 'ipBroadcastType', 'sourceAddress', 'videoStreamType', 'url', 'mimeType', 'rfBroadcastType', 'frequency', 'programNumber', 'majorNumber', 'minorNumber', 'satelliteId', 'polarization', 'symbolRate', 'plpId'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...channels.map((c) => cols.map((k) => esc(k in c ? c[k] : c.params[k])).join(','))].join('\n') + '\n';
}

module.exports = { validateChannel, rowToApi, parseCsv, toCsv, IP_BROADCAST, RF_BROADCAST, POLARIZATION, VIDEO_STREAM };
