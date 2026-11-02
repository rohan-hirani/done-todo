const { LISTS, HEX, cleanName, listSettings, parseList, authed, configured, load, mutate, cors, json, readBody } = require('./_lib');

/**
 * Topic-list display settings (stored in the blob doc as data.lists, shared by every device).
 * GET   /api/lists                          {lists: [{id, name, color}]}
 * PATCH /api/lists?id=<id or name>          {name?, color?}  rename / recolor one list. color is #rrggbb.
 *   Ids (personal, website, ir, social) never change, so tasks and API callers keep working after a rename.
 * Requires the password cookie or an x-passcode header (see README).
 */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authed(req)) return json(res, 401, { error: 'invalid or missing passcode' });
  if (!configured()) return json(res, 503, { error: 'storage_not_configured' });
  try {
    if (req.method === 'GET') {
      const { data } = await load();
      return json(res, 200, { lists: listSettings(data).map(({ id, name, color }) => ({ id, name, color })) });
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      const b = readBody(req);
      const ref = (req.query && req.query.id) || b.id;
      if (!ref) throw new Error('?id=<list id> required');
      const patch = {};
      if (b.name !== undefined) {
        patch.name = cleanName(b.name);
        if (!patch.name) throw new Error('name must not be empty');
      }
      if (b.color !== undefined) {
        const c = String(b.color).trim().toLowerCase();
        if (!HEX.test(c)) throw new Error('color must be a hex color like #2f6bff');
        patch.color = c;
      }
      if (!Object.keys(patch).length) throw new Error('nothing to change (send name and/or color)');
      const lists = await mutate((data) => {
        const cur = listSettings(data);
        const id = parseList(ref, cur);
        if (patch.name) {
          const lower = patch.name.toLowerCase();
          const clash = cur.find((l) => l.id !== id && (l.name.toLowerCase() === lower || l.id === lower));
          if (clash) { const e = new Error(`another list is already called “${clash.name}”`); throw e; }
          if (LISTS.includes(lower) && lower !== id) throw new Error('that name is another list’s id');
        }
        data.lists = cur.map((l) => (l.id === id ? { ...l, ...patch, updated_at: new Date().toISOString() } : l));
        return data.lists;
      });
      return json(res, 200, { lists: lists.map(({ id, name, color }) => ({ id, name, color })) });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(res, e.status === 409 ? 409 : 400, { error: e.message });
  }
};
