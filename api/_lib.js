const crypto = require('crypto');

const TZ = () => process.env.APP_TZ || 'America/New_York';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

// ── password gate ────────────────────────────────────────────────────────────
// Password (case-insensitive) is set via APP_PASSCODE. Browsers get a 1-year httpOnly cookie holding
// HMAC(DONE_SECRET, password); scripts/assistant may send the header "x-passcode" instead.
const PASSWORD = () => String(process.env.APP_PASSCODE || 'rohan').trim().toLowerCase();
const COOKIE = 'done_auth';
function token() { return crypto.createHmac('sha256', process.env.DONE_SECRET || 'dev-only-secret').update('done-v1:' + PASSWORD()).digest('hex'); }
function eq(a, b) { return crypto.timingSafeEqual(sha(a), sha(b)); }
const passwordOk = (p) => eq(String(p == null ? '' : p).trim().toLowerCase(), PASSWORD());

function passcodeFrom(req) {
  const h = req.headers['x-passcode'];
  if (h) return String(h);
  const a = req.headers.authorization || '';
  return a.replace(/^Bearer\s+/i, '');
}
function cookieFrom(req) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : '';
}
function authed(req) {
  const h = passcodeFrom(req);
  if (h && passwordOk(h)) return true;
  const c = cookieFrom(req);
  return !!c && eq(c, token());
}
function setAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token()}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

function dayKey(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// undefined -> today, null/"someday"/"" -> null, "today"/"tomorrow"/YYYY-MM-DD
const nyDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const dateOrNull = (v) => { if (v === null || v === undefined || v === '') return null; const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw new Error('invalid date'); return s; };

// Lazy rollover + backfill. Not-done tasks dated before today (NY) move to today, keeping original_date (first planned date)
// and adding the number of days carried to `rollovers`. Done and Someday (null date) tasks never move.
// Does not touch updated_at (derived change). Returns true if anything changed.
// Topic lists. Stable ids (personal, website, ir, social) never change; each list's display name and color are
// user-editable and live in the blob doc as data.lists so every device sees the same settings.
// Tasks from before lists existed (no/unknown `list`) are backfilled to "personal".
const LISTS = ['personal', 'website', 'ir', 'social'];
const DEFAULT_LISTS = [
  { id: 'personal', name: 'Personal', color: '#e5484d' },
  { id: 'website', name: 'Strategy.com', color: '#2f6bff' },
  { id: 'ir', name: 'Investor Relations', color: '#2fb36d' },
  { id: 'social', name: 'Social Media', color: '#a855f7' },
];
const LIST_ALIASES = { web: 'website', site: 'website', investor: 'ir', investors: 'ir', 'investor relations': 'ir', 'investor-relations': 'ir', investor_relations: 'ir', 'social media': 'social', 'social-media': 'social', social_media: 'social' };
const HEX = /^#[0-9a-f]{6}$/i;
const cleanName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
// Always returns all four lists, in id order, with a valid name and color (missing/bad values fall back to defaults).
function listSettings(data) {
  const saved = Array.isArray(data && data.lists) ? data.lists : [];
  return DEFAULT_LISTS.map((d) => {
    const s = saved.find((x) => x && x.id === d.id) || {};
    const name = cleanName(s.name);
    return { id: d.id, name: name || d.name, color: HEX.test(String(s.color || '')) ? String(s.color).toLowerCase() : d.color, ...(s.updated_at ? { updated_at: s.updated_at } : {}) };
  });
}
// Accepts a list id, the list's current display name (case-insensitive), or a legacy alias. Ids win over names.
function parseList(v, lists = DEFAULT_LISTS) {
  if (v === undefined || v === null || v === '') return 'personal';
  const k = String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  if (LISTS.includes(k)) return k;
  const byName = lists.find((l) => l.name.toLowerCase() === k);
  if (byName) return byName.id;
  if (LIST_ALIASES[k]) return LIST_ALIASES[k];
  throw new Error('invalid list (use an id: personal, website, ir, social, or a list name: ' + lists.map((l) => l.name).join(', ') + ')');
}

function normalize(data) {
  const today = dayKey(0);
  let changed = false;
  const lists = listSettings(data);
  if (JSON.stringify(lists) !== JSON.stringify(data.lists)) { data.lists = lists; changed = true; }   // seed/repair list settings
  for (const t of Object.values(data.tasks)) {
    if (!('planned_date' in t)) { t.planned_date = t.date || null; changed = true; }   // backfill: first scheduled date (Someday stays unplanned)
    if (t.rollovers === undefined) { t.rollovers = 0; changed = true; }
    if (!LISTS.includes(t.list)) { t.list = 'personal'; changed = true; }   // backfill: everything pre-lists lives in Personal
    if (!t.done && t.date && t.date < today) {
      if (!t.original_date) t.original_date = t.date;
      t.rollovers = (t.rollovers || 0) + dayDiff(t.date, today);
      t.date = today;
      changed = true;
    }
  }
  return changed;
}

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
// { tasks: { [id]: task }, deleted: { [id]: isoTimestamp }, lists: [{ id, name, color, updated_at? }] }
// Writes use the blob ETag (optimistic concurrency) and retry on conflict, so
// concurrent writers (phone, laptop, assistant) never clobber each other.
const { put, get, BlobPreconditionFailedError } = require('@vercel/blob');
const PATH = 'done/tasks.json';

let mem = { tasks: {}, deleted: {}, lists: null };   // DONE_DEV only (scripts/dev.js)
async function load() {
  if (process.env.DONE_DEV) return { data: JSON.parse(JSON.stringify(mem)), etag: null };
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { data: { tasks: {}, deleted: {} }, etag: null };
  const text = await new Response(r.stream).text();
  const data = JSON.parse(text || '{}');
  return { data: { tasks: data.tasks || {}, deleted: data.deleted || {}, lists: data.lists || null }, etag: String(r.blob.etag || '').replace(/^W\//, '') || null };
}

async function mutate(fn) {
  for (let i = 0; i < 9; i++) {
    const { data, etag } = await load();
    normalize(data);
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

module.exports = { LISTS, DEFAULT_LISTS, HEX, cleanName, listSettings, parseList, passwordOk, setAuthCookie, nyDate, dayDiff, dateOrNull, normalize, authed, configured, load, mutate, cors, json, readBody, parseDate, dayKey, UUID };
