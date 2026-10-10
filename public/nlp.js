// Tiny natural-date parser for task titles. Pure functions, no dependencies.
// parseWhen("Call mom friday", new Date()) -> { title: "Call mom", date: "2026-10-16", label: "Friday" }
// date: "YYYY-MM-DD" | null (someday) | undefined (no phrase found)
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12); return x; };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const PREP = '(?:(?:on|by|for|due|before|until)\\s+)?';

function resolve(phrase, now) {
  const p = phrase.toLowerCase().replace(/^(on|by|for|due|before|until)\s+/, '').trim();
  const dow = now.getDay();
  if (p === 'today' || p === 'tonight' || p === 'this evening' || p === 'this morning' || p === 'this afternoon') return { date: key(now), label: 'Today' };
  if (p === 'tomorrow' || p === 'tmrw' || p === 'tmr') return { date: key(plus(now, 1)), label: 'Tomorrow' };
  if (p === 'someday' || p === 'later' || p === 'eventually') return { date: null, label: 'Someday' };
  if (p === 'next week') { const diff = (1 - dow + 7) % 7 || 7; return { date: key(plus(now, diff)), label: 'Next Monday' }; }
  if (p === 'this weekend' || p === 'weekend') { const diff = dow === 0 || dow === 6 ? 0 : 6 - dow; return { date: key(plus(now, diff)), label: diff ? 'Saturday' : 'Today' }; }
  let m = p.match(/^in (\d{1,2}) days?$/);
  if (m) return { date: key(plus(now, +m[1])), label: `In ${m[1]} days` };
  m = p.match(/^in (\d{1,2}) weeks?$/);
  if (m) return { date: key(plus(now, 7 * +m[1])), label: `In ${m[1]} weeks` };
  m = p.match(new RegExp('^(?:next\\s+|this\\s+)?' + WD + '$'));
  if (m) {
    const idx = DAYS.indexOf(m[1].slice(0, 3));
    const diff = (idx - dow + 7) % 7 || 7;
    return { date: key(plus(now, diff)), label: DAYNAMES[idx] };
  }
  return null;
}

const BODY = '(today|tonight|tomorrow|tmrw|tmr|someday|later|next week|this weekend|weekend|in \\d{1,2} (?:days?|weeks?)|(?:next\\s+|this\\s+)?(?:' + WD.slice(1, -1) + '))';
const END = new RegExp('(?:^|\\s)(' + PREP + BODY + ')[\\s.!,]*$', 'i');
const START = new RegExp('^[\\s]*(' + PREP + BODY + ')(?:\\s*[:,\\-]\\s*|\\s+)', 'i');

export function parseWhen(text, now = new Date()) {
  const raw = String(text || '').trim();
  for (const [re, side] of [[END, 'end'], [START, 'start']]) {
    const m = raw.match(re);
    if (!m) continue;
    const r = resolve(m[1], now);
    if (!r) continue;
    let title = side === 'end' ? raw.slice(0, m.index) : raw.slice(m[0].length);
    title = title.replace(/\s+/g, ' ').replace(/[\s,:\-]+$/, '').replace(/^[\s,:\-]+/, '').trim();
    if (!title) return { title: raw, date: undefined, label: '' };   // never produce an empty task
    return { title: title[0].toUpperCase() === title[0] || /^[^a-z]/i.test(title[0]) ? title : title[0].toUpperCase() + title.slice(1), date: r.date, label: r.label };
  }
  return { title: raw, date: undefined, label: '' };
}
