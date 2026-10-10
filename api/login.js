// POST /api/login {password} -> sets a 1-year httpOnly cookie. DELETE clears it.
const { passwordOk, setAuthCookie, cors, json, readBody } = require('./_lib');
const fails = new Map();   // best-effort per-instance throttle

module.exports = (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', 'done_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'); return json(res, 200, { ok: true }); }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const f = fails.get(ip) || { n: 0, t: 0 };
  if (f.n >= 10 && Date.now() - f.t < 60000) return json(res, 429, { error: 'too many attempts, try again in a minute' });
  if (!passwordOk(readBody(req).password)) { fails.set(ip, { n: (Date.now() - f.t < 60000 ? f.n : 0) + 1, t: Date.now() }); return json(res, 401, { error: 'wrong password' }); }
  fails.delete(ip);
  setAuthCookie(res);
  json(res, 200, { ok: true });
};
