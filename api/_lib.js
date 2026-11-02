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

const nyDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const dateOrNull = (v) => { if (v === null || v === undefined || v === '') return null; const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw new Error('invalid date'); return s; };

// Backfills (lists, priority, planned_date) and the one-time v9 due-date migration run in normalize() below.
// Does not touch updated_at except for the migration. Returns true if anything changed.
// Topic lists live in the blob doc as data.lists = [{id, name, color, order}] so every device shows the same
// names, colors and order. Ids are stable slugs (built-ins: personal, website, ir, social; user-added lists get a
// slug generated from their name). "personal" always exists and is the fallback: tasks whose list is missing or
// unknown (pre-lists tasks, or tasks of a deleted list) live there.
const DEFAULT_LISTS = [
  { id: 'personal', name: 'Personal', color: '#e5484d', order: 0 },
  { id: 'ir', name: 'Investor Relations', color: '#2fb36d', order: 1 },
  { id: 'social', name: 'Social Media', color: '#a855f7', order: 2 },
  { id: 'website', name: 'Strategy.com', color: '#2f6bff', order: 3 },
];
const LIST_ALIASES = { web: 'website', site: 'website', investor: 'ir', investors: 'ir', 'investor relations': 'ir', 'investor-relations': 'ir', investor_relations: 'ir', 'social media': 'social', 'social-media': 'social', social_media: 'social' };
const MAX_LISTS = 20;
const HEX = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const cleanName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
const slugify = (name) => cleanName(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'list';
function uniqueSlug(base, taken) { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; }
// Valid, de-duplicated lists sorted by order (orders renumbered 0..n-1). Seeds the defaults when nothing is saved.
function listSettings(data) {
  const saved = Array.isArray(data && data.lists) && data.lists.length ? data.lists : DEFAULT_LISTS;
  const seen = new Set(), out = [];
  saved.forEach((s, i) => {
    if (!s || !SLUG.test(String(s.id || '')) || seen.has(s.id) || out.length >= MAX_LISTS) return;
    seen.add(s.id);
    const d = DEFAULT_LISTS.find((x) => x.id === s.id);
    out.push({ id: s.id, name: cleanName(s.name) || (d ? d.name : s.id), color: HEX.test(String(s.color || '')) ? String(s.color).toLowerCase() : d ? d.color : '#7d838d', order: Number.isFinite(+s.order) ? +s.order : 1000 + i, ...(s.updated_at ? { updated_at: s.updated_at } : {}) });
  });
  if (!seen.has('personal')) out.unshift({ ...DEFAULT_LISTS[0], order: -1 });
  out.sort((a, b) => a.order - b.order);
  out.forEach((l, i) => { l.order = i; });
  return out;
}
const publicLists = (data) => listSettings(data).map(({ id, name, color, order }) => ({ id, name, color, order }));
// Accepts a list id, the list's current display name (case-insensitive), or a legacy alias. Ids win over names.
function parseList(v, lists = DEFAULT_LISTS) {
  if (v === undefined || v === null || v === '') return 'personal';
  const k = String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  if (lists.some((l) => l.id === k)) return k;
  const byName = lists.find((l) => l.name.toLowerCase() === k);
  if (byName) return byName.id;
  if (LIST_ALIASES[k] && lists.some((l) => l.id === LIST_ALIASES[k])) return LIST_ALIASES[k];
  throw new Error('invalid list (use a list id or name: ' + lists.map((l) => `${l.id} = ${l.name}`).join(', ') + ')');
}

// Priority: "high" | "normal". Accepts "high"/"normal"/"low"/"none", true/false, "!" and null. Replaces the old Top-3 `pinned` star.
function parsePriority(v) {
  if (v === true) return 'high';
  if (v === false || v === null || v === undefined) return 'normal';
  const k = String(v).trim().toLowerCase();
  if (['high', '!', 'urgent', 'true', '1', 'yes'].includes(k)) return 'high';
  if (['normal', 'none', 'low', '', 'false', '0', 'no'].includes(k)) return 'normal';
  throw new Error('invalid priority (use "high" or "normal", or true/false)');
}

// One-time v9 migration: before v8, every task had a "day" (date) that auto-rolled forward; since v8 `date` is an
// optional due date. Open tasks created before v8 get their old day cleared (kept in `pre_v9_date` for reference).
const V8_CUTOFF = '2026-11-02T00:00:00.000Z';
function normalize(data) {
  let changed = false;
  const lists = listSettings(data);
  if (JSON.stringify(lists) !== JSON.stringify(data.lists)) { data.lists = lists; changed = true; }   // seed/repair list settings
  const ids = new Set(lists.map((l) => l.id));
  data.migrations = data.migrations || {};
  if (!data.migrations.v9_due_dates) {
    const now = new Date().toISOString();
    for (const t of Object.values(data.tasks)) {
      if (!t.done && t.date && (t.created_at || '') < V8_CUTOFF) { t.pre_v9_date = t.date; t.date = null; t.updated_at = now; }
    }
    data.migrations.v9_due_dates = now;
    changed = true;
  }
  for (const t of Object.values(data.tasks)) {
    if (!('planned_date' in t)) { t.planned_date = t.date || null; changed = true; }   // backfill: first scheduled date (Someday stays unplanned)
    if (t.rollovers === undefined) { t.rollovers = 0; changed = true; }
    if (!ids.has(t.list)) { t.list = 'personal'; changed = true; }   // backfill: pre-lists tasks / deleted lists -> Personal
    if (t.priority !== 'high' && t.priority !== 'normal') { t.priority = t.pinned ? 'high' : 'normal'; changed = true; }   // migrate Top-3 stars to high priority
    if (t.pinned !== (t.priority === 'high')) { t.pinned = t.priority === 'high'; changed = true; }   // keep legacy mirror in sync
    // No auto-rollover: `date` is a due date and stays put; past-due open tasks show as Overdue.
  }
  return changed;
}

function parseDate(v) {
  if (v === undefined) return null;   // no due date unless one is given
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
// { tasks: { [id]: task }, deleted: { [id]: isoTimestamp }, lists: [{ id, name, color, order }], migrations: {} }
// Writes use the blob ETag (optimistic concurrency) and retry on conflict, so
// concurrent writers (phone, laptop, assistant) never clobber each other.
const { put, get, BlobPreconditionFailedError } = require('@vercel/blob');
const PATH = 'done/tasks.json';

let mem = { tasks: {}, deleted: {}, lists: null, migrations: {} };   // DONE_DEV only (scripts/dev.js)
async function load() {
  if (process.env.DONE_DEV) return { data: JSON.parse(JSON.stringify(mem)), etag: null };
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { data: { tasks: {}, deleted: {} }, etag: null };
  const text = await new Response(r.stream).text();
  const data = JSON.parse(text || '{}');
  return { data: { tasks: data.tasks || {}, deleted: data.deleted || {}, lists: data.lists || null, migrations: data.migrations || {} }, etag: String(r.blob.etag || '').replace(/^W\//, '') || null };
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
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

module.exports = { parsePriority, DEFAULT_LISTS, MAX_LISTS, HEX, SLUG, cleanName, slugify, uniqueSlug, listSettings, publicLists, parseList, passwordOk, setAuthCookie, nyDate, dayDiff, dateOrNull, normalize, authed, configured, load, mutate, cors, json, readBody, parseDate, dayKey, UUID };
