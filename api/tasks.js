const crypto = require('crypto');
const { authed, configured, load, mutate, cors, json, readBody, parseDate, UUID } = require('./_lib');

const validIso = (v) => { const d = new Date(v); return v && !isNaN(d) ? d.toISOString() : null; };

function fields(b, { partial }) {
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
    out.done_at = out.done ? validIso(b.done_at) || new Date().toISOString() : null;
  }
  if (b.position !== undefined) {
    const p = Number(b.position);
    if (!isFinite(p)) throw new Error('position must be a number');
    out.position = p;
  }
  if (typeof b.source === 'string') out.source = b.source.slice(0, 40);
  return out;
}

/**
 * GET    /api/tasks              list tasks
 * POST   /api/tasks              {title, date?, ...}  create (or upsert when "id" is given; newest updated_at wins)
 * PATCH  /api/tasks?id=<uuid>    partial update (title, date, done, position)
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
      const { data } = await load();
      const tasks = Object.values(data.tasks).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json(res, 200, { tasks });
    }
    if (req.method === 'POST') {
      const b = readBody(req);
      const f = fields(b, { partial: false });
      const now = new Date().toISOString();
      const upsert = b.id !== undefined;
      if (upsert && !UUID.test(String(b.id))) throw new Error('id must be a uuid');
      const tid = upsert ? String(b.id).toLowerCase() : crypto.randomUUID();
      const stamp = (upsert && validIso(b.updated_at)) || now;
      let created = true;
      const task = await mutate((data) => {
        const old = data.tasks[tid];
        if (data.deleted[tid] && data.deleted[tid] >= stamp) return { skip: true, value: null };   // deleted after this write
        if (old && old.updated_at > stamp) { created = false; return { skip: true, value: old }; } // newer version already stored
        created = !old;
        delete data.deleted[tid];
        const t = {
          id: tid, title: f.title, date: f.date, done: f.done ?? false, done_at: f.done_at ?? null,
          position: f.position ?? Date.now(), created_at: (upsert && validIso(b.created_at)) || (old && old.created_at) || now,
          updated_at: stamp, source: f.source || (old && old.source) || (upsert ? 'app' : 'api'),
        };
        data.tasks[tid] = t;
        return t;
      });
      if (!task) return json(res, 200, { task: null, deleted: true });
      return json(res, upsert ? 200 : created ? 201 : 200, { task });
    }
    if (req.method === 'PATCH') {
      if (!id || !UUID.test(id)) throw new Error('?id=<uuid> required');
      const f = fields(readBody(req), { partial: true });
      const task = await mutate((data) => {
        const old = data.tasks[id];
        if (!old) return { skip: true, value: null };
        return (data.tasks[id] = { ...old, ...f, updated_at: new Date().toISOString() });
      });
      return task ? json(res, 200, { task }) : json(res, 404, { error: 'not found' });
    }
    if (req.method === 'DELETE') {
      if (!id || !UUID.test(id)) throw new Error('?id=<uuid> required');
      await mutate((data) => { delete data.tasks[id]; data.deleted[id] = new Date().toISOString(); return true; });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(res, e.status === 409 ? 409 : 400, { error: e.message });
  }
};
