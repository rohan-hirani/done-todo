const { nyDate, dayKey } = require('./_lib');

const addDays = (k, n) => new Date(Date.parse(k + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (k) => new Date(k + 'T12:00:00Z').getUTCDay();
const round = (x, p = 1000) => (x === null || x === undefined ? null : Math.round(x * p) / p);
const rate = (o, n) => (n ? round(o / n) : null);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Definitions (all dates America/New_York, deleted tasks are excluded because they no longer exist):
 *  planned task   = has planned_date <= today  (Someday tasks have no planned_date until they are scheduled)
 *  on-time        = done and NY date of done_at === planned_date
 *  last7 / last30 = the 7 / 30 days BEFORE today (today is still in progress, reported separately)
 */
function computeStats(data, today = dayKey(0)) {
  const tasks = Object.values(data.tasks);
  const doneDay = (t) => (t.done && t.done_at ? nyDate(t.done_at) : null);
  const planned = tasks.filter((t) => t.planned_date && t.planned_date <= today);
  const byDay = {};
  for (const t of planned) {
    const d = (byDay[t.planned_date] ||= { planned: 0, on_time: 0 });
    d.planned++;
    if (doneDay(t) === t.planned_date) d.on_time++;
  }
  const win = (n) => {
    let p = 0, o = 0;
    for (let i = 1; i <= n; i++) { const d = byDay[addDays(today, -i)]; if (d) { p += d.planned; o += d.on_time; } }
    return { planned: p, on_time: o, rate: rate(o, p) };
  };
  // today's list = tasks dated today + anything finished today
  const todayList = tasks.filter((t) => t.date === today || doneDay(t) === today);
  const todayDone = todayList.filter((t) => t.done).length;
  // overall
  const universe = tasks.filter((t) => (t.planned_date && t.planned_date <= today) || t.done);
  const doneAll = universe.filter((t) => t.done).length;
  const rolled = universe.filter((t) => (t.rollovers || 0) > 0);
  const totalRoll = universe.reduce((a, t) => a + (t.rollovers || 0), 0);
  // streaks: consecutive days with at least one completion
  const days = [...new Set(tasks.map(doneDay).filter(Boolean))].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  let cur = 0, k = days.includes(today) ? today : addDays(today, -1);
  while (days.includes(k)) { cur++; k = addDays(k, -1); }
  // daily series (30 days ending yesterday + today)
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i), v = byDay[d] || { planned: 0, on_time: 0 };
    daily.push({ date: d, planned: v.planned, on_time: v.on_time, rate: rate(v.on_time, v.planned) });
  }
  // weekdays (all history before today)
  const wk = Array.from({ length: 7 }, (_, i) => ({ day: WD[i], planned: 0, on_time: 0 }));
  for (const [d, v] of Object.entries(byDay)) if (d < today) { wk[dow(d)].planned += v.planned; wk[dow(d)].on_time += v.on_time; }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((i) => ({ ...wk[i], rate: rate(wk[i].on_time, wk[i].planned) }));
  const l7 = win(7), l30 = win(30);
  const pct = (r) => (r === null ? 'n/a' : Math.round(r * 100) + '%');
  return {
    as_of: new Date().toISOString(),
    timezone: process.env.APP_TZ || 'America/New_York',
    today: { date: today, total: todayList.length, done: todayDone, completion: rate(todayDone, todayList.length) },
    on_time: { last7: l7, last30: l30 },
    completion: { done: doneAll, total: universe.length, rate: rate(doneAll, universe.length) },
    streak: { current: cur, best },
    rollovers: { average_per_task: round(universe.length ? totalRoll / universe.length : 0, 100), total: totalRoll, tasks_rolled_over: rolled.length },
    counts: { open: tasks.filter((t) => !t.done).length, done: tasks.filter((t) => t.done).length, someday: tasks.filter((t) => !t.done && !t.date).length },
    daily,
    weekdays,
    summary: `Today ${todayDone}/${todayList.length} done (${pct(rate(todayDone, todayList.length))}). On-time: ${pct(l7.rate)} last 7 days, ${pct(l30.rate)} last 30. Completion ${pct(rate(doneAll, universe.length))} overall. Streak ${cur} (best ${best}). Avg rollovers per task ${round(universe.length ? totalRoll / universe.length : 0, 100)}.`,
  };
}
module.exports = { computeStats };
