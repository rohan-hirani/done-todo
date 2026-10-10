const crypto = require('crypto');

const TZ = () => process.env.APP_TZ || 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

function passcodeFrom(req) {
  const h = req.headers['x-passcode'];
  if (h) return String(h);
  const a = req.headers.authorization || '';
  return a.replace(/^Bearer\s+/i, '');
}

// The app is intentionally open: no passcode is required. An x-passcode header is accepted and ignored.
function authed() {
  return true;
}

function dayKey(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// undefined -> today, null/"someday"/"" -> null, "today"/"tomorrow"/YYYY-MM-DD
function parseDate(v) {
  if (v === undefined) return dayKey(0);
  if (v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '' || s === 'someday' || s === 'null') return null;
  if (s === 'today') return dayKey(0);
  if (s === 'tomorrow') return dayKey(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (!isNaN(d) && d.toISOString().slice(0, 10) === s) return s;
  }
  throw new Error('invalid date (use YYYY-MM-DD, "today", "tomorrow", "someday" or null)');
}

function configured() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.DONE_DEV);
}

// ── storage: one JSON document in a private Vercel Blob ──────────────────────
// { tasks: { [id]: task }, deleted: { [id]: isoTimestamp } }
// Writes use the blob ETag (optimistic concurrency) and retry on conflict, so
// concurrent writers (phone, laptop, assistant) never clobber each other.
const { put, get, BlobPreconditionFailedError } = require('@vercel/blob');
const PATH = 'done/tasks.json';

let mem = { tasks: {}, deleted: {} };   // DONE_DEV only (scripts/dev.js)
async function load() {
  if (process.env.DONE_DEV) return { data: JSON.parse(JSON.stringify(mem)), etag: null };
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { data: { tasks: {}, deleted: {} }, etag: null };
  const text = await new Response(r.stream).text();
  const data = JSON.parse(text || '{}');
  return { data: { tasks: data.tasks || {}, deleted: data.deleted || {} }, etag: String(r.blob.etag || '').replace(/^W\//, '') || null };
}

async function mutate(fn) {
  for (let i = 0; i < 9; i++) {
    const { data, etag } = await load();
    const result = await fn(data);
    if (result && result.skip) return result.value;
    if (process.env.DONE_DEV) { mem = data; return result; }
    // prune old tombstones
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    for (const k of Object.keys(data.deleted)) if (data.deleted[k] < cutoff) delete data.deleted[k];
    try {
      await put(PATH, JSON.stringify(data), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        allowOverwrite: true, ...(etag ? { ifMatch: etag } : {}),
      });
      return result;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError || /precondition|etag/i.test(String(e && e.message))) { await new Promise((r) => setTimeout(r, 120 * (i + 1) + Math.random() * 150)); continue; }
      throw e;
    }
  }
  const err = new Error('write conflict, please retry'); err.status = 409; throw err;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-passcode, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  return b && typeof b === 'object' ? b : {};
}

module.exports = { authed, configured, load, mutate, cors, json, readBody, parseDate, dayKey, UUID };
