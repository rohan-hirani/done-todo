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
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const S = {
  tasks: saved.tasks || {},
  queue: saved.queue || [],
  muted: !!saved.muted,
  haptics: saved.haptics !== false,
  voiceFirst: !!saved.voiceFirst,
  view: saved.view || 'focus',
  days: saved.days || 7,
  mode: 'local',
};
function persist() {
  localStorage.setItem(LS, JSON.stringify({ tasks: S.tasks, queue: S.queue, muted: S.muted, haptics: S.haptics, voiceFirst: S.voiceFirst, view: S.view, days: S.days }));
}
const buzz = (p) => { if (S.haptics && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(p); };

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
function addTask(title, date) {
  title = title.trim();
  if (!title) return null;
  const t = { id: uid(), title, date, planned_date: date, original_date: null, rollovers: 0, done: false, done_at: null, pinned: false, position: Date.now(), created_at: nowIso(), updated_at: nowIso(), source: 'app' };
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

/* ───────────── auto-rollover (mirrors the server; midnight-safe) ───────────── */
const dayDiff = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
function rollLocal() {
  const today = todayKey();
  let changed = false;
  for (const t of Object.values(S.tasks)) {
    if (!t.done && t.date && t.date < today) {
      if (!t.original_date) t.original_date = t.date;
      t.rollovers = (t.rollovers || 0) + dayDiff(t.date, today);
      t.date = today; changed = true;
    }
  }
  if (changed) persist();
}

/* ───────────── derived ───────────── */
function dayList(key) {
  const today = todayKey();
  const all = Object.values(S.tasks);
  let list;
  if (key === 'someday') list = all.filter((t) => !t.date).sort((a, b) => a.position - b.position);
  else if (key === today) {
    list = all.filter((t) => t.date === today || (t.date && t.date < today && (!t.done || doneKey(t) === today)))
      .sort((a, b) => ((a.date < today ? 0 : 1) - (b.date < today ? 0 : 1)) || (a.date < today && b.date < today ? a.date.localeCompare(b.date) : 0) || a.position - b.position);
  } else list = all.filter((t) => t.date === key).sort((a, b) => a.position - b.position);
  return list.sort((a, b) => (b.pinned && !b.done ? 1 : 0) - (a.pinned && !a.done ? 1 : 0));   // starred first (stable)
}
function streak() {
  const days = new Set(Object.values(S.tasks).filter((t) => t.done && t.done_at).map(doneKey));
  let k = todayKey(), n = 0;
  if (!days.has(k)) k = addDays(k, -1);
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}
const dayKeys = () => Array.from({ length: S.days }, (_, i) => addDays(todayKey(), i));

/* ───────────── rendering ───────────── */
const board = $('#board');
const strip = $('#strip');
let builtFor = '';
let activeKey = 'today';

const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="box" cx="12" cy="12" r="10"/><circle class="fill" cx="12" cy="12" r="10.8"/><path class="tick" d="M7 12.5l3.4 3.4L17 8.8"/></svg>';
const I_STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" fill="currentColor"/></svg>';
const I_MOVE = '<svg viewBox="0 0 24 24"><path d="M4 12h14m-5-5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_TRASH = '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-6 0l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const I_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function buildBoard() {
  const sig = todayKey() + '|' + S.days;
  if (sig === builtFor) return;
  builtFor = sig;
  board.textContent = '';
  strip.textContent = '';
  const cols = [...dayKeys().map((k, i) => ({ id: k, date: k, today: i === 0 })), { id: 'someday', date: null }];
  cols.forEach((c, idx) => {
    const name = c.date === null ? 'Someday' : dayName(c.date);
    const sub = c.date === null ? 'No date' : fmt(c.date, { weekday: 'short', month: 'short', day: 'numeric' });
    const sec = document.createElement('section');
    sec.className = 'day' + (c.today ? ' today' : '') + (c.date === null ? ' someday' : '');
    sec.dataset.key = c.id;
    sec.dataset.date = c.date || '';
    sec.setAttribute('aria-label', name);
    sec.innerHTML = `<header><h2>${name}</h2><span class="sub">${sub}</span></header>
      ${c.today ? `<div class="hero"><div class="hero-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" pathLength="100"/></svg><span class="hero-num">0/0</span></div><p class="hero-cap"></p></div>` : ''}
      <form class="add" autocomplete="off"><span class="plus" aria-hidden="true">+</span><input type="text" enterkeyhint="done" placeholder="${c.today ? 'Add a task for today' : 'Add a task'}" aria-label="Add task to ${name}" maxlength="500"></form>
      <ul class="list" role="list"></ul>
      <p class="empty">${c.today ? 'A clear day. Add something, or enjoy it.' : c.date === null ? 'Park ideas here for later.' : 'Nothing planned.'}</p>`;
    board.appendChild(sec);
    const chip = document.createElement('button');
    chip.className = 'chip' + (c.today ? ' today' : '');
    chip.dataset.key = c.id;
    chip.innerHTML = `${c.today ? 'Today' : c.date === null ? 'Someday' : idx === 1 ? 'Tomorrow' : fmt(c.date, { weekday: 'short', day: 'numeric' })}<small></small>`;
    chip.addEventListener('click', () => scrollToKey(c.id));
    strip.appendChild(chip);
    if (idx === S.days - 1) {
      const more = document.createElement('button');
      more.className = 'more-days';
      more.textContent = '+ 7 more days';
      more.addEventListener('click', () => { S.days += 7; persist(); render(); });
      board.appendChild(more);
    }
  });
  observeActive();
}

const taskSig = (t, key) => [t.title, t.done, t.date, t.pinned, key === todayKey() ? (t.original_date || '') + (t.date < key ? t.date : '') + (t.rollovers || 0) : ''].join('\u0001');
function makeLi(t) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = t.id;
  li.innerHTML = `<div class="swipe-done">${I_OK}<span>Done</span></div>
    <div class="swipe-actions"><button class="act-star" aria-label="Star as top 3">${I_STAR}<span>Top 3</span></button><button class="act-move" aria-label="Move">${I_MOVE}<span>Move</span></button><button class="act-del" aria-label="Delete">${I_TRASH}<span>Delete</span></button></div>
    <div class="task-in">
      <button class="check" role="checkbox" aria-checked="false" aria-label="Complete task">${ICON_CHECK}</button>
      <div class="body"><span><span class="star" aria-label="Top 3">★</span><span class="title" tabindex="0" role="button" aria-label="Edit task"></span></span><span class="carry" hidden></span></div>
      <button class="more" aria-haspopup="menu" aria-label="Move or delete task">${ICON_MORE}</button>
    </div>`;
  return li;
}
function updateLi(li, t, key) {
  const from = key === todayKey() ? (t.date && t.date < key ? t.date : t.original_date && t.original_date < key ? t.original_date : null) : null;
  const carried = !!from;
  const sig = taskSig(t, key);
  li.classList.toggle('done', t.done);
  li.classList.toggle('pinned', !!t.pinned && !t.done);
  $('.check', li).setAttribute('aria-checked', String(t.done));
  if (li.dataset.sig === sig) return;
  li.dataset.sig = sig;
  if (!li.classList.contains('editing')) $('.title', li).textContent = t.title;
  $('.act-star span', li).textContent = t.pinned ? 'Unstar' : 'Top 3';
  const c = $('.carry', li);
  c.hidden = !carried;
  if (carried) c.textContent = 'Carried over from ' + (from === addDays(key, -1) ? 'yesterday' : fmt(from, { weekday: 'short', month: 'short', day: 'numeric' })) + ((t.rollovers || 0) > 1 ? ` · ${t.rollovers} days` : '');
}

function render() {
  rollLocal();
  buildBoard();
  document.body.classList.toggle('view-focus', S.view === 'focus');
  document.body.classList.toggle('view-overview', S.view !== 'focus');
  const today = todayKey();
  // FLIP: remember where rows were so reorders glide instead of jump
  const before = new Map($$('.task', board).map((li) => [li.dataset.id, { top: li.getBoundingClientRect().top, col: li.closest('.day')?.dataset.key }]));
  let doneN = 0, totalN = 0;
  for (const sec of $$('.day', board)) {
    const key = sec.dataset.key;
    const list = dayList(key);
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
    for (const li of existing.values()) if (!li.classList.contains('dragging')) li.remove();
    if (key === today) { totalN = list.length; doneN = list.filter((t) => t.done).length; }
    const chip = $(`.chip[data-key="${key}"] small`, strip);
    if (chip) { const open = list.filter((t) => !t.done).length; chip.textContent = open || ''; }
  }
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
const isTodayFull = () => { const l = dayList(todayKey()); return l.length > 0 && l.every((t) => t.done); };
function allDone() {
  celebrate();
  sfx.fanfare(S.muted);
  buzz([15, 40, 15, 40, 30]);
  const msgs = ['Clear day. Nicely done.', 'All done for today. Go enjoy it.', 'Zero left. Beautiful.', 'That’s everything. Well played.'];
  toast(msgs[Math.floor(Math.random() * msgs.length)], { big: true, ms: 4200 });
}
function togglePin(id) {
  const t = S.tasks[id]; if (!t) return;
  if (!t.pinned) {
    const key = t.date === null ? 'someday' : t.date < todayKey() ? todayKey() : t.date;
    if (dayList(key).filter((x) => x.pinned && !x.done).length >= 3) return toast('Top 3 is full. Unstar one first.', { ms: 2200 });
  }
  put({ ...t, pinned: !t.pinned });
  buzz(8);
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
  menu.hidden = false; menuBack.hidden = false;
  if (!isMobile()) {
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 220, r.right - 210)) + 'px';
    const below = r.bottom + 8, h = menu.offsetHeight;
    menu.style.top = (below + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : below) + 'px';
  }
  const t = S.tasks[id];
  $('#menuDate').value = t && t.date || '';
  $('#menuPin').textContent = t && t.pinned ? 'Remove star' : 'Star as top 3';
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
  else if (a === 'pin') togglePin(id);
  else if (a === 'delete') deleteWithUndo(id);
});
$('#menuDate').addEventListener('change', (e) => { if (menuId && e.target.value) { const id = menuId; closeMenu(false); closeSwipe(); moveTo(id, e.target.value); toast('Moved to ' + whenLabel(e.target.value)); } });
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
  const inp = $('input', form), key = form.closest('.day').dataset.date || null;
  const p = parseWhen(inp.value, new Date());
  if (addTask(p.date !== undefined ? p.title : inp.value, p.date !== undefined ? p.date : key)) { inp.value = ''; $('.list', form.closest('.day')).scrollTop = 0; }
  inp.focus();
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
    const t = S.tasks[id], keys = [...dayKeys(), null];
    let cur = keys.indexOf(t.date); if (cur < 0) cur = t.date && t.date < todayKey() ? 0 : keys.length - 1;
    const nxt = keys[Math.max(0, Math.min(keys.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (nxt !== t.date) { moveTo(id, nxt); requestAnimationFrame(() => focusTitle($(`.task[data-id="${id}"]`))); }
  } else if (e.key === 'ArrowDown') { e.preventDefault(); focusTitle(list[i + 1]); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusTitle(list[i - 1]); }
  else if (e.target.matches('.title') && (e.key === 'Enter' || e.key === 'e')) { e.preventDefault(); startEdit(li); }
  else if (e.key === ' ' || e.key === 'x') { e.preventDefault(); toggle(id, $('.check', li)); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteWithUndo(id); }
});

/* ───────────── pointer gestures: drag-reorder (mouse / long-press) + swipe actions (touch) ───────────── */
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
addEventListener('touchmove', (e) => { if (drag.ghost || drag.swipe) e.preventDefault(); }, { passive: false });
addEventListener('contextmenu', (e) => { if (drag.ghost || drag.timer) e.preventDefault(); });
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
  if (sec) { const ul = $('.list', sec), r = ul.getBoundingClientRect(); if (y < r.top + 40) ul.scrollTop -= 10; else if (y > r.bottom - 40) ul.scrollTop += 10; }
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
      const todayCol = sec.dataset.key === todayKey();
      const date = todayCol && t.date && t.date < todayKey() ? todayKey() : (sec.dataset.date || null);
      const nd = todayCol && t.date && t.date <= todayKey() ? (t.date < todayKey() ? todayKey() : t.date) : date;
      put({ ...t, date: nd, ...(nd !== t.date ? { planned_date: nd, original_date: null } : {}), position: pos });
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
  else board.scrollTo({ left: sec.offsetLeft - (isMobile() ? 16 : 28), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
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
    if (best && best.dataset.key !== activeKey) setActive(best.dataset.key);
  });
}

/* ───────────── capture sheet ───────────── */
const cap = { open: false, chip: 'today', custom: '' };
const capEl = $('#capture'), cIn = $('#cInput'), cWhen = $('#cWhen'), cHint = $('#cHint'), cLog = $('#cLog'), cPrev = $('#cPreview');
const chipDate = () => (cap.chip === 'today' ? todayKey() : cap.chip === 'tomorrow' ? addDays(todayKey(), 1) : cap.chip === 'someday' ? null : cap.custom);
function setChip(v) {
  cap.chip = v;
  $$('#capChips .cchip[data-v]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.v === v)));
  $('#cDateChip').setAttribute('aria-checked', String(v === 'date'));
  $('#cDateLbl').textContent = v === 'date' ? whenLabel(cap.custom) : 'Date';
  updateWhen();
}
function updateWhen() {
  const p = parseWhen(cIn.value, new Date());
  cWhen.textContent = p.date !== undefined ? `→ ${whenLabel(p.date)}` : cIn.value.trim() ? `→ ${whenLabel(chipDate())}` : '';
}
function positionSheet() {
  const vv = window.visualViewport;
  if (!vv || !cap.open) { capEl.style.bottom = ''; return; }
  if (isMobile()) capEl.style.bottom = Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px';
}
window.visualViewport && ['resize', 'scroll'].forEach((ev) => visualViewport.addEventListener(ev, positionSheet));
function openCapture({ prefill = '', voice = true } = {}) {
  if (cap.open) { cIn.focus(); return; }
  cap.open = true;
  closeMenu(false); closeSwipe();
  capEl.removeAttribute('inert');
  capEl.classList.add('open');
  document.body.classList.add('capturing');
  cIn.value = prefill;
  cPrev.hidden = true; cLog.textContent = ''; setVoice('idle', '');
  setChip('today');
  cIn.focus({ preventScroll: true });          // inside the user gesture so iOS raises the keyboard
  positionSheet();
  buzz(8);
  if (voice && S.voiceFirst && !prefill) startVoice({ auto: true });
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
  $('span', li).textContent = title; $('em', li).textContent = whenLabel(date);
  cLog.prepend(li);
  [...cLog.children].forEach((c, i) => { c.classList.toggle('old', i > 0); if (i > 2) c.remove(); });
  capEl.classList.remove('pulse'); void capEl.offsetWidth; capEl.classList.add('pulse');
}
function addFromText(text, { keepFocus = true } = {}) {
  const p = parseWhen(text, new Date());
  const title = p.title.trim();
  if (!title) return false;
  const date = p.date !== undefined ? p.date : chipDate();
  addTask(title, date);
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
$('#capChips').addEventListener('click', (e) => { const b = e.target.closest('.cchip[data-v]'); if (b) { setChip(b.dataset.v); cIn.focus({ preventScroll: true }); buzz(5); } });
$('#cDate').addEventListener('change', (e) => { if (e.target.value) { cap.custom = e.target.value; setChip('date'); cIn.focus({ preventScroll: true }); } });
$('#fab').addEventListener('click', () => openCapture());
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
    parts.forEach((p) => { const li = document.createElement('li'); const w = parseWhen(p, new Date()); li.textContent = w.title; const s = document.createElement('small'); s.textContent = whenLabel(w.date !== undefined ? w.date : chipDate()); li.append(s); ul.append(li); });
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

/* ───────────── global gestures: swipe up to capture, pull to refresh ───────────── */
{
  let g = null;
  const ptr = $('#ptr');
  document.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length !== 1 || cap.open || drag.ghost || drag.swipe || !isMobile()) return;
    const el = e.target;
    if (el.closest('dialog,.menu,.capture,input,.swipe-actions,.fab')) return;
    const t = e.touches[0];
    const list = el.closest('.list');
    const atEnd = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 3;
    const roomy = !list || list.scrollHeight <= list.clientHeight + 2;
    g = { x: t.clientX, y: t.clientY, axis: null, up: atEnd && (t.clientY > innerHeight * 0.7 || roomy), down: (!list || list.scrollTop <= 0) && (board.scrollTop <= 0), pull: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!g || drag.ghost || drag.swipe) return;
    const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.axis && Math.hypot(dx, dy) > 12) g.axis = Math.abs(dy) > Math.abs(dx) * 1.4 ? 'v' : 'h';
    if (g.axis !== 'v') return;
    if (dy < -64 && g.up) { g = null; ptr.classList.remove('show'); openCapture(); return; }
    if (dy > 10 && g.down) { g.pull = dy; ptr.textContent = dy > 80 ? 'Release to sync' : 'Pull to sync'; ptr.style.transform = `translate(-50%,${Math.min(dy, 110) - 70}px)`; ptr.classList.add('show'); }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (g && g.pull > 80) { buzz(8); ptr.textContent = 'Syncing…'; sync().finally(() => setTimeout(() => ptr.classList.remove('show'), 500)); }
    else ptr.classList.remove('show');
    g = null;
  });
}

/* ───────────── keyboard ───────────── */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }
  if (document.querySelector('dialog[open]') || !menu.hidden || cap.open) return;
  const k = e.key;
  if (e.target.closest && e.target.closest('.task') && /^[xXeE ]$|^(Delete|Backspace|Arrow.*)$/.test(k)) return;
  if (k === '?') { $('#helpSheet').showModal(); return; }
  if (k === 'Escape') { closeSwipe(); return; }
  if (k === 'n' || k === 'N' || k === '/') { e.preventDefault(); openCapture({ voice: false }); return; }
  if (k.length === 1 && /\S/.test(k)) { e.preventDefault(); openCapture({ prefill: k, voice: false }); updateWhen(); }
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
function renderView() { $('#viewBtn').innerHTML = S.view === 'focus' ? I_LIST : I_FOCUS; $('#viewBtn').title = S.view === 'focus' ? 'Show all days' : 'Focus on today'; $('#viewBtn').setAttribute('aria-label', $('#viewBtn').title); document.body.classList.toggle('view-focus', S.view === 'focus'); document.body.classList.toggle('view-overview', S.view !== 'focus'); }
$('#viewBtn').addEventListener('click', () => { S.view = S.view === 'focus' ? 'overview' : 'focus'; persist(); renderView(); render(); board.scrollTo({ left: 0, top: 0 }); setActive(todayKey()); toast(S.view === 'focus' ? 'Focus view' : 'All days', { ms: 1200 }); });
const setDlg = $('#settings');
function openSettings() { $('#setSound').checked = !S.muted; $('#setHaptics').checked = S.haptics; $('#setVoice').checked = S.voiceFirst; setDlg.showModal(); }
$('#settingsBtn').addEventListener('click', openSettings);
$('#setSound').addEventListener('change', (e) => { S.muted = !e.target.checked; persist(); if (!S.muted) sfx.pop(false); });
$('#setHaptics').addEventListener('change', (e) => { S.haptics = e.target.checked; persist(); buzz(15); });
$('#setVoice').addEventListener('change', (e) => { S.voiceFirst = e.target.checked; persist(); });
$('#setHelp').addEventListener('click', () => { setDlg.close(); $('#helpSheet').showModal(); });
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/* ───────────── sync ───────────── */
let flushTimer = 0, syncing = false, again = false;
const api = (path, opt = {}) => fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) } });
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(sync, 250); }
function setMode(m) { if (S.mode !== m) { S.mode = m; renderSync(); } }
function renderSync() {
  const dot = $('#syncDot');
  dot.className = 'dot ' + ({ sync: S.queue.length ? 'busy' : 'ok', busy: 'busy', local: 'off', locked: 'warn', offline: 'warn' }[S.mode] || 'off');
  const txt = {
    sync: S.queue.length ? `Syncing ${S.queue.length} change${S.queue.length > 1 ? 's' : ''}…` : 'Up to date. Changes sync across your devices.',
    busy: 'Syncing…',
    local: 'Server storage isn’t set up, so tasks are saved on this device only.',
    offline: `You’re offline. ${S.queue.length} change${S.queue.length === 1 ? '' : 's'} will sync when you’re back.`,
  }[S.mode];
  $('#syncText').textContent = txt;
  $('#syncBtn').title = 'Sync: ' + txt;
}
async function sync() {
  if (syncing) { again = true; return; }
  if (!navigator.onLine) return setMode('offline');
  syncing = true;
  try {
    while (S.queue.length) {
      const q = S.queue[0];
      const r = q.t === 'put'
        ? await api('/api/tasks', { method: 'POST', body: JSON.stringify(q.task) })
        : await api('/api/tasks?id=' + encodeURIComponent(q.id), { method: 'DELETE' });
      if (r.status === 503) return setMode('local');
      if (r.status === 409 || r.status === 429 || r.status >= 500) { setTimeout(sync, 2500); throw new Error('retry'); }
      if (!r.ok && r.status !== 404) console.warn('dropping bad write', await r.text());
      S.queue.shift(); persist();
    }
    const r = await api('/api/tasks');
    if (r.status === 503) return setMode('local');
    if (!r.ok) throw new Error('server');
    const { tasks } = await r.json();
    const pending = new Set(S.queue.map((q) => (q.t === 'put' ? q.task.id : q.id)));
    const seen = new Set();
    for (const t of tasks) {
      seen.add(t.id);
      if (pending.has(t.id)) continue;
      S.tasks[t.id] = { ...t, date: t.date || null };
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); if (builtFor.split('|')[0] !== todayKey()) render(); } });

$('#syncBtn').addEventListener('click', () => { $('#syncSheet').showModal(); sync(); });
$('#syncNow').addEventListener('click', () => { sync(); toast('Syncing…', { ms: 1200 }); $('#syncSheet').close(); });

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
    setTimeout(() => openCapture(), 80);
  }
})();
setInterval(() => { if (builtFor.split('|')[0] !== todayKey()) render(); }, 60000);
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
window.__done = { S, render, openCapture };
