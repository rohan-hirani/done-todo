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

function authed(req) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  return crypto.timingSafeEqual(sha(passcodeFrom(req)), sha(expected));
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
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function db(path, { method = 'GET', body, prefer } = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const err = new Error((data && data.message) || `Supabase error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
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

module.exports = { authed, configured, db, cors, json, readBody, parseDate, dayKey, UUID };
