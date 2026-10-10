// POST /api/transcribe  {audio: <base64>, mime: "audio/mp4"}  ->  {text}
// GET  /api/transcribe  ->  {available: boolean}   (is GROQ_API_KEY configured?)
// Without GROQ_API_KEY, POST returns 501 and the client falls back to on-device Whisper.
const { cors, json, readBody } = require('./_lib');

const MAX_BYTES = 3.2 * 1024 * 1024;   // decoded audio; Vercel request bodies are capped at 4.5 MB (base64 adds ~33%)
const EXT = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const key = process.env.GROQ_API_KEY;
  if (req.method === 'GET') return json(res, 200, { available: !!key });
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  if (!key) return json(res, 501, { error: 'transcription not configured' });
  try {
    const b = readBody(req);
    const bytes = Buffer.from(String(b.audio || ''), 'base64');
    if (bytes.length < 200) return json(res, 400, { error: 'no audio' });
    if (bytes.length > MAX_BYTES) return json(res, 413, { error: 'clip too long (max ~60 s)' });
    const base = String(b.mime || 'audio/webm').split(';')[0].trim().toLowerCase();
    const type = EXT[base] ? base : 'audio/webm';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), `clip.${EXT[type]}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!r.ok) { const t = await r.text().catch(() => ''); return json(res, 502, { error: 'upstream ' + r.status + ': ' + t.slice(0, 200) }); }
    const out = await r.json();
    return json(res, 200, { text: String(out.text || '').trim() });
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) });
  }
};
