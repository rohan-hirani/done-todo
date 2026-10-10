const { authed, configured, db, cors, json, readBody, parseDate, UUID } = require('./_lib');

const COLS = 'id,title,date,done,done_at,position,created_at,updated_at,source';

function clean(b, { partial }) {
  const out = {};
  if (!partial || b.title !== undefined) {
    const t = typeof b.title === 'string' ? b.title.trim() : '';
    if (!t) throw new Error('title is required');
    out.title = t.slice(0, 500);
  }
  if (!partial) out.date = parseDate(b.date);
  else if (b.date !== undefined) out.date = parseDate(b.date);
  if (b.done !== undefined) {
    out.done = !!b.done;
    out.done_at = out.done ? (b.done_at || new Date().toISOString()) : null;
  }
  if (b.position !== undefined) {
    const p = Number(b.position);
    if (!isFinite(p)) throw new Error('position must be a number');
    out.position = p;
  }
  if (typeof b.source === 'string') out.source = b.source.slice(0, 40);
  if (!partial && b.created_at) out.created_at = new Date(b.created_at).toISOString();
  out.updated_at = new Date().toISOString();
  return out;
}

/**
 * GET    /api/tasks              list tasks
 * POST   /api/tasks              {title, date?, ...}  create (or upsert when "id" is given)
 * PATCH  /api/tasks?id=<uuid>    partial update
 * DELETE /api/tasks?id=<uuid>    delete
 * Auth: header "x-passcode: <APP_PASSCODE>" (or Authorization: Bearer <APP_PASSCODE>)
 */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authed(req)) return json(res, 401, { error: 'invalid or missing passcode' });
  if (!configured()) return json(res, 503, { error: 'storage_not_configured' });

  try {
    const id = req.query && req.query.id;
    if (req.method === 'GET') {
      const rows = await db(`tasks?select=${COLS}&order=created_at.desc&limit=3000`);
      return json(res, 200, { tasks: rows });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      const row = clean(b, { partial: false });
      if (b.id !== undefined) {
        if (!UUID.test(String(b.id))) throw new Error('id must be a uuid');
        row.id = b.id;
        if (row.position === undefined) row.position = Date.now();
        row.source = row.source || 'app';
        const out = await db('tasks?on_conflict=id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
        return json(res, 200, { task: out[0] });
      }
      row.source = row.source || 'api';
      if (row.position === undefined) row.position = Date.now();
      const out = await db('tasks', { method: 'POST', body: row, prefer: 'return=representation' });
      return json(res, 201, { task: out[0] });
    }
    if (req.method === 'PATCH') {
      if (!id || !UUID.test(id)) throw new Error('?id=<uuid> required');
      const row = clean(readBody(req), { partial: true });
      const out = await db(`tasks?id=eq.${id}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
      if (!out.length) return json(res, 404, { error: 'not found' });
      return json(res, 200, { task: out[0] });
    }
    if (req.method === 'DELETE') {
      if (!id || !UUID.test(id)) throw new Error('?id=<uuid> required');
      await db(`tasks?id=eq.${id}`, { method: 'DELETE' });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    const bad = !e.status;
    return json(res, bad ? 400 : 502, { error: e.message });
  }
};
