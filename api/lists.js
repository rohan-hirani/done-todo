const { DEFAULT_LISTS, MAX_LISTS, HEX, SLUG, cleanName, slugify, uniqueSlug, listSettings, publicLists, parseList, authed, configured, load, mutate, cors, json, readBody } = require('./_lib');

/**
 * Topic lists (stored in the blob doc as data.lists, shared by every device). Ids are stable slugs.
 * GET    /api/lists                         {lists: [{id, name, color, order}]}  sorted by order
 * POST   /api/lists                         {name, color?, id?}  add a list (id = slug of the name unless a free slug is given)
 * PATCH  /api/lists?id=<id or name>         {name?, color?}  rename / recolor
 * PUT    /api/lists                         {order: [id, ...]}  reorder (ids not mentioned keep their relative order, after)
 * DELETE /api/lists?id=<id or name>         delete a list; its tasks (open and archived) move to Personal. Personal
 *                                           and the last remaining list can't be deleted. Tasks are never deleted.
 * Requires the password cookie or an x-passcode header (see README).
 */
const PALETTE = ['#f76b15', '#12a594', '#e93d82', '#5b5bd6', '#e2a50b', '#0b9fd8', '#ad7f58', '#7d838d'];
const err = (m, status = 400) => Object.assign(new Error(m), { status });
function checkName(name, lists, selfId) {
  const n = cleanName(name);
  if (!n) throw err('name must not be empty');
  const lower = n.toLowerCase();
  const clash = lists.find((l) => l.id !== selfId && (l.name.toLowerCase() === lower || l.id === lower));
  if (clash) throw err(`another list is already called “${clash.name}”`);
  return n;
}
function checkColor(c) {
  const v = String(c).trim().toLowerCase();
  if (!HEX.test(v)) throw err('color must be a hex color like #2f6bff');
  return v;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authed(req)) return json(res, 401, { error: 'invalid or missing passcode' });
  if (!configured()) return json(res, 503, { error: 'storage_not_configured' });
  try {
    const b = readBody(req);
    const ref = (req.query && req.query.id) || b.id;
    const now = new Date().toISOString();
    if (req.method === 'GET') {
      const { data } = await load();
      return json(res, 200, { lists: publicLists(data) });
    }
    if (req.method === 'POST') {
      const result = await mutate((data) => {
        const cur = listSettings(data);
        if (cur.length >= MAX_LISTS) throw err(`at most ${MAX_LISTS} lists`);
        const name = checkName(b.name, cur, null);
        const want = b.id !== undefined ? String(b.id).toLowerCase() : '';
        if (want && cur.some((l) => l.id === want)) return { skip: true, value: { existing: true, lists: cur } };   // idempotent retry
        const taken = new Set(cur.map((l) => l.id).concat(DEFAULT_LISTS.map((l) => l.id)));
        const id = want && SLUG.test(want) && !taken.has(want) ? want : uniqueSlug(slugify(name), taken);
        const color = b.color !== undefined ? checkColor(b.color) : PALETTE[cur.length % PALETTE.length];
        data.lists = cur.concat({ id, name, color, order: cur.length, updated_at: now });
        return { id, lists: data.lists };
      });
      return json(res, result.existing ? 200 : 201, { list: publicLists(result).find((l) => l.id === (result.id || String(b.id).toLowerCase())) || null, lists: publicLists(result) });
    }
    if (req.method === 'PATCH') {
      if (!ref) throw err('?id=<list id> required');
      const lists = await mutate((data) => {
        const cur = listSettings(data);
        const id = parseList(ref, cur);
        const patch = {};
        if (b.name !== undefined) patch.name = checkName(b.name, cur, id);
        if (b.color !== undefined) patch.color = checkColor(b.color);
        if (!Object.keys(patch).length) throw err('nothing to change (send name and/or color)');
        data.lists = cur.map((l) => (l.id === id ? { ...l, ...patch, updated_at: now } : l));
        return data.lists;
      });
      return json(res, 200, { lists: publicLists({ lists }) });
    }
    if (req.method === 'PUT') {
      if (!Array.isArray(b.order)) throw err('send {order: [list ids]}');
      const lists = await mutate((data) => {
        const cur = listSettings(data);
        const rank = new Map(b.order.map((x, i) => [String(x).toLowerCase(), i]));
        const sorted = cur.slice().sort((x, y) => (rank.has(x.id) ? rank.get(x.id) : 1e6 + x.order) - (rank.has(y.id) ? rank.get(y.id) : 1e6 + y.order));
        data.lists = sorted.map((l, i) => ({ ...l, order: i }));
        return data.lists;
      });
      return json(res, 200, { lists: publicLists({ lists }) });
    }
    if (req.method === 'DELETE') {
      if (!ref) throw err('?id=<list id> required');
      const out = await mutate((data) => {
        const cur = listSettings(data);
        let id;
        try { id = parseList(ref, cur); } catch { return { skip: true, value: { gone: true, moved: 0, lists: cur } }; }   // already deleted
        if (id === 'personal') throw err('Personal is the fallback list and can’t be deleted');
        if (cur.length <= 1) throw err('can’t delete the last list');
        let moved = 0;
        for (const t of Object.values(data.tasks)) if (t.list === id) { t.list = 'personal'; t.updated_at = now; moved++; }
        data.lists = cur.filter((l) => l.id !== id);
        return { moved, lists: data.lists };
      });
      return json(res, 200, { ok: true, moved_to_personal: out.moved, lists: publicLists(out) });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(res, e.status === 409 ? 409 : 400, { error: e.message });
  }
};
