const { authed, configured, cors, json } = require('./_lib');

// Health check: reports whether server storage is configured.
module.exports = (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  json(res, 200, { ok: true, configured: configured(), authed: authed(req) });
};
