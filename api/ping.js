const { authed, configured, cors, json } = require('./_lib');

// Tells the client whether the server is set up and whether its passcode is valid.
module.exports = (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  json(res, 200, { ok: true, configured: configured(), authed: authed(req) });
};
