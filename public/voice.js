// In-app voice capture: MediaRecorder -> (Groq Whisper via /api/transcribe | Whisper on device via Transformers.js).
const MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];   // iOS Safari: mp4; Chrome/Android/Firefox: webm/ogg
export const pickMime = () => (typeof MediaRecorder === 'undefined' ? null : MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '');
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined');

/** Start recording. Rejects if the mic can't be opened (err.name === 'NotAllowedError' when denied).
 *  Returns { stop(), done: Promise<{blob, mime, reason, heard, ms}>, hasAnalyser } */
export async function record({ onLevel, onTick, silenceMs = 1500, maxMs = 58000, noSpeechMs = 9000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let ctx, analyser, buf;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (ctx.state === 'running') {
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
      buf = new Uint8Array(analyser.fftSize);
    }
  } catch { /* no analyser: manual stop / max length only */ }
  const t0 = performance.now();
  let heard = false, lastLoud = t0, stopped = false, reason = 'manual', timer;
  let resolveDone; const done = new Promise((r) => (resolveDone = r));
  const finish = (why) => { if (stopped) return; stopped = true; reason = why; clearInterval(timer); if (rec.state !== 'inactive') rec.stop(); };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    const type = rec.mimeType || mime || 'audio/webm';
    resolveDone({ blob: new Blob(chunks, { type }), mime: type, reason, heard, ms: performance.now() - t0 });
  };
  timer = setInterval(() => {
    const now = performance.now();
    let lvl = 0;
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
      lvl = Math.sqrt(s / buf.length);
      if (lvl > 0.03) { heard = true; lastLoud = now; }
    }
    onLevel && onLevel(lvl);
    onTick && onTick(now - t0);
    if (analyser) {
      if (heard && now - lastLoud > silenceMs) return finish('silence');
      if (!heard && now - t0 > noSpeechMs) return finish('nospeech');
    }
    if (now - t0 > maxMs) finish('max');
  }, 50);
  rec.start(250);
  return { stop: () => finish('manual'), done, hasAnalyser: !!analyser };
}

/* ───────── backend A: Groq Whisper through our API route ───────── */
const PROBE_KEY = 'done:stt-groq';
export async function groqAvailable() {
  try { const c = JSON.parse(localStorage.getItem(PROBE_KEY)); if (c && Date.now() - c.t < 6 * 3600e3) return c.v; } catch {}
  try {
    const r = await fetch('/api/transcribe', { cache: 'no-store' });
    const v = r.ok && !!(await r.json()).available;
    localStorage.setItem(PROBE_KEY, JSON.stringify({ v, t: Date.now() }));
    return v;
  } catch { return false; }          // offline etc.: don't cache
}
const toBase64 = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = rej; f.readAsDataURL(blob); });
async function viaGroq(blob) {
  const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: await toBase64(blob), mime: blob.type }) });
  if (r.status === 501 || r.status === 404) { localStorage.setItem(PROBE_KEY, JSON.stringify({ v: false, t: Date.now() })); const e = new Error('groq unavailable'); e.code = 'unavailable'; throw e; }
  if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).error || 'transcription failed'); e.code = 'failed'; throw e; }
  return (await r.json()).text || '';
}

/* ───────── backend B: Whisper tiny on device (Transformers.js in a Web Worker) ───────── */
const LOCAL_KEY = 'done:stt-local';
export const localModelReady = () => localStorage.getItem(LOCAL_KEY) === '1';
let worker, workerReady, jobs = new Map(), jobId = 0, progressCb = null;
function ensureWorker(onProgress) {
  progressCb = onProgress || progressCb;
  if (workerReady) return workerReady;
  worker = new Worker('/stt-worker.js?v=4', { type: 'module' });
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') progressCb && progressCb(m);
      else if (m.type === 'ready') { localStorage.setItem(LOCAL_KEY, '1'); resolve(); }
      else if (m.type === 'error' && !m.id) { workerReady = null; worker.terminate(); reject(new Error(m.error)); }
      else if (m.type === 'result') { jobs.get(m.id)?.res(m.text); jobs.delete(m.id); }
      else if (m.type === 'error') { jobs.get(m.id)?.rej(new Error(m.error)); jobs.delete(m.id); }
    };
    worker.onerror = (e) => { workerReady = null; reject(new Error(e.message || 'voice model failed to start')); };
    worker.postMessage({ type: 'load' });
  });
  return workerReady;
}
async function decode16k(blob) {
  const data = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); p && p.then && p.then(res, rej); });
    const len = Math.max(1, Math.ceil(audio.duration * 16000));
    const off = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, len, 16000);   // resample + downmix to 16 kHz mono
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  } finally { ctx.close().catch(() => {}); }
}
async function viaDevice(blob, onProgress) {
  await ensureWorker(onProgress);
  const audio = await decode16k(blob);
  const id = ++jobId;
  return new Promise((res, rej) => { jobs.set(id, { res, rej }); worker.postMessage({ type: 'run', id, audio }, [audio.buffer]); });
}

/** Transcribe with Groq when the server has a key, otherwise on device. */
export async function transcribe(blob, { onStage, onProgress } = {}) {
  if (navigator.onLine && (await groqAvailable())) {
    try { onStage && onStage('transcribing', 'groq'); return { text: (await viaGroq(blob)).trim(), backend: 'groq' }; }
    catch (e) { if (e.code === 'failed' && localModelReady() === false) throw e; /* unavailable/network -> fall through */ }
  }
  onStage && onStage(localModelReady() ? 'transcribing' : 'downloading', 'device');
  const text = await viaDevice(blob, (m) => { onProgress && onProgress(m); });
  onStage && onStage('transcribing', 'device');
  return { text: text.trim(), backend: 'device' };
}
