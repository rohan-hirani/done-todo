// GET /api/stats -> productivity numbers (see _stats.js for definitions). Open, like the rest of the API.
const { authed, configured, load, normalize, cors, json } = require('./_lib');
const { computeStats } = require('./_stats');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  if (!authed(req)) return json(res, 401, { error: 'unauthorized' });
  if (!configured()) return json(res, 503, { error: 'storage_not_configured' });
  try {
    const { data } = await load();
    normalize(data);
    return json(res, 200, computeStats(data));
  } catch (e) { return json(res, 500, { error: String(e && e.message || e) }); }
};
