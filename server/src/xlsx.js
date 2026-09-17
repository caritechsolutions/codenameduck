'use strict';
// Minimal read-only .xlsx reader (Part C import): first worksheet → rows of strings/numbers.
// No dependency: an .xlsx is a zip of XML. We read the central directory, inflate the parts we
// need (workbook, sheet, shared strings, styles) and parse the cells with regexes. Date-styled
// numeric cells are converted to YYYY-MM-DD; other numbers stay numbers.
const zlib = require('zlib');

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a zip/xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files.set(name, { method, csize, off });
    p += 46 + nlen + elen + clen;
  }
  return (name) => {
    const f = files.get(name);
    if (!f) return null;
    const h = f.off;
    if (buf.readUInt32LE(h) !== 0x04034b50) throw new Error('bad zip local header');
    const nlen = buf.readUInt16LE(h + 26), elen = buf.readUInt16LE(h + 28);
    const start = h + 30 + nlen + elen;
    const data = buf.subarray(start, start + f.csize);
    if (f.method === 0) return data.toString('utf8');
    if (f.method === 8) return zlib.inflateRawSync(data).toString('utf8');
    throw new Error('unsupported zip compression ' + f.method);
  };
}
function unxml(s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&'); }
function texts(xml) { return (xml.match(/<t\b[^>]*>[\s\S]*?<\/t>|<t\b[^>]*\/>/g) || []).map((t) => unxml(t.replace(/^<t\b[^>]*\/>$/, '').replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, ''))).join(''); }
function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function dateStyles(stylesXml) {
  if (!stylesXml) return new Set();
  const custom = new Map();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), unxml(m[2]));
  const isDate = (id) => DATE_FMT_IDS.has(id) || (custom.has(id) && /[dmy]/i.test(custom.get(id).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')) && !/#|0\.0/.test(custom.get(id)));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  const out = new Set();
  if (xfs) (xfs[1].match(/<xf\b[^>]*>/g) || []).forEach((xf, i) => { const m = /numFmtId="(\d+)"/.exec(xf); if (m && isDate(Number(m[1]))) out.add(i); });
  return out;
}
function serialToIso(n) {
  const ms = Math.round((n - 25569) * 86400000);   // 1899-12-30 epoch
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function readXlsx(buffer, { maxRows = 5000 } = {}) {
  const get = readZip(buffer);
  let sheetPath = null;
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb) || /<sheet\b[^>]*\bid="([^"]+)"/.exec(wb);
    if (first) {
      const rel = new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`).exec(rels);
      if (rel) sheetPath = rel[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/');
    }
  }
  const sheet = (sheetPath && get(sheetPath)) || get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('no worksheet found in the xlsx file');
  const shared = (() => { const x = get('xl/sharedStrings.xml'); return x ? (x.match(/<si>[\s\S]*?<\/si>/g) || []).map(texts) : []; })();
  const dateXf = dateStyles(get('xl/styles.xml'));
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs); if (!ref) continue;
      const col = colIndex(ref[1]);
      const type = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      const style = Number((/\bs="(\d+)"/.exec(attrs) || [])[1]);
      const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(inner);
      else if (type === 'str' || type === 'e') value = v == null ? '' : unxml(v);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null && v !== '') { const n = Number(v); value = Number.isFinite(n) ? (dateXf.has(style) ? (serialToIso(n) || n) : n) : unxml(v); }
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some((c) => c !== '')) rows.push(row);
    if (rows.length >= maxRows) break;
  }
  return rows;
}

module.exports = { readXlsx, serialToIso, readZip };
