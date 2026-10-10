// Tiny canvas confetti. Draws only while particles exist, so it costs nothing at rest.
const cv = document.getElementById('fx');
const ctx = cv.getContext('2d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const COLORS = ['#e5484d', '#2f6bff', '#ffb224', '#2fb36d', '#a259ff', '#ff7ab8'];
let parts = [], raf = 0, dpr = 1;

function size() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
}
addEventListener('resize', size); size();

function spawn(x, y, n, { spread = Math.PI * 2, angle = -Math.PI / 2, speed = 7, size: sz = 6, life = 70 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.45 + Math.random() * 0.75);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, s: sz * (0.6 + Math.random() * 0.8), c: COLORS[(Math.random() * COLORS.length) | 0], life: life * (0.7 + Math.random() * 0.6), age: 0, round: Math.random() < 0.35 });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.age < p.life && p.y < innerHeight + 40);
  for (const p of parts) {
    p.age++; p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.28; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    ctx.globalAlpha = Math.min(1, (p.life - p.age) / 20);
    ctx.fillStyle = p.c;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.28); ctx.fill(); }
    else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  raf = parts.length ? requestAnimationFrame(tick) : (ctx.clearRect(0, 0, innerWidth, innerHeight), 0);
}

export function burst(x, y) {
  if (reduce.matches) return;
  spawn(x, y, 34, { spread: Math.PI * 2, speed: 7.5, size: 8, life: 62 });
}
export function celebrate() {
  if (reduce.matches) return;
  const w = innerWidth, h = innerHeight;
  spawn(w * 0.5, h * 0.45, 90, { spread: Math.PI * 2, speed: 13, size: 9, life: 110 });
  setTimeout(() => { spawn(w * 0.05, h * 0.85, 70, { angle: -Math.PI / 3, spread: 0.9, speed: 19, size: 9, life: 120 }); spawn(w * 0.95, h * 0.85, 70, { angle: (-2 * Math.PI) / 3, spread: 0.9, speed: 19, size: 9, life: 120 }); }, 180);
  setTimeout(() => spawn(w * 0.5, h * 0.2, 60, { angle: Math.PI / 2, spread: 2.6, speed: 6, size: 8, life: 130 }), 450);
}
