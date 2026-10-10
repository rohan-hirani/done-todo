// Runs Whisper on device. Model files are cached by Transformers.js in Cache Storage; the library and wasm come
// from the CDN and are cached by the service worker, so it works offline after the first download.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

env.allowLocalModels = false;
env.useBrowserCache = true;
try { env.backends.onnx.wasm.numThreads = 1; } catch {}
const MODEL = 'Xenova/whisper-tiny.en';
let transcriber = null;
const files = {};

async function load() {
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) { files[p.file] = { loaded: p.loaded, total: p.total }; }
    const vals = Object.values(files);
    const total = vals.reduce((a, f) => a + f.total, 0), loaded = vals.reduce((a, f) => a + f.loaded, 0);
    postMessage({ type: 'progress', status: p.status, file: p.file, loaded, total, pct: total ? Math.round((loaded / total) * 100) : 0 });
  };
  const tryDevice = async (device, dtype) => pipeline('automatic-speech-recognition', MODEL, { device, dtype, progress_callback });
  try {
    if (self.navigator && navigator.gpu && !/iPhone|iPad/.test(navigator.userAgent) && (await navigator.gpu.requestAdapter().catch(() => null))) {
      try { transcriber = await tryDevice('webgpu', { encoder_model: 'fp32', decoder_model_merged: 'q4' }); }
      catch { transcriber = null; }
    }
    if (!transcriber) transcriber = await tryDevice('wasm', 'q8');
    postMessage({ type: 'ready' });
  } catch (e) { postMessage({ type: 'error', error: String(e && e.message || e) }); }
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') return load();
  if (m.type === 'run') {
    try {
      const out = await transcriber(m.audio, { chunk_length_s: 30, return_timestamps: false });
      const text = String(out.text || '').replace(/\[[A-Z_ ]+\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      postMessage({ type: 'result', id: m.id, text });
    } catch (err) { postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) }); }
  }
};
