// A small in-memory stand-in for the Google Apps Script services Code.gs uses,
// so the backend can be tested on a normal computer with Node.js.
// Not needed for real use — Google provides the real services.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  let cells = []; // 2D array, 0-based
  const formats = {};
  const lastRow = () => { for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some(v => v !== '' && v != null)) return r + 1; return 0; };
  const lastCol = () => cells.reduce((m, row) => { for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) return Math.max(m, c + 1); return m; }, 0);
  const sheet = {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getMaxRows: () => Math.max(1000, cells.length),
    setFrozenRows() {},
    getDataRange() { return sheet.getRange(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)); },
    getRange(r, c, nr = 1, nc = 1) {
      const range = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((cells[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error(`setValues size mismatch on ${name}: range ${nr}x${nc}, data ${vals.length}x${vals[0] && vals[0].length}`);
          vals.forEach((row, i) => { cells[r - 1 + i] = cells[r - 1 + i] || []; row.forEach((v, j) => { cells[r - 1 + i][c - 1 + j] = v; }); });
          return range;
        },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; return range; },
        setNumberFormat(f) { formats[`${r},${c}`] = f; return range; },
        setFontWeight: () => range, setBackground: () => range, setFontColor: () => range,
      };
      return range;
    },
    _dump: () => cells,
  };
  return sheet;
}

function makeSpreadsheet() {
  const sheets = [makeSheet('Sheet1')];
  return {
    getId: () => 'emulated-sheet',
    getSheets: () => sheets.slice(),
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: s => sheets.splice(sheets.indexOf(s), 1),
  };
}

function formatDate(date, tz, fmt) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).map(p => [p.type, p.value]));
  if (parts.hour === '24') parts.hour = '00';
  return fmt.replace(/'([^']*)'/g, '\u0000$1\u0000').split('\u0000').map((seg, i) => i % 2 ? seg :
    seg.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second)).join('');
}

const toSigned = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
const toBuf = v => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => b & 0xff)));

function loadBackend(timeZone = 'Africa/Accra') {
  const book = makeSpreadsheet();
  const props = {};
  const ctx = {
    console: { log() {}, error: (...a) => console.error(...a) },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    Session: { getScriptTimeZone: () => timeZone },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => toSigned(crypto.createHash(alg).update(toBuf(s)).digest()),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const call = (method, p, { query, body, token } = {}) => {
    const out = ctx.doPost({ postData: { contents: JSON.stringify({ method, path: p, query, body, token }) } });
    return JSON.parse(out.getContent());
  };
  return { ctx, book, call };
}

module.exports = { loadBackend };
