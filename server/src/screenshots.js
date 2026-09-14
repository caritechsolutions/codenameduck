'use strict';
// Latest screenshot per set on disk: <dataDir>/screenshots/<setId>.<jpg|png>.
const fs = require('fs');
const path = require('path');

function createScreenshotStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  function save(setId, buf, ext) {
    for (const e of ['jpg', 'png']) { try { fs.unlinkSync(path.join(dir, `${setId}.${e}`)); } catch { /* none */ } }
    const file = path.join(dir, `${setId}.${ext}`);
    fs.writeFileSync(file, buf);
    return file;
  }
  function latest(setId) {
    for (const e of ['jpg', 'png']) { const f = path.join(dir, `${setId}.${e}`); if (fs.existsSync(f)) return f; }
    return null;
  }
  return { save, latest, dir };
}

module.exports = { createScreenshotStore };
