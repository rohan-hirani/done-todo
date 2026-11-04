// Done — a calm, day-by-day to-do list. Vanilla JS, no build step.
import { burst, celebrate } from './fx.js';
import * as sfx from './sound.js';
import { parseWhen } from './nlp.js';
import { record, canRecord, transcribe } from './voice.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = 'done:v1';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isMobile = () => matchMedia('(max-width:760px)').matches;

/* ───────────── state ───────────── */
// High priority replaced the old "Top 3" star: pinned tasks become priority "high"; `pinned` is kept as a mirror.
function migratePriority(tasks) {
  for (const t of Object.values(tasks)) if (t.priority !== 'high' && t.priority !== 'normal') t.priority = t.pinned ? 'high' : 'normal';
  return tasks;
}
const isHigh = (t) => t.priority === 'high';
// A leading or trailing "!" (one or more, e.g. "!! Call bank" or "Call bank!") marks a task high priority and is stripped.
function bang(text) {
  const s = String(text || '');
  const m = s.match(/^\s*!+\s*([\s\S]*?)\s*$/) || s.match(/^\s*([\s\S]*?)\s*!+\s*$/);
  return m && m[1].trim() ? { title: m[1].trim(), high: true } : { title: s, high: false };
}
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const S = {
  tasks: migratePriority(saved.tasks || {}),
  queue: saved.queue || [],
  muted: !!saved.muted,
  haptics: saved.haptics !== false,
  voiceFirst: !!saved.voiceFirst,
  view: saved.view || 'focus',
  days: saved.days || 7,
  lists: saved.lists || null,
  mode: 'local',
};
function persist() {
  localStorage.setItem(LS, JSON.stringify({ tasks: S.tasks, queue: S.queue, muted: S.muted, haptics: S.haptics, voiceFirst: S.voiceFirst, view: S.view, days: S.days, lists: S.lists }));
}
const buzz = (p) => { if (S.haptics && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(p); };

/* ───────────── topic lists ───────────── */
// Lists come from the server (data.lists: [{id, name, color, order}]) so names, colors and order sync across devices.
// Ids are stable slugs; "personal" always exists and is the fallback for tasks of unknown/deleted lists.
const DEFAULT_LISTS = [
  { id: 'personal', name: 'Personal', color: '#e5484d', order: 0 },
  { id: 'ir', name: 'Investor Relations', color: '#2fb36d', order: 1 },
  { id: 'social', name: 'Social Media', color: '#a855f7', order: 2 },
  { id: 'website', name: 'Strategy.com', color: '#2f6bff', order: 3 },
];
const LIST_SHORT = { 'investor relations': 'IR', 'social media': 'Social' };
const HEX = /^#[0-9a-f]{6}$/i;
function lists() {
  const src = Array.isArray(S.lists) && S.lists.length ? S.lists : DEFAULT_LISTS;
  const seen = new Set(), out = [];
  src.forEach((l, i) => { if (l && l.id && !seen.has(l.id)) { seen.add(l.id); out.push({ id: l.id, name: (l.name || '').trim() || l.id, color: HEX.test(l.color || '') ? l.color : '#7d838d', order: Number.isFinite(+l.order) ? +l.order : 1000 + i }); } });
  if (!seen.has('personal')) out.unshift({ ...DEFAULT_LISTS[0], order: -1 });
  return out.sort((a, b) => a.order - b.order);
}
const listIds = () => lists().map((l) => l.id);
const listCfg = (id) => lists().find((l) => l.id === id) || lists().find((l) => l.id === 'personal');
const listOf = (t) => (listIds().includes(t.list) ? t.list : 'personal');   // pre-lists tasks / deleted lists live in Personal
const listName = (id) => listCfg(id).name;
const listColor = (id) => listCfg(id).color;
// Compact label for the mobile switcher / capture summary: short names as-is, long multi-word names abbreviated.
const listShort = (id) => { const n = listName(id); if (LIST_SHORT[n.toLowerCase()]) return LIST_SHORT[n.toLowerCase()]; return n.length <= 13 ? n : n.split(' ')[0].slice(0, 13); };
const slugify = (name) => String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'list';

/* ───────────── dates ───────────── */
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const fmt = (k, o) => fromKey(k).toLocaleDateString(undefined, o);
const doneKey = (t) => (t.done_at ? keyOf(new Date(t.done_at)) : null);
function dayName(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, 1)) return 'Tomorrow';
  if (k === addDays(t, -1)) return 'Yesterday';
  return fmt(k, { weekday: 'long' });
}
// Due-date badge: nothing when undated, "Overdue" when past, "Due Today" only when it's actually today, else "Due Mon, Nov 3".
const dueLabel = (k) => (!k ? '' : k < todayKey() ? 'Overdue' : k === todayKey() ? 'Due Today' : 'Due ' + fmt(k, { weekday: 'short', month: 'short', day: 'numeric' }));
const whenLabel = (k) => (k === null ? 'Someday' : k === todayKey() ? 'Today' : k === addDays(todayKey(), 1) ? 'Tomorrow' : fmt(k, { weekday: 'short', month: 'short', day: 'numeric' }));

/* ───────────── data ops ───────────── */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const nowIso = () => new Date().toISOString();

function put(task) {
  task.updated_at = nowIso();
  S.tasks[task.id] = task;
  S.queue = S.queue.filter((q) => !(q.t === 'put' && q.task.id === task.id));
  S.queue.push({ t: 'put', task: { ...task } });
  persist(); render(); scheduleFlush();
}
function addTask(title, date, list = 'personal', high = false) {
  title = title.trim();
  if (!title) return null;
  const t = { id: uid(), title, list: listIds().includes(list) ? list : 'personal', date, planned_date: date, original_date: null, rollovers: 0, done: false, done_at: null, priority: high ? 'high' : 'normal', pinned: !!high, position: Date.now(), created_at: nowIso(), updated_at: nowIso(), source: 'app' };
  put(t);
  return t;
}
function removeTask(id) {
  const t = S.tasks[id];
  if (!t) return;
  delete S.tasks[id];
  S.queue = S.queue.filter((q) => !(q.t === 'put' && q.task.id === id));
  S.queue.push({ t: 'del', id });
  persist(); render(); scheduleFlush();
  return t;
}

/* No auto-rollover: `date` is an optional due date and never moves by itself (past-due tasks show Overdue). */

/* ───────────── derived ───────────── */
function streak() {
  const days = new Set(Object.values(S.tasks).filter((t) => t.done && t.done_at).map(doneKey));
  let k = todayKey(), n = 0;
  if (!days.has(k)) k = addDays(k, -1);
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}
// Completion day is judged in America/New_York (the app's home zone, same as the server).
const nyDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const nyToday = () => nyDayFmt.format(new Date());
const doneDayNY = (t) => (t.done_at ? nyDayFmt.format(new Date(t.done_at)) : '');
const doneToday = (t) => t.done && doneDayNY(t) >= nyToday();
// Active tasks of a topic list: open tasks first (high priority, then manual order), then today's completed tasks,
// crossed out at the bottom. Completed tasks stay until the NY day they were done is over, then move to the archive.
function activeList(key) {
  const all = Object.values(S.tasks).filter((t) => listOf(t) === key && (!t.done || doneToday(t)));
  const open = all.filter((t) => !t.done).sort((a, b) => ((isHigh(b) ? 1 : 0) - (isHigh(a) ? 1 : 0)) || a.position - b.position);
  const done = all.filter((t) => t.done).sort((a, b) => (a.done_at || '').localeCompare(b.done_at || ''));
  return open.concat(done);
}
// Archive of a topic list: tasks completed before today (NY), newest first. Nothing is ever auto-deleted.
const archiveOf = (key) => Object.values(S.tasks).filter((t) => listOf(t) === key && t.done && !doneToday(t))
  .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '') || (b.updated_at || '').localeCompare(a.updated_at || ''));
// Today's progress (header ring): what's due today or earlier, plus everything finished today.
const todaySet = () => { const k = todayKey(); return Object.values(S.tasks).filter((t) => (t.done ? doneKey(t) === k : t.date && t.date <= k)); };
const archOpen = new Set();

/* ───────────── rendering ───────────── */
const board = $('#board');
const strip = $('#strip');
let builtFor = '';
let activeKey = '';   // set on first scroll pass so the strip chip lights up on load

const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="box" cx="12" cy="12" r="10"/><circle class="fill" cx="12" cy="12" r="10.8"/><path class="tick" d="M7 12.5l3.4 3.4L17 8.8"/></svg>';
const I_PEN = '<svg class="pen" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const I_GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>';
const I_BANG = '<svg viewBox="0 0 24 24"><path d="M12 4.5v10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="19.2" r="1.8" fill="currentColor"/></svg>';
const I_MOVE = '<svg viewBox="0 0 24 24"><path d="M4 12h14m-5-5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_TRASH = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-6 0l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// (Re)built whenever the set or order of lists changes; names/colors are painted by applyLists().
function buildBoard() {
  const sig = listIds().join('|');
  if (builtFor === sig) return;
  builtFor = sig;
  board.textContent = '';
  strip.textContent = '';
  $('#capLists').innerHTML = lists().map((c) => `<button type="button" class="cchip" role="radio" data-list="${c.id}"></button>`).join('');
  $('#menuLists').innerHTML = lists().map((c) => `<button role="menuitem" data-act="list:${c.id}"></button>`).join('');
  lists().forEach((c) => {
    const sec = document.createElement('section');
    sec.className = 'day list-col';
    sec.dataset.key = c.id;
    sec.innerHTML = `<header title="Drag to reorder lists"><h2><button type="button" class="list-name" title="Rename or recolor this list"><i class="ldot" aria-hidden="true"></i><span class="lname"></span>${I_PEN}</button></h2><span class="sub"></span></header>
      <div class="scroll">
        <form class="add qa" autocomplete="off"><span class="plus" aria-hidden="true">+</span><input type="text" enterkeyhint="enter" maxlength="500" placeholder="Add a task…" autocapitalize="sentences" autocomplete="off"><button type="button" class="qa-mic" title="Dictate a task">${I_MIC}</button></form>
        <ul class="list" role="list"></ul>
        <div class="arch" hidden>
          <button type="button" class="arch-btn" aria-expanded="false"></button>
          <ul class="arch-list" role="list" hidden></ul>
        </div>
      </div>`;
    board.appendChild(sec);
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.key = c.id;
    chip.innerHTML = `<span class="cname"></span><small></small>`;
    chip.addEventListener('click', () => scrollToKey(c.id));
    strip.appendChild(chip);
  });
  appliedLists = '';
  applyLists();
  observeActive();
}
// Paint list names/colors everywhere they appear (columns, chip strip, capture chips, task menu, settings).
let appliedLists = '';
function applyLists() {
  const ls = lists(), sig = JSON.stringify(ls);
  if (sig === appliedLists) return;
  appliedLists = sig;
  for (const c of ls) {
    const sec = board.querySelector(`.day[data-key="${c.id}"]`);
    if (sec) {
      sec.style.setProperty('--lc', c.color);
      sec.setAttribute('aria-label', c.name);
      $('.lname', sec).textContent = c.name;
      $('.list-name', sec).setAttribute('aria-label', `${c.name}. Edit list`);
      $('.add input', sec).setAttribute('aria-label', `Add a task to ${c.name}`);
      $('.qa-mic', sec).setAttribute('aria-label', `Dictate a task for ${c.name}`);
      $('.arch-list', sec).setAttribute('aria-label', `${c.name} archive`);
    }
    const chip = strip.querySelector(`.chip[data-key="${c.id}"]`);
    if (chip) { chip.style.setProperty('--lc', c.color); $('.cname', chip).textContent = listShort(c.id); }
    $$(`.cchip[data-list="${c.id}"]`).forEach((b) => { b.style.setProperty('--lc', c.color); b.textContent = c.name; });
    $$(`[data-act="list:${c.id}"]`).forEach((b) => { b.style.setProperty('--lc', c.color); b.textContent = c.name; });
  }
  renderListSettings();
}

const taskSig = (t, key) => [t.title, t.done, t.date, t.priority, todayKey()].join('\u0001');
function makeLi(t) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = t.id;
  li.innerHTML = `<div class="swipe-done">${I_OK}<span>Done</span></div>
    <div class="swipe-actions"><button class="act-star" aria-label="Toggle high priority">${I_BANG}<span>Priority</span></button><button class="act-move" aria-label="Move">${I_MOVE}<span>Move</span></button><button class="act-del" aria-label="Delete">${I_TRASH}<span>Delete</span></button></div>
    <div class="task-in">
      <button class="check" role="checkbox" aria-checked="false" aria-label="Complete task">${ICON_CHECK}</button>
      <div class="body"><span><span class="prio" role="img" aria-label="High priority" title="High priority">!</span><span class="title" tabindex="0" role="button" aria-label="Edit task"></span></span><span class="due" hidden></span></div>
      <button class="more" aria-haspopup="menu" aria-label="Move or delete task">${ICON_MORE}</button>
    </div>`;
  return li;
}
function updateLi(li, t, key) {
  const sig = taskSig(t, key);
  li.classList.toggle('done', t.done);
  li.classList.toggle('high', isHigh(t));
  $('.check', li).setAttribute('aria-checked', String(t.done));
  if (li.dataset.sig === sig) return;
  li.dataset.sig = sig;
  if (!li.classList.contains('editing')) $('.title', li).textContent = t.title;
  $('.act-star span', li).textContent = isHigh(t) ? 'Normal' : 'Priority';
  const due = $('.due', li), lbl = t.done ? '' : dueLabel(t.date);
  due.hidden = !lbl; due.textContent = lbl;
  due.classList.toggle('soon', !!t.date && t.date <= todayKey());
  due.classList.toggle('overdue', !!t.date && t.date < todayKey());
}

function render() {
  buildBoard();
  applyLists();
  document.body.classList.toggle('view-focus', S.view === 'focus');
  document.body.classList.toggle('view-overview', S.view !== 'focus');
  const today = todayKey();
  // FLIP: remember where rows were so reorders glide instead of jump
  const before = new Map($$('.task', board).map((li) => [li.dataset.id, { top: li.getBoundingClientRect().top, col: li.closest('.day')?.dataset.key }]));
  for (const sec of $$('.day', board)) {
    const key = sec.dataset.key;
    const list = activeList(key);
    const ul = $('.list', sec);
    const existing = new Map($$(':scope > .task', ul).map((li) => [li.dataset.id, li]));
    let prev = null;
    for (const t of list) {
      let li = existing.get(t.id);
      if (li) existing.delete(t.id); else li = makeLi(t);
      updateLi(li, t, key);
      const want = prev ? prev.nextSibling : ul.firstChild;
      if (li !== want && !li.classList.contains('dragging')) ul.insertBefore(li, want);
      prev = li.classList.contains('dragging') ? prev : li;
    }
    for (const li of existing.values()) {
      if (li.classList.contains('dragging')) continue;
      if (!reduceMotion.matches && S.tasks[li.dataset.id]?.done && !li.classList.contains('removing')) { li.classList.add('removing'); setTimeout(() => li.remove(), 260); }
      else if (!li.classList.contains('removing')) li.remove();
    }
    const open = list.filter((t) => !t.done).length;
    $('.sub', sec).textContent = open ? `${open} open` : '';
    const chip = $(`.chip[data-key="${key}"] small`, strip);
    if (chip) chip.textContent = open || '';
    renderArchive(sec, key);
  }
  const ts = todaySet(), totalN = ts.length, doneN = ts.filter((t) => t.done).length;
  if (!reduceMotion.matches) {
    for (const li of $$('.task', board)) {
      const b = before.get(li.dataset.id);
      if (!b || li.classList.contains('dragging') || li.closest('.day')?.dataset.key !== b.col) continue;
      const dy = b.top - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
  renderStats(doneN, totalN);
  renderSync();
  if (archDlg && archDlg.open) renderArchSheet();
}

const archDate = (t) => {
  if (!t.done_at) return '';
  const d = new Date(t.done_at), k = keyOf(d), today = todayKey();
  const day = k === today ? 'Today' : k === addDays(today, -1) ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(k.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
  return `${day} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};
function archItem(t, key) {
  const li = document.createElement('li');
  li.className = 'arch-item'; li.dataset.id = t.id;
  li.innerHTML = `<button class="check" role="checkbox" aria-checked="true">${ICON_CHECK}</button><div class="arch-body"><span class="title"></span><time></time></div>`;
  $('.check', li).setAttribute('aria-label', `Restore “${t.title}” to ${listName(key)}`);
  $('.title', li).textContent = t.title;
  $('time', li).textContent = archDate(t); if (t.done_at) $('time', li).dateTime = t.done_at;
  return li;
}
function renderArchive(sec, key) {
  const box = $('.arch', sec), btn = $('.arch-btn', box), ul = $('.arch-list', box);
  const done = archiveOf(key), open = !isMobile() && archOpen.has(key) && done.length > 0;   // phones use the archive sheet
  box.hidden = !done.length;
  btn.textContent = open ? `Hide archive (${done.length})` : `View archive (${done.length})`;
  btn.setAttribute('aria-expanded', String(open));
  ul.hidden = !open;
  if (!open) { if (ul.firstChild) ul.textContent = ''; return; }
  const sig = done.map((t) => t.id + t.done_at + t.title).join('|');
  if (ul.dataset.sig === sig) return;
  ul.dataset.sig = sig;
  ul.textContent = '';
  for (const t of done) ul.appendChild(archItem(t, key));
}
// Phones: a list's archive opens as a bottom sheet instead of expanding inside the list.
const archDlg = $('#archSheet');
let archKey = null;
function openArchiveSheet(key) { archKey = key; $('#asList').dataset.sig = ''; renderArchSheet(); archDlg.showModal(); buzz(6); }
function renderArchSheet() {
  if (!archKey) return;
  const key = listIds().includes(archKey) ? archKey : 'personal', done = archiveOf(key), ul = $('#asList');
  archDlg.style.setProperty('--lc', listColor(key));
  $('#asName').textContent = `${listName(key)} archive`;
  $('#asSub').textContent = done.length ? `${done.length} finished task${done.length === 1 ? '' : 's'}, newest first` : '';
  const sig = key + '#' + done.map((t) => t.id + t.done_at + t.title).join('|');
  if (ul.dataset.sig === sig) return;
  ul.dataset.sig = sig;
  ul.textContent = '';
  if (!done.length) { const li = document.createElement('li'); li.className = 'arch-item as-empty'; li.textContent = 'Nothing in the archive.'; ul.appendChild(li); return; }
  for (const t of done) ul.appendChild(archItem(t, key));
}
archDlg.addEventListener('click', (e) => {
  const ai = e.target.closest('.arch-item');
  if (ai && ai.dataset.id && e.target.closest('.check') && !ai.classList.contains('leaving')) {
    restoreTask(ai.dataset.id, ai);
    if (archiveOf(archKey).length <= 1) setTimeout(() => closeSheet(archDlg), 700);
  }
});
archDlg.addEventListener('close', () => { archKey = null; });
function restoreTask(id, li) {
  const t = S.tasks[id];
  if (!t || !t.done) return;
  const prev = t.done_at;
  const go = () => {
    toggle(id, null, { quiet: true });   // same path as unchecking on the board: optimistic put + sync queue
    buzz(8);
    toast(`Restored to ${listName(listOf(t))}`, { action: 'Undo', onAction: () => { const cur = S.tasks[id]; if (cur) put({ ...cur, done: true, done_at: prev }); }, ms: 4000 });
  };
  if (li && !reduceMotion.matches) { li.classList.add('leaving'); setTimeout(go, 260); } else go();
}

let lastAllDone = null;
function renderStats(done, total) {
  const full = total > 0 && done === total;
  $('#ringNum').textContent = `${done}/${total}`;
  $('#ringFg').style.strokeDashoffset = total ? 100 - (done / total) * 100 : 100;
  $('#ringWrap').classList.toggle('full', full);
  $('#ringCap').textContent = !total ? 'free day' : full ? 'all done' : 'done';
  const hero = $('.hero');
  if (hero) {
    $('.hero-num', hero).textContent = `${done}/${total}`;
    $('.hero-ring .fg', hero).style.strokeDashoffset = total ? 100 - (done / total) * 100 : 100;
    $('.hero-ring', hero).classList.toggle('full', full);
    const left = total - done;
    $('.hero-cap', hero).textContent = !total ? 'Nothing on your plate. Tap + to add something.' : full ? 'You cleared today. Go enjoy it.' : `${left} left today${done ? ' · nice momentum' : ''}`;
  }
  const n = streak();
  const el = $('#streak');
  const prev = +$('#streakNum').textContent;
  $('#streakNum').textContent = n;
  el.classList.toggle('on', n > 0);
  el.title = n ? `${n}-day streak` : 'Complete a task to start a streak';
  if ((n > prev && prev !== 0) || (n === 1 && prev === 0 && lastAllDone !== null)) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  lastAllDone = full;
}

/* ───────────── completion ───────────── */
function toggle(id, origin, { quiet = false, undoable = true } = {}) {
  const t = S.tasks[id];
  if (!t) return;
  const wasFull = isTodayFull();
  const done = !t.done;
  put({ ...t, done, done_at: done ? nowIso() : null });
  if (!done) return;
  if (quiet) return;
  const li = $(`.task[data-id="${id}"]`);
  if (li) { li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop'); }
  const box = origin || (li && $('.check', li));
  const r = box && box.getBoundingClientRect();
  burst(r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2);
  sfx.pop(S.muted);
  buzz(12);
  if (!wasFull && isTodayFull()) setTimeout(allDone, 250);
  else if (undoable) toast('Completed', { action: 'Undo', onAction: () => toggle(id, null, { quiet: true }), ms: 3200 });
}
const isTodayFull = () => { const l = todaySet(); return l.length > 0 && l.every((t) => t.done); };
function allDone() {
  celebrate();
  sfx.fanfare(S.muted);
  buzz([15, 40, 15, 40, 30]);
  const msgs = ['Clear day. Nicely done.', 'All done for today. Go enjoy it.', 'Zero left. Beautiful.', 'That’s everything. Well played.'];
  toast(msgs[Math.floor(Math.random() * msgs.length)], { big: true, ms: 4200 });
}
function togglePin(id) {   // high-priority toggle (no cap)
  const t = S.tasks[id]; if (!t) return;
  const high = !isHigh(t);
  put({ ...t, priority: high ? 'high' : 'normal', pinned: high });
  buzz(8);
  toast(high ? 'High priority' : 'Normal priority', { ms: 1100 });
}

/* ───────────── toast ───────────── */
let toastTimer;
function toast(msg, { action, onAction, ms = 4000, big = false } = {}) {
  const el = $('#toast');
  el.className = 'toast' + (big ? ' big' : '');
  el.textContent = msg;
  if (action) { const b = document.createElement('button'); b.textContent = action; b.onclick = () => { onAction(); el.classList.remove('show'); }; el.appendChild(b); }
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ───────────── editing ───────────── */
function startEdit(li) {
  const id = li.dataset.id, t = S.tasks[id];
  if (!t || li.classList.contains('editing')) return;
  li.classList.add('editing');
  const span = $('.title', li);
  const inp = document.createElement('input');
  inp.className = 'edit'; inp.value = t.title; inp.maxLength = 500; inp.setAttribute('aria-label', 'Edit task');
  span.hidden = true;
  span.after(inp);
  inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  let finished = false;
  const finish = (save) => {
    if (finished) return; finished = true;
    const v = inp.value.trim();
    inp.remove(); span.hidden = false; li.classList.remove('editing');
    if (save && v && v !== t.title) put({ ...S.tasks[id], title: v });
    else span.textContent = S.tasks[id] ? S.tasks[id].title : '';
    if (li.isConnected) span.focus({ preventScroll: true });
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}

/* ───────────── move / delete menu ───────────── */
const menu = $('#menu'), menuBack = $('#menuBackdrop');
let menuId = null, menuReturn = null;
function openMenu(id, anchor) {
  menuId = id; menuReturn = anchor;
  const t0 = S.tasks[id];
  $$('[data-act^="list:"]', menu).forEach((b) => { b.hidden = !!t0 && b.dataset.act === 'list:' + listOf(t0); });
  menu.hidden = false; menuBack.hidden = false;
  if (!isMobile()) {
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 220, r.right - 210)) + 'px';
    const below = r.bottom + 8, h = menu.offsetHeight;
    menu.style.top = (below + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : below) + 'px';
  }
  const t = S.tasks[id];
  $('#menuDate').value = t && t.date || '';
  $('#menuPin').textContent = t && isHigh(t) ? 'Remove high priority' : 'Mark high priority';
  $('button', menu).focus();
}
function closeMenu(refocus = true) {
  if (menu.hidden) return;
  menu.hidden = true; menuBack.hidden = true;
  if (refocus && menuReturn && menuReturn.isConnected) menuReturn.focus();
  menuId = null;
}
function moveTo(id, date) {
  const t = S.tasks[id];
  if (t) put({ ...t, date, ...(date !== t.date ? { planned_date: date, original_date: null } : {}), position: Date.now() });
}
function moveToList(id, list) {
  const t = S.tasks[id];
  if (!t || listOf(t) === list) return;
  put({ ...t, list, position: Date.now() });
  toast('Moved to ' + listName(list), { action: 'Undo', onAction: () => { const cur = S.tasks[id]; if (cur) put({ ...cur, list: listOf(t), position: t.position }); }, ms: 3200 });
}
function deleteWithUndo(id) {
  const li = $(`.task[data-id="${id}"]`);
  const next = li && (li.nextElementSibling || li.previousElementSibling);
  const t = removeTask(id);
  if (!t) return;
  buzz(10);
  toast('Task deleted', { action: 'Undo', onAction: () => put(t), ms: 5000 });
  if (next && next.isConnected && !isMobile()) $('.title', next).focus({ preventScroll: true });
}
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !menuId) return;
  const id = menuId; closeMenu(false); closeSwipe();
  const a = b.dataset.act;
  if (a === 'today') moveTo(id, todayKey());
  else if (a === 'tomorrow') moveTo(id, addDays(todayKey(), 1));
  else if (a === 'someday') moveTo(id, null);
  else if (a.startsWith('list:')) moveToList(id, a.slice(5));
  else if (a === 'pin') togglePin(id);
  else if (a === 'delete') deleteWithUndo(id);
});
$('#menuDate').addEventListener('change', (e) => { if (menuId && e.target.value) { const id = menuId; closeMenu(false); closeSwipe(); moveTo(id, e.target.value); toast('Due ' + whenLabel(e.target.value)); } });
menuBack.addEventListener('click', () => closeMenu());
menu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = $$('button', menu), i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});

/* ───────────── board events ───────────── */
board.addEventListener('click', (e) => {
  if (drag.moved) return;
  const ab = e.target.closest('.arch-btn');
  if (ab && isMobile()) { openArchiveSheet(ab.closest('.day').dataset.key); return; }
  if (ab) { const key = ab.closest('.day').dataset.key; archOpen.has(key) ? archOpen.delete(key) : archOpen.add(key); render(); if (archOpen.has(key)) ab.nextElementSibling.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
  const ai = e.target.closest('.arch-item');
  if (ai) { if (e.target.closest('.check') && !ai.classList.contains('leaving')) restoreTask(ai.dataset.id, ai); return; }
  const li = e.target.closest('.task');
  if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest('.check')) return toggle(id, $('.check', li));
  if (e.target.closest('.more')) return openMenu(id, $('.more', li));
  if (e.target.closest('.act-star')) { closeSwipe(); return togglePin(id); }
  if (e.target.closest('.act-move')) return openMenu(id, e.target.closest('.act-move'));
  if (e.target.closest('.act-del')) { closeSwipe(); return deleteWithUndo(id); }
  if (li.classList.contains('open')) return closeSwipe();
  if (e.target.closest('.title')) startEdit(li);
});
board.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('.add'); if (!form) return;
  const inp = $('input', form), list = form.closest('.day').dataset.key;
  if (!inp.value.trim()) { inp.value = ''; inp.blur(); return; }   // return on an empty row puts the keyboard away
  const b0 = bang(inp.value), p = parseWhen(b0.title, new Date()), b1 = bang(p.date !== undefined ? p.title : b0.title);
  if (addTask(b1.title, p.date !== undefined ? p.date : null, list, b0.high || b1.high)) { inp.value = ''; buzz(8); }
  inp.focus({ preventScroll: true });   // same input keeps focus, so the keyboard stays up for the next task
  requestAnimationFrame(() => revealAdd(form));
});
board.addEventListener('keydown', (e) => {
  const li = e.target.closest('.task');
  if (!li || e.target.matches('input')) return;
  const id = li.dataset.id;
  const list = $$('.task', li.parentElement);
  const i = list.indexOf(li);
  const focusTitle = (el) => el && $('.title', el).focus();
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const up = e.key === 'ArrowUp';
    if (up ? !list[i - 1] : !list[i + 1]) return;
    const pos = (n) => (list[n] ? S.tasks[list[n].dataset.id].position : null);
    const lo = up ? pos(i - 2) : pos(i + 1), hi = up ? pos(i - 1) : pos(i + 2);
    put({ ...S.tasks[id], position: lo == null ? hi - 1000 : hi == null ? lo + 1000 : (lo + hi) / 2 });
    requestAnimationFrame(() => focusTitle($(`.task[data-id="${id}"]`)));
  } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const ids = listIds(), t = S.tasks[id], cur = ids.indexOf(listOf(t));
    const nxt = ids[Math.max(0, Math.min(ids.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (nxt !== listOf(t)) { moveToList(id, nxt); requestAnimationFrame(() => focusTitle($(`.task[data-id="${id}"]`))); }
  } else if (e.key === 'ArrowDown') { e.preventDefault(); focusTitle(list[i + 1]); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusTitle(list[i - 1]); }
  else if (e.target.matches('.title') && (e.key === 'Enter' || e.key === 'e')) { e.preventDefault(); startEdit(li); }
  else if (e.key === ' ' || e.key === 'x') { e.preventDefault(); toggle(id, $('.check', li)); }
  else if (e.key === '!') { e.preventDefault(); togglePin(id); requestAnimationFrame(() => focusTitle($(`.task[data-id="${id}"]`))); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteWithUndo(id); }
});

/* ───────────── pointer gestures: drag-reorder (mouse / long-press) + swipe actions (touch) ───────────── */
const touchSort = { on: false, timer: 0 };   // long-press list reordering on touch (see "v10" below)
const drag = { li: null, ghost: null, moved: false, startX: 0, startY: 0, timer: 0, pid: null, dx: 0, dy: 0, touch: false, raf: 0, lastX: 0, lastY: 0, chipTimer: 0, swipe: false, base: 0, crossed: 0 };
const ACT_W = 204;
let openLi = null;
function closeSwipe(except) {
  if (openLi && openLi !== except) { $('.task-in', openLi).style.transform = ''; openLi.classList.remove('open'); }
  if (!except) openLi = null;
}
board.addEventListener('pointerdown', (e) => {
  const li = e.target.closest('.task');
  if (openLi && (!li || li !== openLi)) closeSwipe();
  if (!li || e.target.closest('.check,input,.swipe-actions') || (e.pointerType === 'mouse' && e.button !== 0) || li.classList.contains('editing')) return;
  Object.assign(drag, { li, moved: false, swipe: false, crossed: 0, startX: e.clientX, startY: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', lastX: e.clientX, lastY: e.clientY, base: li.classList.contains('open') ? -ACT_W : 0 });
  if (drag.touch) drag.timer = setTimeout(() => { if (!drag.swipe) beginDrag(e); }, 380);
});
addEventListener('pointermove', (e) => {
  if (!drag.li || e.pointerId !== drag.pid) return;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
  if (drag.ghost) { e.preventDefault(); dragMove(); return; }
  if (drag.swipe) { swipeMove(dx); return; }
  if (drag.touch) {
    if (Math.hypot(dx, dy) > 9) {
      if (Math.abs(dx) > Math.abs(dy) * 1.3) { clearTimeout(drag.timer); drag.timer = 0; drag.swipe = true; drag.moved = true; drag.li.classList.add('swiping'); swipeMove(dx); }
      else cancelPending();
    }
  } else if (Math.hypot(dx, dy) > 5) beginDrag(e);
});
addEventListener('pointerup', (e) => { if (e.pointerId === drag.pid) { drag.swipe ? endSwipe(e.clientX - drag.startX) : endDrag(); } });
addEventListener('pointercancel', (e) => { if (e.pointerId === drag.pid) { drag.swipe ? endSwipe(0, true) : endDrag(); } });
addEventListener('touchmove', (e) => { if (drag.ghost || drag.swipe || touchSort.on) e.preventDefault(); }, { passive: false });
addEventListener('contextmenu', (e) => { if (drag.ghost || drag.timer || touchSort.timer || touchSort.on) e.preventDefault(); });
function cancelPending() { clearTimeout(drag.timer); drag.timer = 0; drag.li = null; drag.pid = null; }

function swipeMove(dx) {
  const li = drag.li; if (!li) return;
  const x = Math.max(-ACT_W - 24, Math.min(window.innerWidth * 0.7, drag.base + dx));
  $('.task-in', li).style.transform = `translateX(${x}px)`;
  li.classList.toggle('swipe-r', x > 8);
  const mark = x > 96 ? 1 : x < -ACT_W * 0.45 ? -1 : 0;
  if (mark !== drag.crossed) { drag.crossed = mark; if (mark) buzz(8); }
}
function endSwipe(dx, cancelled) {
  const li = drag.li; if (!li) return;
  const inner = $('.task-in', li);
  const x = drag.base + dx;
  li.classList.remove('swiping');
  inner.style.transform = '';
  li.classList.remove('swipe-r');
  const id = li.dataset.id;
  if (!cancelled && x > 96) {
    openLi = null; li.classList.remove('open');
    toggle(id, $('.check', li));
  } else if (!cancelled && x < -ACT_W * 0.45) {
    li.classList.add('open'); inner.style.transform = `translateX(${-ACT_W}px)`; openLi = li; buzz(6);
  } else { li.classList.remove('open'); if (openLi === li) openLi = null; }
  Object.assign(drag, { li: null, pid: null, swipe: false });
  setTimeout(() => (drag.moved = false), 60);
}
function beginDrag(e) {
  clearTimeout(drag.timer); drag.timer = 0;
  const li = drag.li; if (!li) return;
  closeSwipe();
  const r = li.getBoundingClientRect();
  const g = li.cloneNode(true);
  g.className = 'task drag-ghost';
  g.style.width = r.width + 'px';
  drag.dx = drag.startX - r.left; drag.dy = drag.startY - r.top;
  document.body.appendChild(g);
  drag.ghost = g; drag.moved = true;
  li.classList.add('dragging');
  board.classList.add('dragging-active');
  buzz(10);
  getSelection && getSelection().removeAllRanges();
  dragMove();
  drag.raf = requestAnimationFrame(autoScroll);
}
function dragMove() {
  const { lastX: x, lastY: y, ghost, li } = drag;
  ghost.style.transform = `translate(${x - drag.dx}px,${y - drag.dy}px) rotate(1.2deg) scale(1.03)`;
  const el = document.elementFromPoint(x, y);
  const chip = el && el.closest('.chip');
  $$('.chip.drop').forEach((c) => c.classList.remove('drop'));
  if (chip) {
    chip.classList.add('drop');
    if (!drag.chipTimer) drag.chipTimer = setTimeout(() => { drag.chipTimer = 0; scrollToKey(chip.dataset.key); }, 350);
    return;
  } else if (drag.chipTimer) { clearTimeout(drag.chipTimer); drag.chipTimer = 0; }
  const sec = el && el.closest('.day');
  $$('.day.over').forEach((s) => s.classList.toggle('over', s === sec));
  if (!sec) return;
  sec.classList.add('over');
  const ul = $('.list', sec);
  const items = $$(':scope > .task:not(.dragging)', ul);
  let before = null;
  for (const it of items) { const r = it.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = it; break; } }
  if (li.parentElement !== ul || (before ? li.nextElementSibling !== before : li.nextElementSibling)) ul.insertBefore(li, before);
}
function autoScroll() {
  if (!drag.ghost) return;
  const { lastX: x, lastY: y } = drag, edge = 56;
  if (!document.body.classList.contains('view-overview') || !isMobile()) { if (x < edge) board.scrollLeft -= 14; else if (x > innerWidth - edge) board.scrollLeft += 14; }
  if (isMobile() && document.body.classList.contains('view-overview')) { if (y < 140) board.scrollTop -= 12; else if (y > innerHeight - 120) board.scrollTop += 12; }
  const sec = document.elementFromPoint(x, y)?.closest('.day');
  if (sec) { const ul = $('.scroll', sec), r = ul.getBoundingClientRect(); if (y < r.top + 40) ul.scrollTop -= 10; else if (y > r.bottom - 40) ul.scrollTop += 10; }
  dragMove();
  drag.raf = requestAnimationFrame(autoScroll);
}
function endDrag() {
  clearTimeout(drag.timer); clearTimeout(drag.chipTimer); drag.chipTimer = 0; drag.timer = 0;
  cancelAnimationFrame(drag.raf);
  const { li, ghost } = drag;
  if (ghost && li) {
    const sec = li.closest('.day');
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    const t = S.tasks[li.dataset.id];
    ghost.remove();
    li.classList.remove('dragging');
    if (t && sec) {
      const pp = prev ? S.tasks[prev.dataset.id].position : null, np = next ? S.tasks[next.dataset.id].position : null;
      const pos = pp == null && np == null ? Date.now() : pp == null ? np - 1000 : np == null ? Math.max(pp + 1000, Date.now()) : (pp + np) / 2;
      put({ ...t, list: sec.dataset.key, position: pos });
    }
  }
  $$('.day.over').forEach((s) => s.classList.remove('over'));
  $$('.chip.drop').forEach((s) => s.classList.remove('drop'));
  board.classList.remove('dragging-active');
  Object.assign(drag, { li: null, ghost: null, pid: null });
  setTimeout(() => (drag.moved = false), 0);
  render();
}

/* ───────────── navigation ───────────── */
function scrollToKey(key, focus) {
  const sec = $(`.day[data-key="${key}"]`, board);
  if (!sec) return;
  if (isMobile() && S.view !== 'focus') sec.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  else board.scrollTo({ left: sec.offsetLeft - (isMobile() ? 0 : 28), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  setActive(key);
}
function setActive(key) {
  activeKey = key;
  $$('.chip', strip).forEach((c) => {
    const on = c.dataset.key === key;
    c.classList.toggle('active', on);
    if (on) c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
}
let scrollRaf = 0, bound = false;
function observeActive() { if (!bound) { board.addEventListener('scroll', onScroll, { passive: true }); bound = true; } onScroll(); }
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (isMobile() && S.view !== 'focus') return;
    const secs = $$('.day', board);
    const left = board.scrollLeft + 24;
    let best = secs[0];
    for (const s of secs) if (s.offsetLeft - 16 <= left + board.clientWidth * 0.3) best = s;
    if (best && (best.dataset.key !== activeKey || !strip.querySelector('.chip.active'))) setActive(best.dataset.key);   // also after the strip is rebuilt
  });
}

/* ───────────── inline quick-add (one row at the top of every list, under the header) ───────────── */
function quickAdd(key, prefill = '') {
  const sec = $(`.day[data-key="${key}"]`, board) || $('.day', board);
  if (!sec) return;
  const inp = $('.add input', sec);
  if (prefill) inp.value = prefill;
  if (S.view === 'focus' || !isMobile()) scrollToKey(sec.dataset.key);
  inp.focus({ preventScroll: true });
  revealAdd(inp.closest('.add'));
  if (prefill) inp.setSelectionRange(inp.value.length, inp.value.length);
}
function paintQaFocus() {
  $$('.day.qa-focus', board).forEach((s) => s.classList.remove('qa-focus'));
  if (isMobile()) return;
  const a = document.activeElement;
  if (!a || !a.matches || !a.matches('.add.qa input')) return;
  const sec = a.closest('.day');
  if (sec) sec.classList.add('qa-focus');
}
function moveQaFocus(delta) {
  if (isMobile()) return false;
  const a = document.activeElement;
  if (!a || !a.matches || !a.matches('.add.qa input')) return false;
  const secs = $$('.day', board);
  const cur = a.closest('.day');
  const i = secs.indexOf(cur);
  if (i < 0) return false;
  const next = secs[Math.max(0, Math.min(secs.length - 1, i + delta))];
  if (!next || next === cur) return true;
  const val = a.value;
  const inp = $('.add input', next);
  inp.value = val;
  a.value = '';
  quickAdd(next.dataset.key);
  return true;
}
board.addEventListener('click', (e) => {
  const mic = e.target.closest('.qa-mic'); if (!mic) return;
  e.preventDefault();
  openCapture({ list: mic.closest('.day').dataset.key, mic: true });
});
board.addEventListener('focusin', (e) => {
  const sec = e.target.closest('.day');
  if (sec && sec.dataset.key !== activeKey) setActive(sec.dataset.key);
  paintQaFocus();
});
board.addEventListener('focusout', () => requestAnimationFrame(paintQaFocus));

/* ───────────── capture sheet ───────────── */
const cap = { open: false, chip: 'none', custom: '', list: 'personal' };
const capEl = $('#capture'), cIn = $('#cInput'), cWhen = $('#cWhen'), cHint = $('#cHint'), cLog = $('#cLog'), cPrev = $('#cPreview');
const chipDate = () => (cap.chip === 'today' ? todayKey() : cap.chip === 'tomorrow' ? addDays(todayKey(), 1) : cap.chip === 'date' ? cap.custom : null);
function setList(v) {
  cap.list = listIds().includes(v) ? v : 'personal';
  $$('#capLists .cchip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.list === cap.list)));
  updateWhen();
}
const capLabel = (date) => listShort(cap.list) + (date ? ' · due ' + whenLabel(date) : '');
function setChip(v) {
  cap.chip = v;
  $$('#capChips .cchip[data-v]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.v === v)));
  $('#cDateChip').setAttribute('aria-checked', String(v === 'date'));
  $('#cDateLbl').textContent = v === 'date' ? whenLabel(cap.custom) : 'Date';
  updateWhen();
}
function updateWhen() {
  const b0 = bang(cIn.value), p = parseWhen(b0.title, new Date()), high = b0.high || bang(p.title).high;
  cWhen.textContent = cIn.value.trim() ? `→ ${high ? '! High priority · ' : ''}${listName(cap.list)}${(p.date !== undefined ? p.date : chipDate()) ? ' · due ' + whenLabel(p.date !== undefined ? p.date : chipDate()) : ''}` : '';
}
function positionSheet() {
  const vv = window.visualViewport;
  if (!vv || !cap.open) { capEl.style.bottom = ''; return; }
  if (isMobile()) capEl.style.bottom = Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px';
}
window.visualViewport && ['resize', 'scroll'].forEach((ev) => visualViewport.addEventListener(ev, positionSheet));
// The capture sheet is now only the voice UI (opened by a list's quick-add mic); typing happens in the inline rows.
function openCapture({ prefill = '', voice = true, list = null, mic = false } = {}) {
  if (cap.open) { cIn.focus(); return; }
  cap.open = true;
  closeMenu(false); closeSwipe();
  capEl.removeAttribute('inert');
  capEl.classList.add('open');
  document.body.classList.add('capturing');
  cIn.value = prefill;
  cPrev.hidden = true; cLog.textContent = ''; setVoice('idle', '');
  setChip('none');
  setList(list || (listIds().includes(activeKey) ? activeKey : 'personal'));
  if (!mic) cIn.focus({ preventScroll: true });          // inside the user gesture so iOS raises the keyboard
  positionSheet();
  buzz(8);
  if (mic) startVoice();
  else if (voice && S.voiceFirst && !prefill) startVoice({ auto: true });
}
function closeCapture() {
  if (!cap.open) return;
  cap.open = false;
  stopVoice({ cancel: true });
  capEl.classList.remove('open', 'dragging');
  capEl.style.transform = '';
  capEl.style.bottom = '';
  capEl.setAttribute('inert', '');
  document.body.classList.remove('capturing');
  cIn.blur();
}
function logAdded(title, date) {
  const li = document.createElement('li');
  li.innerHTML = `${I_OK}<span></span><em></em>`;
  $('span', li).textContent = title; $('em', li).textContent = capLabel(date);
  cLog.prepend(li);
  [...cLog.children].forEach((c, i) => { c.classList.toggle('old', i > 0); if (i > 2) c.remove(); });
  capEl.classList.remove('pulse'); void capEl.offsetWidth; capEl.classList.add('pulse');
}
function addFromText(text, { keepFocus = true } = {}) {
  const b0 = bang(text), p = parseWhen(b0.title, new Date()), b1 = bang(p.title);
  const title = b1.title.trim(), high = b0.high || b1.high;
  if (!title) return false;
  const date = p.date !== undefined ? p.date : chipDate();
  addTask(title, date, cap.list, high);
  logAdded(title, date);
  buzz(12);
  sfx.pop(S.muted);
  if (keepFocus) cIn.focus({ preventScroll: true });
  return { title, date };
}
cIn.addEventListener('input', () => { if (voiceState === 'error') setVoice('idle', ''); updateWhen(); });
cIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (addFromText(cIn.value)) { cIn.value = ''; updateWhen(); } }
  else if (e.key === 'Escape') { e.stopPropagation(); closeCapture(); }
});
$('#capForm').addEventListener('submit', (e) => e.preventDefault());
$('#capLists').addEventListener('click', (e) => { const b = e.target.closest('.cchip[data-list]'); if (b) { setList(b.dataset.list); cIn.focus({ preventScroll: true }); buzz(5); } });
$('#capChips').addEventListener('click', (e) => { const b = e.target.closest('.cchip[data-v]'); if (b) { setChip(b.dataset.v); cIn.focus({ preventScroll: true }); buzz(5); } });
$('#cDate').addEventListener('change', (e) => { if (e.target.value) { cap.custom = e.target.value; setChip('date'); cIn.focus({ preventScroll: true }); } });
$('#capBackdrop').addEventListener('click', closeCapture);
capEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCapture(); });

// swipe the sheet down to dismiss
{
  let y0 = null, dy = 0;
  capEl.addEventListener('touchstart', (e) => { if (e.target.closest('input,.chips-row,.cap-preview button,.mic')) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  capEl.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    capEl.classList.add('dragging'); capEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  capEl.addEventListener('touchend', () => {
    if (y0 == null) return;
    capEl.classList.remove('dragging'); capEl.style.transform = '';
    if (dy > 70) closeCapture();
    y0 = null;
  });
}

/* ── voice: record in-app, transcribe with Groq (server) or Whisper on device ── */
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const cRec = $('#cRec'), cWave = $('#cWave'), cTime = $('#cTime'), cProg = $('#cProg'), cProgBar = $('#cProgBar'), vRetry = $('#vRetry');
let session = null, lastBlob = null, voiceState = 'idle', levels = [];
function setVoice(state, msg, { retry = false } = {}) {
  voiceState = state;
  capEl.dataset.voice = state;
  capEl.classList.toggle('listening', state === 'recording');
  $('#micBtn').setAttribute('aria-pressed', String(state === 'recording'));
  $('#micBtn').setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Dictate a task');
  cRec.hidden = state !== 'recording';
  cProg.hidden = state !== 'downloading';
  cHint.hidden = !msg;
  cHint.textContent = msg || '';
  vRetry.hidden = !retry;
  cHint.classList.toggle('err', state === 'error');
}
function drawWave(level) {
  levels.push(Math.min(1, level * 5)); if (levels.length > 56) levels.shift();
  const c = cWave, g = c.getContext('2d'), w = c.width, h = c.height, n = 56, bw = w / n;
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(capEl).getPropertyValue('--red') || '#e5484d';
  levels.forEach((v, k) => { const bh = Math.max(4, v * h); g.beginPath(); g.roundRect((n - levels.length + k) * bw + 1.5, (h - bh) / 2, bw - 3, bh, 3); g.fill(); });
}
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const micHelp = () => (isIOS ? 'Microphone is blocked. Open Settings → Done (or Safari) → Microphone and allow it, then tap the mic again.' : 'Microphone is blocked. Allow it from the lock icon in the address bar (or site settings), then tap the mic again.');
async function startVoice({ auto = false } = {}) {
  if (voiceState === 'recording') return stopVoice();
  if (voiceState === 'requesting' || voiceState === 'transcribing' || voiceState === 'downloading') return;
  if (!canRecord()) return voiceFallback('Recording isn’t supported here. Use your keyboard’s dictation key instead.');
  cPrev.hidden = true;
  setVoice('requesting', 'Allow microphone access…');
  try {
    levels = [];
    session = await record({ onLevel: drawWave, onTick: (ms) => { cTime.textContent = fmtTime(ms); } });
  } catch (e) {
    session = null;
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return setVoice('error', auto ? 'Tap the mic to start recording.' : micHelp(), { retry: false });
    if (e && e.name === 'NotFoundError') return setVoice('error', 'No microphone found.', { retry: false });
    return setVoice('error', 'Couldn’t start the microphone. ' + (e && e.message || ''), { retry: true });
  }
  setVoice('recording', session.hasAnalyser ? 'Listening… stops when you pause. Tap the mic to finish.' : 'Recording… tap the mic to finish.');
  buzz(10);
  const s = session;
  const res = await s.done;
  if (session === s) session = null; else return;       // cancelled (sheet closed)
  buzz(8);
  if (res.reason === 'nospeech' || res.blob.size < 1500) return setVoice('error', 'Didn’t hear anything. Tap the mic and try again.');
  await runTranscribe(res.blob);
}
async function runTranscribe(blob) {
  lastBlob = blob;
  setVoice('transcribing', 'Transcribing…');
  try {
    const { text } = await transcribe(blob, {
      onStage: (st, backend) => { if (st === 'transcribing') setVoice('transcribing', backend === 'groq' ? 'Transcribing…' : 'Transcribing on this device…'); if (st === 'downloading') { cProgBar.style.width = '0%'; setVoice('downloading', 'Downloading voice model (~40 MB, one time)…'); } },
      onProgress: (m) => { if (voiceState === 'downloading') { cProgBar.style.width = m.pct + '%'; cHint.textContent = `Downloading voice model (~40 MB, one time)… ${m.pct}%`; } },
    });
    lastBlob = null;
    if (!cap.open) return;
    if (!text) return setVoice('error', 'Didn’t catch that. Tap the mic and try again.');
    setVoice('idle', '');
    cIn.value = text; updateWhen();
    handleVoiceText(text);
  } catch (e) {
    setVoice('error', 'Transcription failed: ' + (e && e.message || 'unknown error'), { retry: !!lastBlob });
  }
}
function stopVoice({ cancel = false } = {}) {
  if (!session) { if (cancel) setVoice('idle', ''); return; }
  if (cancel) { const s = session; session = null; s.stop(); setVoice('idle', ''); } else session.stop();
}
function voiceFallback(msg) {
  setVoice('error', msg);
  cIn.focus({ preventScroll: true });
}
vRetry.addEventListener('click', () => { if (lastBlob) runTranscribe(lastBlob); else startVoice(); });
function splitVoice(t) { return t.split(/\s*\b(?:and then|also)\b\s*/i).map((s) => s.trim()).filter(Boolean); }
let pvParts = [];
function handleVoiceText(text) {
  const parts = splitVoice(text);
  if (parts.length > 1) {
    pvParts = parts;
    const ul = $('ul', cPrev); ul.textContent = '';
    parts.forEach((p) => { const li = document.createElement('li'); const w = parseWhen(bang(p).title, new Date()); li.textContent = (bang(p).high || bang(w.title).high ? '! ' : '') + bang(w.title).title; const s = document.createElement('small'); s.textContent = capLabel(w.date !== undefined ? w.date : chipDate()); li.append(s); ul.append(li); });
    $('#pvAdd').textContent = `Add ${parts.length} tasks`;
    cPrev.hidden = false;
  } else if (addFromText(text, { keepFocus: false })) {
    cIn.value = ''; updateWhen();
    toast('Added by voice', { action: 'Undo', onAction: undoLastAdd, ms: 3000 });
  }
}
function undoLastAdd() { const t = Object.values(S.tasks).filter((x) => x.source === 'app').sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]; if (t) removeTask(t.id); }
$('#pvAdd').addEventListener('click', () => { pvParts.forEach((p) => addFromText(p, { keepFocus: false })); cIn.value = ''; cPrev.hidden = true; updateWhen(); cIn.focus({ preventScroll: true }); });
$('#pvCancel').addEventListener('click', () => { cPrev.hidden = true; cIn.focus({ preventScroll: true }); });
$('#micBtn').addEventListener('click', () => startVoice());

/* ───────────── global gestures: pull to refresh ───────────── */
{
  let g = null;
  const ptr = $('#ptr');
  document.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length !== 1 || cap.open || drag.ghost || drag.swipe || touchSort.on || !isMobile()) return;
    const el = e.target;
    if (el.closest('dialog,.menu,.capture,input,.swipe-actions')) return;
    const t = e.touches[0];
    const list = el.closest('.scroll');
    g = { x: t.clientX, y: t.clientY, axis: null, down: (!list || list.scrollTop <= 0) && (board.scrollTop <= 0), pull: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!g || drag.ghost || drag.swipe || touchSort.on) { if (g && touchSort.on) { g = null; ptr.classList.remove('show'); } return; }
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.axis && Math.hypot(dx, dy) > 12) g.axis = Math.abs(dy) > Math.abs(dx) * 1.4 ? 'v' : 'h';
    if (g.axis !== 'v') return;
    if (dy > 10 && g.down) { g.pull = dy; ptr.textContent = dy > 80 ? 'Release to refresh' : 'Pull to refresh'; ptr.style.transform = `translate(-50%,${Math.min(dy, 110) - 70}px)`; ptr.classList.add('show'); }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (g && g.pull > 80) { buzz(8); ptr.textContent = 'Refreshing…'; sync().finally(() => setTimeout(() => ptr.classList.remove('show'), 500)); }
    else ptr.classList.remove('show');
    g = null;
  });
}

/* ───────────── keyboard ───────────── */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const inQa = !!(e.target.matches && e.target.matches('.add.qa input'));
  // Desktop: ↑/↓ in a quick-add row jump to the previous/next list's add box (typed text moves with you).
  if (inQa && !isMobile() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    moveQaFocus(e.key === 'ArrowUp' ? -1 : 1);
    return;
  }
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }
  if (document.querySelector('dialog[open]') || !menu.hidden || cap.open) return;
  const k = e.key;
  if (e.target.closest && e.target.closest('.task') && /^[xXeE !]$|^(Delete|Backspace|Arrow.*)$/.test(k)) return;
  if (k === '?') { $('#helpSheet').showModal(); return; }
  if (k === 'Escape') { closeSwipe(); return; }
  // Typing anywhere starts a task in the focused list's quick-add row (or the first list).
  // `/` always opens the first list's add box on desktop; `n` / letters keep the active list.
  const first = listIds()[0];
  const target = (document.activeElement && document.activeElement.closest && document.activeElement.closest('.day')?.dataset.key) || activeKey || first;
  if (k === '/') { e.preventDefault(); quickAdd(isMobile() ? target : first); return; }
  if (k === 'n' || k === 'N') { e.preventDefault(); quickAdd(target); return; }
  if (k.length === 1 && /\S/.test(k)) { e.preventDefault(); quickAdd(target, k); }
});

/* ───────────── insights ───────────── */
const insDlg = $('#insights');
let insData = null, insRange = 14;
try { insData = JSON.parse(localStorage.getItem('done:stats')); } catch {}
const pctTxt = (r) => (r === null || r === undefined ? '–' : Math.round(r * 100) + '%');
function renderInsights() {
  const d = insData, box = $('#insBody');
  if (!d) { box.innerHTML = '<p class="ins-empty">Loading…</p>'; return; }
  const card = (label, val, sub) => `<div class="ins-card"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const days = d.daily.slice(-insRange);
  const W = 300, H = 84, bw = W / days.length;
  const bars = days.map((x, i) => {
    const h = x.rate === null ? 3 : Math.max(3, x.rate * 64), c = x.rate === null ? 'none' : x.rate >= 0.8 ? 'good' : x.rate >= 0.5 ? 'mid' : 'low';
    return `<rect class="bar ${c}" x="${(i * bw + bw * 0.14).toFixed(1)}" y="${(70 - h).toFixed(1)}" width="${(bw * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${x.date}: ${x.rate === null ? 'nothing planned' : Math.round(x.rate * 100) + '% on time (' + x.on_time + '/' + x.planned + ')'}</title></rect>`;
  }).join('');
  const lbl = (i) => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="82" text-anchor="middle">${fromKey(days[i].date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</text>`;
  const wk = d.weekdays.map((w) => `<div class="wk"><span>${w.day}</span><i><u style="width:${w.rate === null ? 0 : Math.round(w.rate * 100)}%"></u></i><em>${pctTxt(w.rate)}</em></div>`).join('');
  box.innerHTML = `
    <div class="ins-hero"><div class="ins-ring" style="--p:${Math.round((d.today.completion || 0) * 100)}"><b>${pctTxt(d.today.completion)}</b></div><p><strong>${d.today.done}/${d.today.total}</strong> done today</p></div>
    <div class="ins-grid">
      ${card('On time · last 7 days', pctTxt(d.on_time.last7.rate), `${d.on_time.last7.on_time}/${d.on_time.last7.planned} same day`)}
      ${card('On time · last 30 days', pctTxt(d.on_time.last30.rate), `${d.on_time.last30.on_time}/${d.on_time.last30.planned} same day`)}
      ${card('Completion · overall', pctTxt(d.completion.rate), `${d.completion.done}/${d.completion.total} tasks`)}
      ${card('Streak', d.streak.current + ' 🔥', `best ${d.streak.best}`)}
      ${card('Avg rollovers / task', d.rollovers.average_per_task, `${d.rollovers.tasks_rolled_over} carried over`)}
    </div>
    <div class="ins-sec"><h3>Daily on-time</h3><div class="seg"><button data-r="14" class="${insRange === 14 ? 'on' : ''}">14 days</button><button data-r="30" class="${insRange === 30 ? 'on' : ''}">30 days</button></div></div>
    <svg class="ins-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily on-time percentage">${bars}<line x1="0" x2="${W}" y1="70.5" y2="70.5" class="base"/>${lbl(0)}${lbl(Math.floor(days.length / 2))}${lbl(days.length - 1)}</svg>
    <div class="ins-sec"><h3>By weekday</h3></div>
    <div class="wks">${wk}</div>
    <p class="fine">On time = finished on the day it was first planned. Rollovers don’t reset that, and deleted tasks aren’t counted.</p>`;
}
async function openInsights() {
  renderInsights();
  insDlg.showModal();
  try {
    if (S.queue.length) await sync();
    const r = await fetch('/api/stats', { cache: 'no-store' });
    if (r.ok) { insData = await r.json(); localStorage.setItem('done:stats', JSON.stringify(insData)); renderInsights(); }
    else if (!insData) $('#insBody').innerHTML = '<p class="ins-empty">Insights need server storage to be set up.</p>';
  } catch { if (!insData) $('#insBody').innerHTML = '<p class="ins-empty">You’re offline. Insights will load when you’re back.</p>'; }
}
$('#insightsBtn').addEventListener('click', openInsights);
$('#insBody').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { insRange = +b.dataset.r; renderInsights(); } });

/* ───────────── settings / view ───────────── */
const I_FOCUS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
const I_LIST = '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
function renderView() { $('#viewBtn').innerHTML = S.view === 'focus' ? I_LIST : I_FOCUS; $('#viewBtn').title = S.view === 'focus' ? 'Show all lists' : 'One list at a time'; $('#viewBtn').setAttribute('aria-label', $('#viewBtn').title); document.body.classList.toggle('view-focus', S.view === 'focus'); document.body.classList.toggle('view-overview', S.view !== 'focus'); }
$('#viewBtn').addEventListener('click', () => { S.view = S.view === 'focus' ? 'overview' : 'focus'; persist(); renderView(); render(); board.scrollTo({ left: 0, top: 0 }); setActive(listIds()[0]); toast(S.view === 'focus' ? 'One list at a time' : 'All lists', { ms: 1200 }); });
/* ───────────── lists: rename, recolor, add, delete, reorder ───────────── */
const PALETTE = ['#e5484d', '#f76b15', '#e2a50b', '#2fb36d', '#12a594', '#0b9fd8', '#2f6bff', '#5b5bd6', '#a855f7', '#e93d82', '#ad7f58', '#7d838d'];
const leDlg = $('#listEdit');
let leId = null, delArmed = false;
function queueList(op) {
  if (op.t === 'list') S.queue = S.queue.filter((q) => !(q.t === 'list' && q.id === op.id));
  if (op.t === 'order') S.queue = S.queue.filter((q) => q.t !== 'order');
  S.queue.push(op);
  persist(); render(); scheduleFlush();
}
// Settings → Edit lists: one row per list with a drag handle, up/down arrows, color dot (recolor), name (rename),
// delete (inline confirm; tasks move to Personal, never deleted) and an "+ Add list" row. Every change saves at once.
const I_HANDLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const I_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ed = { rename: null, color: null, del: null, adding: false, err: '' };
const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tasksIn = (id) => Object.values(S.tasks).filter((t) => listOf(t) === id).length;
function renderListSettings(force) {
  const box = $('#setLists'); if (!box || box.classList.contains('sorting')) return;
  if (!force && box.contains(document.activeElement) && document.activeElement.matches('input')) return;   // don't clobber typing
  const ls = lists(), last = ls.length - 1;
  box.innerHTML = ls.map((l, i) => {
    const n = escHtml(l.name), canDel = l.id !== 'personal' && ls.length > 1;
    const name = ed.rename === l.id
      ? `<input class="le-in" type="text" maxlength="40" enterkeyhint="done" value="${n}" aria-label="List name" autocomplete="off" autocapitalize="words">`
      : `<button type="button" class="le-nm" data-act="rename" aria-label="Rename ${n}" title="Rename"><span>${n}</span></button>`;
    let panel = '';
    if (ed.color === l.id) panel = `<div class="le-panel le-colors" role="radiogroup" aria-label="Color for ${n}">${PALETTE.map((c) => `<button type="button" class="swatch" role="radio" data-act="pick" data-c="${c}" style="--sw:${c}" aria-checked="${c === l.color.toLowerCase()}" aria-label="${c}"></button>`).join('')}<label class="le-pick" title="Custom color"><input type="color" class="le-custom-in" value="${l.color}" aria-label="Custom color"><span>Custom</span></label></div>`;
    else if (ed.del === l.id) { const k = tasksIn(l.id); panel = `<div class="le-panel le-confirm" role="alert"><p>Delete “${n}”? ${k ? `Its ${k} task${k === 1 ? '' : 's'} (open and archived) move${k === 1 ? 's' : ''} to ${escHtml(listName('personal'))}.` : 'It has no tasks.'} No tasks are deleted.</p><div class="row"><button type="button" class="ghost" data-act="del-cancel">Cancel</button><button type="button" class="primary danger-btn" data-act="del-yes">Delete list</button></div></div>`; }
    else if (ed.rename === l.id && ed.err) panel = `<p class="le-err" role="alert">${escHtml(ed.err)}</p>`;
    return `<div class="le-row${ed.color === l.id || ed.del === l.id ? ' expanded' : ''}" role="listitem" data-id="${l.id}" style="--lc:${l.color}">
      <div class="le-main">
        <button type="button" class="grip" aria-label="Reorder ${n}: drag, or use arrow keys" title="Drag to reorder">${I_HANDLE}</button>
        <button type="button" class="le-dot" data-act="color" aria-label="Change color of ${n}" aria-expanded="${ed.color === l.id}" title="Change color"><i class="ldot"></i></button>
        ${name}
        <button type="button" class="le-mv" data-act="up" aria-label="Move ${n} up" title="Move up" ${i === 0 ? 'disabled' : ''}>${I_UP}</button>
        <button type="button" class="le-mv" data-act="down" aria-label="Move ${n} down" title="Move down" ${i === last ? 'disabled' : ''}>${I_DOWN}</button>
        ${canDel ? `<button type="button" class="le-trash" data-act="delete" aria-label="Delete ${n}" title="Delete list">${I_TRASH}</button>` : `<span class="le-trash le-keep" title="${n} is where tasks of deleted lists go, so it can’t be deleted" aria-hidden="true"></span>`}
      </div>${panel}</div>`;
  }).join('') + (ed.adding
    ? `<div class="le-row le-new" role="listitem"><div class="le-main"><span class="grip" aria-hidden="true"></span><span class="le-dot"><i class="ldot" style="background:${nextColor()}"></i></span><input class="le-in le-add-in" type="text" maxlength="40" enterkeyhint="done" placeholder="New list name" aria-label="New list name" autocomplete="off" autocapitalize="words"><button type="button" class="primary le-add-go" data-act="add-go">Add</button><button type="button" class="le-mv" data-act="add-cancel" aria-label="Cancel" title="Cancel">✕</button></div>${ed.err ? `<p class="le-err" role="alert">${escHtml(ed.err)}</p>` : ''}</div>`
    : `<button type="button" class="le-add" data-act="add"><span aria-hidden="true">+</span> Add list</button>`);
  const inp = $('.le-in', box);
  if (inp && force) { inp.focus(); if (!inp.classList.contains('le-add-in')) inp.select(); }
}
const nextColor = () => PALETTE.find((c) => !lists().some((x) => x.color.toLowerCase() === c)) || PALETTE[1];
function nameError(name, id) {
  if (!name) return 'Give the list a name.';
  const clash = lists().find((l) => l.id !== id && (l.name.toLowerCase() === name.toLowerCase() || l.id === name.toLowerCase()));
  return clash ? `Another list is already called “${clash.name}”.` : '';
}
function renameList(id, name) {
  const prev = listCfg(id); if (!prev || prev.name === name) return;
  S.lists = lists().map((l) => (l.id === id ? { ...l, name } : l));
  queueList({ t: 'list', id, name, color: prev.color });   // PATCH /api/lists?id=…
  toast(`Renamed to “${name}”`, { ms: 1300 });
}
function recolorList(id, color) {
  const prev = listCfg(id); if (!prev || !HEX.test(color) || prev.color.toLowerCase() === color.toLowerCase()) return;
  S.lists = lists().map((l) => (l.id === id ? { ...l, color } : l));
  queueList({ t: 'list', id, name: prev.name, color });     // PATCH /api/lists?id=…
}
function addList(name, color) {
  const taken = new Set(listIds().concat(DEFAULT_LISTS.map((l) => l.id)));
  let id = slugify(name), k = 2; const base = id; while (taken.has(id)) id = `${base}-${k++}`;
  S.lists = lists().concat({ id, name, color, order: lists().length });
  queueList({ t: 'newlist', id, name, color });
  toast(`Added “${name}”`, { ms: 1400 });
  return id;
}
// Same behavior as v9: tasks (open and archived) move to Personal on the client and the server; nothing is deleted.
function deleteList(id) {
  if (!id || id === 'personal' || lists().length <= 1) return;
  const n = tasksIn(id), name = listName(id);
  for (const t of Object.values(S.tasks)) if (t.list === id) t.list = 'personal';
  S.lists = lists().filter((l) => l.id !== id);
  S.queue = S.queue.map((q) => (q.t === 'put' && q.task.list === id ? { ...q, task: { ...q.task, list: 'personal' } } : q)).filter((q) => !(q.t === 'list' && q.id === id));
  archOpen.delete(id);
  queueList({ t: 'dellist', id });
  toast(n ? `Deleted “${name}”. ${n} task${n === 1 ? '' : 's'} moved to ${listName('personal')}.` : `Deleted “${name}”`, { ms: 3000 });
}
function moveListBy(id, d) {
  const ids = listIds(), i = ids.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  ids.splice(i, 1); ids.splice(j, 0, id); saveOrder(ids); buzz(6);
  return true;
}
function leSetColor(c) {
  c = String(c || '').toLowerCase();
  $$('.swatch', leDlg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c === c)));
  if (HEX.test(c)) { $('#leHex').value = c; $('#leColor').value = c; leDlg.style.setProperty('--lc', c); }
}
function openListEdit(id) {   // id = null -> add a new list
  leId = id; delArmed = false;
  const l = id ? listCfg(id) : { name: '', color: PALETTE.find((c) => !lists().some((x) => x.color === c)) || PALETTE[1] };
  $('#leTitle').textContent = id ? 'Edit list' : 'Add list';
  $('#leSave').textContent = id ? 'Save' : 'Add list';
  $('#leName').value = l.name;
  $('#leErr').textContent = '';
  $('#leSwatches').innerHTML = PALETTE.map((c) => `<button type="button" class="swatch" role="radio" data-c="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join('');
  leSetColor(l.color);
  const del = $('#leDel');
  del.hidden = !id || id === 'personal' || lists().length <= 1;
  del.textContent = 'Delete list';
  del.classList.remove('armed');
  if (setDlg.open) setDlg.close();
  leDlg.showModal();
  if (!isMobile() || !id) setTimeout(() => (id ? $('#leName').select() : $('#leName').focus()), 30);
}
$('#leSwatches').addEventListener('click', (e) => { const b = e.target.closest('.swatch'); if (b) { leSetColor(b.dataset.c); buzz(8); } });
$('#leColor').addEventListener('input', (e) => leSetColor(e.target.value));
$('#leHex').addEventListener('input', (e) => { let v = e.target.value.trim(); if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v; if (HEX.test(v)) leSetColor(v); });
$('#leForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#leName').value.replace(/\s+/g, ' ').trim().slice(0, 40);
  let color = $('#leHex').value.trim().toLowerCase(); if (/^[0-9a-f]{6}$/.test(color)) color = '#' + color;
  const err = (m) => { $('#leErr').textContent = m; };
  if (!name) return err('Give the list a name.');
  if (!HEX.test(color)) return err('Pick a color, or type a hex like #2f6bff.');
  const clash = lists().find((l) => l.id !== leId && (l.name.toLowerCase() === name.toLowerCase() || l.id === name.toLowerCase()));
  if (clash) return err(`Another list is already called “${clash.name}”.`);
  if (!leId) {   // add
    if (lists().length >= 20) return err('That’s the maximum of 20 lists.');
    const taken = new Set(listIds().concat(DEFAULT_LISTS.map((l) => l.id)));
    let id = slugify(name), n = 2; const base = id; while (taken.has(id)) id = `${base}-${n++}`;
    S.lists = lists().concat({ id, name, color, order: lists().length });
    queueList({ t: 'newlist', id, name, color });
    leDlg.close();
    toast(`Added “${name}”`, { ms: 1400 });
    requestAnimationFrame(() => quickAdd(id));
    return;
  }
  const prev = listCfg(leId);
  if (prev.name === name && prev.color === color) { leDlg.close(); return; }
  S.lists = lists().map((l) => (l.id === leId ? { ...l, name, color } : l));
  queueList({ t: 'list', id: leId, name, color });
  leDlg.close();
  toast(`Saved “${name}”`, { ms: 1400 });
});
$('#leDel').addEventListener('click', () => {
  const id = leId; if (!id || id === 'personal' || lists().length <= 1) return;
  const n = Object.values(S.tasks).filter((t) => listOf(t) === id).length;
  if (!delArmed) {   // first tap arms; second confirms
    delArmed = true;
    $('#leDel').classList.add('armed');
    $('#leDel').textContent = n ? `Delete? ${n} task${n === 1 ? ' moves' : 's move'} to ${listName('personal')}` : 'Tap again to delete';
    return;
  }
  leDlg.close();
  deleteList(id);   // tasks move to Personal; nothing is deleted
});
function saveOrder(ids) {
  const cur = listIds();
  if (ids.join('|') === cur.join('|')) return;
  const rank = new Map(ids.map((id, i) => [id, i]));
  S.lists = lists().map((l) => ({ ...l, order: rank.has(l.id) ? rank.get(l.id) : 1000 + l.order }));
  queueList({ t: 'order', order: lists().map((l) => l.id) });
}
let headerDragged = false;
board.addEventListener('click', (e) => {
  const b = e.target.closest('.list-name');
  if (!b) return;
  e.stopPropagation();
  if (headerDragged) { headerDragged = false; return; }
  openListEdit(b.closest('.day').dataset.key);
}, true);
{
  const box = $('#setLists');
  const commitRename = (inp) => {
    const id = inp.closest('.le-row').dataset.id, name = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name || name === listName(id)) { ed.rename = null; ed.err = ''; renderListSettings(true); return true; }
    const err = nameError(name, id);
    if (err) { ed.err = err; renderListSettings(true); return false; }
    ed.rename = null; ed.err = '';
    renameList(id, name); renderListSettings(true);
    return true;
  };
  const commitAdd = () => {
    const inp = $('.le-add-in', box); if (!inp) return;
    const name = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    const err = !name ? '' : lists().length >= 20 ? 'That’s the maximum of 20 lists.' : nameError(name, null);
    if (!name) { ed.adding = false; ed.err = ''; renderListSettings(true); return; }
    if (err) { ed.err = err; renderListSettings(true); return; }
    ed.err = ''; addList(name, nextColor());
    ed.adding = true; renderListSettings(true);   // stay in "add" mode for the next one
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const open = $('.le-in:not(.le-add-in)', box);   // a rename in progress elsewhere is saved first (iOS taps don't blur reliably)
    if (open && !(b.closest('.le-row') && b.closest('.le-row').contains(open)) && !commitRename(open)) return;
    const row = b.closest('.le-row[data-id]') || b.closest('.le-row'), id = row && row.dataset.id, a = b.dataset.act;
    if (a === 'rename') { Object.assign(ed, { rename: id, color: null, del: null, adding: false, err: '' }); renderListSettings(true); }
    else if (a === 'color') { Object.assign(ed, { color: ed.color === id ? null : id, del: null, rename: null, err: '' }); renderListSettings(true); buzz(5); }
    else if (a === 'pick') { recolorList(id, b.dataset.c); buzz(8); ed.color = null; renderListSettings(true); }
    else if (a === 'up' || a === 'down') { if (moveListBy(id, a === 'up' ? -1 : 1)) { renderListSettings(true); const nb = $(`.le-row[data-id="${id}"] [data-act="${a}"]`, box); (nb && !nb.disabled ? nb : $(`.le-row[data-id="${id}"] .grip`, box)).focus(); } }
    else if (a === 'delete') { Object.assign(ed, { del: ed.del === id ? null : id, color: null, rename: null, err: '' }); renderListSettings(true); }
    else if (a === 'del-cancel') { ed.del = null; renderListSettings(true); }
    else if (a === 'del-yes') { ed.del = null; deleteList(id); buzz(12); renderListSettings(true); }
    else if (a === 'add') { Object.assign(ed, { adding: true, rename: null, color: null, del: null, err: '' }); renderListSettings(true); }
    else if (a === 'add-go') commitAdd();
    else if (a === 'add-cancel') { ed.adding = false; ed.err = ''; renderListSettings(true); }
  });
  box.addEventListener('input', (e) => { if (e.target.matches('.le-custom-in')) { const id = e.target.closest('.le-row').dataset.id; recolorList(id, e.target.value.toLowerCase()); const r = e.target.closest('.le-row'); r.style.setProperty('--lc', e.target.value); } });
  box.addEventListener('change', (e) => { if (e.target.matches('.le-custom-in')) { ed.color = null; renderListSettings(true); } });
  box.addEventListener('keydown', (e) => {
    const inp = e.target.closest('.le-in');
    if (inp && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); inp.classList.contains('le-add-in') ? commitAdd() : commitRename(inp); return; }
    if (inp && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); Object.assign(ed, { rename: null, adding: false, err: '' }); renderListSettings(true); return; }
    const g = e.target.closest('.grip'); if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = g.closest('.le-row').dataset.id;
    if (moveListBy(id, e.key === 'ArrowUp' ? -1 : 1)) { renderListSettings(true); $(`.le-row[data-id="${id}"] .grip`, box).focus(); }
  });
  box.addEventListener('focusout', (e) => {
    const inp = e.target.closest && e.target.closest('.le-in'); if (!inp) return;
    setTimeout(() => {
      if (!inp.isConnected || box.contains(document.activeElement) && document.activeElement.closest('.le-row') === inp.closest('.le-row')) return;
      if (inp.classList.contains('le-add-in')) { if (inp.value.trim()) commitAdd(); else { ed.adding = false; ed.err = ''; renderListSettings(true); } }
      else commitRename(inp);
    }, 120);
  });
  // Drag the ≡ handle (touch or mouse, no long-press): the row follows the finger and the others make room.
  let sd = null;
  box.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('button.grip'); if (!g || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const row = g.closest('.le-row'), r = row.getBoundingClientRect();
    sd = { row, pid: e.pointerId, gy: e.clientY - r.top, moved: false, y0: e.clientY };
    try { g.setPointerCapture(e.pointerId); } catch {}
    box.classList.add('sorting'); row.classList.add('lifting'); buzz(8);
  });
  box.addEventListener('pointermove', (e) => {
    if (!sd || e.pointerId !== sd.pid) return;
    e.preventDefault();
    if (Math.abs(e.clientY - sd.y0) > 3) sd.moved = true;
    const rows = $$('.le-row[data-id]', box).filter((r) => r !== sd.row);
    let before = null;
    for (const r of rows) { const rc = r.getBoundingClientRect(); if (e.clientY < rc.top + rc.height / 2) { before = r; break; } }
    if (!before) before = rows.length ? rows[rows.length - 1].nextElementSibling : null;
    if (before !== sd.row.nextElementSibling && before !== sd.row) { box.insertBefore(sd.row, before); buzz(4); }
    sd.row.style.transform = '';
    const nr = sd.row.getBoundingClientRect();
    sd.row.style.transform = `translateY(${e.clientY - sd.gy - nr.top}px)`;
  });
  const end = () => {
    if (!sd) return;
    const { row } = sd; sd = null;
    row.classList.remove('lifting'); row.style.transform = ''; box.classList.remove('sorting');
    saveOrder($$('.le-row[data-id]', box).map((r) => r.dataset.id));
    renderListSettings(true);
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  box.addEventListener('touchmove', (e) => { if (sd) e.preventDefault(); }, { passive: false });
}
// Desktop: drag a list's header sideways to reorder the columns.
{
  let hd = null;
  board.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.day > header');
    if (!h || isMobile() || e.pointerType !== 'mouse' || e.button !== 0) return;
    hd = { sec: h.parentElement, x: e.clientX, pid: e.pointerId, on: false };
  });
  addEventListener('pointermove', (e) => {
    if (!hd || e.pointerId !== hd.pid) return;
    const dx = e.clientX - hd.x;
    if (!hd.on && Math.abs(dx) < 8) return;
    if (!hd.on) { hd.on = true; hd.sec.classList.add('list-dragging'); document.body.classList.add('sorting-lists'); }
    hd.sec.style.transform = `translateX(${dx}px)`;
    const secs = $$('.day', board).filter((s) => s !== hd.sec);
    hd.before = null;
    for (const s of secs) { const r = s.getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { hd.before = s; break; } }
    secs.forEach((s) => s.classList.toggle('drop-before', s === hd.before));
    const last = secs[secs.length - 1]; if (last) last.classList.toggle('drop-after', !hd.before);
  });
  const end = () => {
    if (!hd) return;
    const { sec, on, before } = hd; hd = null;
    if (!on) return;
    headerDragged = true; setTimeout(() => (headerDragged = false), 50);
    sec.classList.remove('list-dragging'); sec.style.transform = ''; document.body.classList.remove('sorting-lists');
    $$('.day', board).forEach((s) => s.classList.remove('drop-before', 'drop-after'));
    const ids = $$('.day', board).map((s) => s.dataset.key).filter((k) => k !== sec.dataset.key);
    const at = before ? ids.indexOf(before.dataset.key) : ids.length;
    ids.splice(at, 0, sec.dataset.key);
    saveOrder(ids);
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
}

const setDlg = $('#settings');
function openSettings(focusLists) { Object.assign(ed, { rename: null, color: null, del: null, adding: false, err: '' }); renderListSettings(true); $('#setSound').checked = !S.muted; $('#setHaptics').checked = S.haptics; $('#setVoice').checked = S.voiceFirst; setDlg.showModal(); }
$('#settingsBtn').addEventListener('click', () => openSettings(false));
function openListsEditor() {
  openSettings(true);
  setDlg.scrollTop = 0;
  const sec = $('#listsSec'); sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
  buzz(6);
}
$('#stripEdit').addEventListener('click', openListsEditor);
$('#listsBtn').addEventListener('click', openListsEditor);
$('#setSound').addEventListener('change', (e) => { S.muted = !e.target.checked; persist(); if (!S.muted) sfx.pop(false); });
$('#setHaptics').addEventListener('change', (e) => { S.haptics = e.target.checked; persist(); buzz(15); });
$('#setVoice').addEventListener('change', (e) => { S.voiceFirst = e.target.checked; persist(); });
$('#setHelp').addEventListener('click', () => { setDlg.close(); $('#helpSheet').showModal(); });
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('dialog'))));
$$('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) closeSheet(d);
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(d); });   // Esc slides it away too
});

/* ───────────── sync ───────────── */
let flushTimer = 0, syncing = false, again = false;
const api = (path, opt = {}) => fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } });
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(sync, 250); }
function setMode(m) { if (S.mode !== m) { S.mode = m; renderSync(); } }
function renderSync() {
  const dot = $('#syncDot');
  dot.className = 'dot ' + ({ sync: S.queue.length ? 'busy' : 'ok', busy: 'busy', local: 'off', offline: 'warn' }[S.mode] || 'off');
  const txt = {
    sync: S.queue.length ? 'Saving…' : 'All saved',
    busy: 'Saving…',
    local: 'Storage isn’t set up yet.',
    offline: `You’re offline. ${S.queue.length} change${S.queue.length === 1 ? '' : 's'} will save when you’re back.`,
  }[S.mode];
  $('#syncBtn').title = txt; $('#syncBtn').setAttribute('aria-label', txt);
}
/* ── password gate: entered once per device; long-lived cookie keeps it unlocked ── */
const gate = $('#gate');
function showGate() {
  try { localStorage.removeItem('done.auth'); } catch {}
  document.documentElement.classList.add('needs-auth'); gate.hidden = false;
  setTimeout(() => $('#gatePw').focus(), 50);
}
function hideGate() { document.documentElement.classList.remove('needs-auth'); gate.hidden = true; }
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#gateErr'), card = $('#gateForm'), btn = $('#gateBtn');
  card.classList.remove('bad'); err.textContent = ''; btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#gatePw').value }) });
    if (r.ok) { try { localStorage.setItem('done.auth', '1'); } catch {} $('#gatePw').value = ''; hideGate(); sync(); return; }
    err.textContent = r.status === 429 ? 'Too many tries. Give it a minute.' : 'That’s not quite right. Try again.';
    card.classList.add('bad'); $('#gatePw').select();
  } catch { err.textContent = 'Can’t reach the server. Check your connection.'; }
  finally { btn.disabled = false; }
});
async function sync() {
  if (syncing) { again = true; return; }
  if (!navigator.onLine) return setMode('offline');
  syncing = true;
  try {
    while (S.queue.length) {
      const q = S.queue[0];
      const r = q.t === 'put' ? await api('/api/tasks', { method: 'POST', body: JSON.stringify(q.task) })
        : q.t === 'list' ? await api('/api/lists?id=' + encodeURIComponent(q.id), { method: 'PATCH', body: JSON.stringify({ name: q.name, color: q.color }) })
        : q.t === 'newlist' ? await api('/api/lists', { method: 'POST', body: JSON.stringify({ id: q.id, name: q.name, color: q.color }) })
        : q.t === 'dellist' ? await api('/api/lists?id=' + encodeURIComponent(q.id), { method: 'DELETE' })
        : q.t === 'order' ? await api('/api/lists', { method: 'PUT', body: JSON.stringify({ order: q.order }) })
        : await api('/api/tasks?id=' + encodeURIComponent(q.id), { method: 'DELETE' });
      if (r.status === 401) { showGate(); return; }
      if (r.status === 503) return setMode('local');
      if (r.status === 409 || r.status === 429 || r.status >= 500) { setTimeout(sync, 2500); throw new Error('retry'); }
      if (!r.ok && r.status !== 404) console.warn('dropping bad write', await r.text());
      S.queue.shift(); persist();
    }
    const r = await api('/api/tasks');
    if (r.status === 401) { showGate(); return; }
    if (r.status === 503) return setMode('local');
    if (!r.ok) throw new Error('server');
    const { tasks, lists: serverLists } = await r.json();
    const LIST_OPS = ['list', 'newlist', 'dellist', 'order'];
    if (Array.isArray(serverLists) && serverLists.length && !S.queue.some((q) => LIST_OPS.includes(q.t))) S.lists = serverLists.map(({ id, name, color, order }) => ({ id, name, color, order }));
    const pending = new Set(S.queue.filter((q) => !LIST_OPS.includes(q.t)).map((q) => (q.t === 'put' ? q.task.id : q.id)));
    const seen = new Set();
    for (const t of tasks) {
      seen.add(t.id);
      if (pending.has(t.id)) continue;
      S.tasks[t.id] = migratePriority({ x: { ...t, date: t.date || null } }).x;
    }
    for (const id of Object.keys(S.tasks)) if (!seen.has(id) && !pending.has(id)) delete S.tasks[id];
    persist(); setMode('sync'); render();
  } catch { setMode('offline'); }
  finally { syncing = false; if (again) { again = false; scheduleFlush(); } }
}
setInterval(() => { if (!document.hidden) sync(); }, 15000);
addEventListener('focus', sync);
addEventListener('online', sync);
addEventListener('offline', () => setMode('offline'));
let renderedDay = nyToday();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); if (renderedDay !== nyToday()) { renderedDay = nyToday(); render(); } } });

$('#syncBtn').addEventListener('click', () => { sync(); toast(S.mode === 'offline' ? 'Offline. Will save when you’re back.' : 'Refreshed', { ms: 1200 }); });

/* ───────────── install ───────────── */
let deferred = null;
function renderInstall() { $('#installBtn').hidden = standalone() || !(deferred || isIOS); }
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; renderInstall(); });
addEventListener('appinstalled', () => { deferred = null; renderInstall(); toast('Installed. Find Done on your home screen.'); });
matchMedia('(display-mode: standalone)').addEventListener('change', renderInstall);
$('#installBtn').addEventListener('click', async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; renderInstall(); }
  else if (isIOS) $('#iosSheet').showModal();
});

/* ───────────── v10: native-app feel on phones ───────────── */
// Sheets slide away instead of vanishing (bottom sheets on phones, see styles.css).
function closeSheet(d) {
  if (!d || !d.open || d.classList.contains('closing')) return;
  if (reduceMotion.matches) { d.close(); return; }
  const tok = (d._closeTok = {});
  d.classList.add('closing');
  const fin = () => { if (d._closeTok !== tok) return; d._closeTok = null; d.classList.remove('closing', 'dragging', 'settle'); d.style.transform = ''; if (d.open) d.close(); };
  d.addEventListener('animationend', fin, { once: true });
  setTimeout(fin, 420);
}
// Swipe a bottom sheet down to dismiss it (only when its content is scrolled to the top).
$$('dialog.sheet').forEach((d) => {
  let y0 = null, dy = 0, t0 = 0;
  d.addEventListener('touchstart', (e) => {
    y0 = null;
    if (!isMobile() || e.touches.length !== 1 || d.scrollTop > 0 || e.target.closest('input,textarea,.grip,.swatches,.seg,.le-custom')) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
  }, { passive: true });
  d.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { d.style.transform = ''; if (dy < -8) y0 = null; return; }
    if (e.cancelable) e.preventDefault();
    d.classList.add('dragging');
    d.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (y0 == null) return;
    y0 = null; d.classList.remove('dragging');
    const v = dy / Math.max(1, Date.now() - t0);
    if (dy > 110 || (dy > 40 && v > 0.6)) { buzz(6); closeSheet(d); }
    else if (dy > 0) { d.classList.add('settle'); d.style.transform = ''; setTimeout(() => d.classList.remove('settle'), 260); }
  };
  d.addEventListener('touchend', end); d.addEventListener('touchcancel', end);
});

// Keyboard: on iOS the keyboard covers the page instead of resizing it. While typing in the board, size the app
// to the visible area so the focused quick-add row stays visible above the keyboard, and keep the page itself from panning.
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'color', 'date', 'range', 'button', 'submit'].includes(el.type)));
function revealAdd(form) {
  if (!form) return;
  const sc = form.closest('.scroll'); if (!sc) return;
  const fr = form.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  if (fr.bottom > sr.bottom - 6) sc.scrollTop += fr.bottom - sr.bottom + 10;
  else if (fr.top < sr.top) sc.scrollTop -= sr.top - fr.top + 10;
}
let kbRaf = 0;
function fitViewport() {
  cancelAnimationFrame(kbRaf);
  kbRaf = requestAnimationFrame(() => {
    const vv = window.visualViewport; if (!vv) return;
    const a = document.activeElement, inBoard = isTyping(a) && !!a.closest('#board');
    const open = isTyping(a) && innerHeight - vv.height > 120;
    document.body.classList.toggle('kb-open', open);
    if (open && inBoard) {
      document.documentElement.style.setProperty('--app-h', Math.round(vv.height) + 'px');
      if (scrollY || vv.offsetTop) scrollTo(0, 0);
      revealAdd(a.closest('.add'));
    } else document.documentElement.style.removeProperty('--app-h');
  });
}
if (window.visualViewport) { visualViewport.addEventListener('resize', fitViewport); visualViewport.addEventListener('scroll', fitViewport); }
document.addEventListener('focusin', (e) => { if (isTyping(e.target)) { fitViewport(); setTimeout(fitViewport, 320); } });
document.addEventListener('focusout', () => setTimeout(fitViewport, 60));
// No pinch-zoom of the app chrome (iOS ignores user-scalable=no in Safari tabs; this covers it there).
['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

// Long-press to reorder lists on touch: the chips in the list strip (one-list view on phones), or the list
// headers (all-lists view on phones, columns on tablets). A quick swipe still scrolls; only a held finger lifts.
{
  const HOLD = 400;
  let ts = null, eatClick = false;
  const itemsOf = (box) => [...box.children].filter((n) => n.dataset && n.dataset.key);
  function lift() {
    touchSort.timer = 0;
    if (!ts) return;
    ts.on = touchSort.on = true;
    const r = ts.el.getBoundingClientRect();
    ts.gx = ts.x - r.left; ts.gy = ts.y - r.top;
    ts.el.classList.add('lifting'); ts.box.classList.add('sorting'); document.body.classList.add('sorting-touch');
    closeSwipe(); buzz(12);
    ts.raf = requestAnimationFrame(tick);
  }
  function place() {
    const { el, box, axis } = ts, p = axis === 'x' ? ts.lx : ts.ly;
    let before = null;
    for (const it of itemsOf(box)) {
      if (it === el) continue;
      const r = it.getBoundingClientRect(), mid = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
      if (p < mid) { before = it; break; }
    }
    if (before !== el.nextElementSibling && before !== el) { box.insertBefore(el, before); buzz(4); }
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    el.style.transform = axis === 'x' ? `translateX(${ts.lx - ts.gx - r.left}px) scale(1.06)` : `translateY(${ts.ly - ts.gy - r.top}px) scale(.985)`;
  }
  function tick() {
    if (!ts || !ts.on) return;
    const { box, axis } = ts, r = box.getBoundingClientRect(), edge = 48;
    if (axis === 'x') { if (ts.lx < r.left + edge) box.scrollLeft -= 8; else if (ts.lx > r.right - edge) box.scrollLeft += 8; }
    else { if (ts.ly < r.top + edge) box.scrollTop -= 10; else if (ts.ly > r.bottom - edge) box.scrollTop += 10; }
    place();
    ts.raf = requestAnimationFrame(tick);
  }
  function finish(save) {
    clearTimeout(touchSort.timer); touchSort.timer = 0;
    if (!ts) return;
    const { el, box, on } = ts;
    cancelAnimationFrame(ts.raf);
    ts = null; touchSort.on = false;
    if (!on) return;
    el.classList.remove('lifting'); box.classList.remove('sorting'); document.body.classList.remove('sorting-touch');
    el.style.transform = '';
    eatClick = true; setTimeout(() => (eatClick = false), 120);
    if (save) saveOrder(itemsOf(box).map((n) => n.dataset.key));
    else render();
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || ts) return;
    const chip = e.target.closest('#strip .chip');
    const head = !chip && e.target.closest('#board .day > header');
    let el, box, axis;
    if (chip) { el = chip; box = strip; axis = 'x'; }
    else if (head && !isMobile()) { el = head.parentElement; box = board; axis = 'x'; }
    else if (head && S.view !== 'focus') { el = head.parentElement; box = board; axis = 'y'; }
    else return;
    ts = { el, box, axis, pid: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, on: false, raf: 0 };
    touchSort.timer = setTimeout(lift, HOLD);
  }, true);
  addEventListener('pointermove', (e) => {
    if (!ts || e.pointerId !== ts.pid) return;
    ts.lx = e.clientX; ts.ly = e.clientY;
    if (!ts.on) { if (Math.hypot(e.clientX - ts.x, e.clientY - ts.y) > 10) finish(false); return; }   // it's a scroll
    e.preventDefault();
  }, { passive: false });
  addEventListener('pointerup', (e) => { if (ts && e.pointerId === ts.pid) finish(true); });
  addEventListener('pointercancel', (e) => { if (ts && e.pointerId === ts.pid) finish(ts.on); });
  document.addEventListener('click', (e) => { if (eatClick) { eatClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
}

/* ───────────── boot ───────────── */
renderView();
render();
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.has('key')) { params.delete('key'); history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); }   // legacy setup links: ignored
  sync();
  const p2 = new URLSearchParams(location.search);
  if (p2.has('capture') || p2.has('new')) {
    p2.delete('capture'); p2.delete('new');
    history.replaceState(null, '', location.pathname + (p2.toString() ? '?' + p2 : ''));
    setTimeout(() => quickAdd('personal'), 80);   // home-screen "Add task" shortcut
  }
})();
setInterval(() => { if (renderedDay !== nyToday()) { renderedDay = nyToday(); render(); } }, 60000);
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
window.__done = { S, render, openCapture, quickAdd };
