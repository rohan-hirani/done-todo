// Soft WebAudio pops (no audio files). Quiet by design.
let ac;
function ctx() {
  if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ac = new C(); }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(f0, f1, t0, dur, vol) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  const t = c.currentTime + t0;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
export function pop(muted) { if (muted) return; tone(480, 900, 0, 0.14, 0.05); }
export function fanfare(muted) { if (muted) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f * 1.01, i * 0.09, 0.32, 0.05)); }
