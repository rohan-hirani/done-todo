// Done — a calm, day-by-day to-do list. Vanilla JS, no build step.
import { burst, celebrate } from './fx.js';
import * as sfx from './sound.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LS = 'done:v1';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ───────────── state ───────────── */
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const S = {
  tasks: saved.tasks || {},       // id -> task
  queue: saved.queue || [],       // pending writes [{t:'put',task}|{t:'del',id}]
  passcode: saved.passcode || '',
  muted: !!saved.muted,
  skipLock: !!saved.skipLock,
  days: saved.days || 7,
  mode: 'local',                  // sync | local | locked | offline | busy
};
function persist() {
  localStorage.setItem(LS, JSON.stringify({ tasks: S.tasks, queue: S.queue, passcode: S.passcode, muted: S.muted, skipLock: S.skipLock, days: S.days }));
}

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
  const t = { id: uid(), title, date, done: false, done_at: null, position: Date.now(), created_at: nowIso(), updated_at: nowIso(), source: 'app' };
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

/* ───────────── derived ───────────── */
function dayList(key) {
  const today = todayKey();
  const all = Object.values(S.tasks);
  if (key === 'someday') return all.filter((t) => !t.date).sort((a, b) => a.position - b.position);
  if (key === today) {
    return all.filter((t) => t.date === today || (t.date && t.date < today && (!t.done || doneKey(t) === today)))
      .sort((a, b) => ((a.date < today ? 0 : 1) - (b.date < today ? 0 : 1)) || (a.date < today && b.date < today ? a.date.localeCompare(b.date) : 0) || a.position - b.position);
  }
  return all.filter((t) => t.date === key).sort((a, b) => a.position - b.position);
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
let editingId = null;
let activeKey = 'today';

const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="box" cx="12" cy="12" r="10"/><circle class="fill" cx="12" cy="12" r="10.8"/><path class="tick" d="M7 12.5l3.4 3.4L17 8.8"/></svg>';

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

function taskSig(t, key) {
  return [t.title, t.done, t.date, key === todayKey() && t.date && t.date < key ? t.date : ''].join('\u0001');
}
function makeLi(t) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = t.id;
  li.innerHTML = `<button class="check" role="checkbox" aria-checked="false" aria-label="Complete task">${ICON_CHECK}</button>
    <div class="body"><span class="title" tabindex="0" role="button" aria-label="Edit task"></span><span class="carry" hidden></span></div>
    <button class="more" aria-haspopup="menu" aria-label="Move or delete task">${ICON_MORE}</button>`;
  return li;
}
function updateLi(li, t, key) {
  const carried = key === todayKey() && t.date && t.date < key;
  const sig = taskSig(t, key);
  li.classList.toggle('done', t.done);
  $('.check', li).setAttribute('aria-checked', String(t.done));
  if (li.dataset.sig === sig) return;
  li.dataset.sig = sig;
  if (!li.classList.contains('editing')) $('.title', li).textContent = t.title;
  const c = $('.carry', li);
  c.hidden = !carried;
  if (carried) c.textContent = 'Carried over from ' + (t.date === addDays(key, -1) ? 'yesterday' : fmt(t.date, { weekday: 'short', month: 'short', day: 'numeric' }));
}

function render() {
  buildBoard();
  const today = todayKey();
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
    for (const li of existing.values()) if (!li.classList.contains('dragging') && !li.classList.contains('removing')) li.remove();
    if (key === today) { totalN = list.length; doneN = list.filter((t) => t.done).length; }
    const chip = $(`.chip[data-key="${key}"] small`, strip);
    if (chip) { const open = list.filter((t) => !t.done).length; chip.textContent = open || ''; }
  }
  renderStats(doneN, totalN);
  renderSync();
}

let lastAllDone = null;
function renderStats(done, total) {
  $('#ringNum').textContent = `${done}/${total}`;
  $('#ringFg').style.strokeDashoffset = total ? 100 - (done / total) * 100 : 100;
  const full = total > 0 && done === total;
  $('#ringWrap').classList.toggle('full', full);
  $('#ringCap').textContent = !total ? 'free day' : full ? 'all done' : 'done';
  const n = streak();
  const el = $('#streak');
  const prev = +$('#streakNum').textContent;
  $('#streakNum').textContent = n;
  el.classList.toggle('on', n > 0);
  el.title = n ? `${n}-day streak` : 'Complete a task to start a streak';
  if (n > prev && prev !== 0 || (n === 1 && prev === 0 && lastAllDone !== null)) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  lastAllDone = full;
}

/* ───────────── completion ───────────── */
function toggle(id, origin) {
  const t = S.tasks[id];
  if (!t) return;
  const wasFull = isTodayFull();
  const done = !t.done;
  put({ ...t, done, done_at: done ? nowIso() : null });
  if (!done) return;
  const li = $(`.task[data-id="${id}"]`);
  if (li) { li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop'); }
  const box = origin || (li && $('.check', li));
  const r = box && box.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2, y = r ? r.top + r.height / 2 : innerHeight / 2;
  burst(x, y);
  sfx.pop(S.muted);
  navigator.vibrate && navigator.vibrate(12);
  if (!wasFull && isTodayFull()) setTimeout(allDone, 250);
}
const isTodayFull = () => { const l = dayList(todayKey()); return l.length > 0 && l.every((t) => t.done); };
function allDone() {
  celebrate();
  sfx.fanfare(S.muted);
  navigator.vibrate && navigator.vibrate([15, 40, 15, 40, 30]);
  const msgs = ['Clear day. Nicely done.', 'All done for today. Go enjoy it.', 'Zero left. Beautiful.', 'That’s everything. Well played.'];
  toast(msgs[Math.floor(Math.random() * msgs.length)], { big: true, ms: 4200 });
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
  const small = matchMedia('(max-width:760px)').matches;
  if (!small) {
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 220, r.right - 210)) + 'px';
    const below = r.bottom + 8, h = menu.offsetHeight;
    menu.style.top = (below + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : below) + 'px';
  }
  const t = S.tasks[id];
  $('#menuDate').value = t && t.date || '';
  $('button', menu).focus();
}
function closeMenu(refocus = true) {
  if (menu.hidden) return;
  menu.hidden = true; menuBack.hidden = true;
  if (refocus && menuReturn && menuReturn.isConnected) menuReturn.focus();
  menuId = null;
}
function moveTo(id, date, { append = true } = {}) {
  const t = S.tasks[id];
  if (!t) return;
  put({ ...t, date, position: append ? Date.now() : t.position });
}
function deleteWithUndo(id) {
  const li = $(`.task[data-id="${id}"]`);
  const next = li && (li.nextElementSibling || li.previousElementSibling);
  const t = removeTask(id);
  if (!t) return;
  toast('Task deleted', { action: 'Undo', onAction: () => put(t), ms: 5000 });
  if (next && next.isConnected) $('.title', next).focus({ preventScroll: true });
}
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !menuId) return;
  const id = menuId; closeMenu(false);
  const a = b.dataset.act;
  if (a === 'today') moveTo(id, todayKey());
  else if (a === 'tomorrow') moveTo(id, addDays(todayKey(), 1));
  else if (a === 'someday') moveTo(id, null);
  else if (a === 'delete') deleteWithUndo(id);
});
$('#menuDate').addEventListener('change', (e) => { if (menuId && e.target.value) { const id = menuId; closeMenu(false); moveTo(id, e.target.value); toast('Moved to ' + fmt(e.target.value, { weekday: 'long', month: 'short', day: 'numeric' })); scrollToKeySoon(e.target.value); } });
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
  const li = e.target.closest('.task');
  if (!li) return;
  if (e.target.closest('.check')) return toggle(li.dataset.id, $('.check', li));
  if (e.target.closest('.more')) return openMenu(li.dataset.id, $('.more', li));
  if (e.target.closest('.title') && !drag.moved) startEdit(li);
});
board.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target.closest('.add'); if (!form) return;
  const inp = $('input', form), key = form.closest('.day').dataset.date || null;
  if (addTask(inp.value, key)) { inp.value = ''; const ul = $('.list', form.closest('.day')); ul.scrollTop = 0; }
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
    const a = list[i + (e.key === 'ArrowUp' ? -2 : 1)], b = list[i + (e.key === 'ArrowUp' ? -1 : 2)];
    if (e.key === 'ArrowUp' && !list[i - 1]) return;
    if (e.key === 'ArrowDown' && !list[i + 1]) return;
    const pa = a ? S.tasks[a.dataset.id].position : null, pb = b ? S.tasks[b.dataset.id].position : null;
    const lo = e.key === 'ArrowUp' ? pa : S.tasks[list[i + 1].dataset.id].position;
    const hi = e.key === 'ArrowUp' ? S.tasks[list[i - 1].dataset.id].position : pb;
    const pos = lo == null ? hi - 1000 : hi == null ? lo + 1000 : (lo + hi) / 2;
    put({ ...S.tasks[id], position: pos });
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

/* ───────────── drag & drop (pointer based: mouse + touch long-press) ───────────── */
const drag = { li: null, ghost: null, moved: false, startX: 0, startY: 0, timer: 0, pid: null, dx: 0, dy: 0, touch: false, raf: 0, lastX: 0, lastY: 0, chipTimer: 0 };
board.addEventListener('pointerdown', (e) => {
  const li = e.target.closest('.task');
  if (!li || e.target.closest('.check,.more,input') || (e.pointerType === 'mouse' && e.button !== 0) || li.classList.contains('editing')) return;
  Object.assign(drag, { li, moved: false, startX: e.clientX, startY: e.clientY, pid: e.pointerId, touch: e.pointerType !== 'mouse', lastX: e.clientX, lastY: e.clientY });
  if (drag.touch) drag.timer = setTimeout(() => beginDrag(e), 320);
});
addEventListener('pointermove', (e) => {
  if (!drag.li || e.pointerId !== drag.pid) return;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (!drag.ghost) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (drag.touch) { if (dist > 9) cancelPending(); }
    else if (dist > 5) beginDrag(e);
    return;
  }
  e.preventDefault();
  dragMove();
});
addEventListener('pointerup', (e) => { if (e.pointerId === drag.pid) endDrag(); });
addEventListener('pointercancel', (e) => { if (e.pointerId === drag.pid) endDrag(); });
addEventListener('touchmove', (e) => { if (drag.ghost) e.preventDefault(); }, { passive: false });
addEventListener('contextmenu', (e) => { if (drag.ghost || drag.timer) e.preventDefault(); });
function cancelPending() { clearTimeout(drag.timer); drag.timer = 0; drag.li = null; drag.pid = null; }
function beginDrag(e) {
  clearTimeout(drag.timer); drag.timer = 0;
  const li = drag.li; if (!li) return;
  const r = li.getBoundingClientRect();
  const g = li.cloneNode(true);
  g.className = 'task drag-ghost';
  g.style.width = r.width + 'px';
  drag.dx = drag.startX - r.left; drag.dy = drag.startY - r.top;
  document.body.appendChild(g);
  drag.ghost = g; drag.moved = true;
  li.classList.add('dragging');
  board.classList.add('dragging-active');
  navigator.vibrate && navigator.vibrate(8);
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
  if (x < edge) board.scrollLeft -= 14; else if (x > innerWidth - edge) board.scrollLeft += 14;
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
    const sec = li.closest('.day'), ul = li.parentElement;
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    const t = S.tasks[li.dataset.id];
    ghost.remove();
    li.classList.remove('dragging');
    if (t && sec) {
      const pp = prev ? S.tasks[prev.dataset.id].position : null, np = next ? S.tasks[next.dataset.id].position : null;
      const pos = pp == null && np == null ? Date.now() : pp == null ? np - 1000 : np == null ? Math.max(pp + 1000, Date.now()) : (pp + np) / 2;
      const date = sec.dataset.date || null;
      const todayCol = sec.dataset.key === todayKey();
      const newDate = todayCol && t.date && t.date <= todayKey() ? t.date : date;   // staying in Today keeps its carried date
      put({ ...t, date: todayCol && t.date && t.date < todayKey() ? todayKey() : newDate, position: pos });
    }
    ul && 0;
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
  const mobile = matchMedia('(max-width:760px)').matches;
  board.scrollTo({ left: sec.offsetLeft - (mobile ? 16 : 28), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  setActive(key);
  if (focus) setTimeout(() => $('.add input', sec).focus({ preventScroll: true }), mobile ? 280 : 0);
}
const scrollToKeySoon = (date) => setTimeout(() => $(`.day[data-key="${date}"]`) && scrollToKey(date), 60);
function setActive(key) {
  activeKey = key;
  $$('.chip', strip).forEach((c) => {
    const on = c.dataset.key === key;
    c.classList.toggle('active', on);
    if (on) c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
}
let io;
function observeActive() {
  io && io.disconnect();
  board.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const secs = $$('.day', board);
    const left = board.scrollLeft + 24;
    let best = secs[0];
    for (const s of secs) if (s.offsetLeft - 16 <= left + board.clientWidth * 0.3) best = s;
    if (best && best.dataset.key !== activeKey) setActive(best.dataset.key);
  });
}
function focusAdd(key) {
  const sec = $(`.day[data-key="${key}"]`, board);
  if (!sec) return;
  scrollToKey(key);
  $('.add input', sec).focus({ preventScroll: true });
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) { if (e.key === 'Escape') e.target.blur(); return; }
  if (document.querySelector('dialog[open]') || !menu.hidden) return;
  if (e.target.closest && e.target.closest('.task') && (e.key === 'x' || e.key === 'e')) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); focusAdd(activeKey || 'today'); }
  else if (k === 't') { e.preventDefault(); focusAdd(todayKey()); }
  else if (k === 's') { e.preventDefault(); focusAdd('someday'); }
  else if (k === 'm') { toggleMute(); }
  else if (e.key === '?') { $('#helpSheet').showModal(); }
});

/* ───────────── sound toggle ───────────── */
const ICON_ON = '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
function renderSound() {
  const b = $('#soundBtn');
  b.innerHTML = S.muted ? ICON_OFF : ICON_ON;
  b.setAttribute('aria-pressed', String(!S.muted));
  b.setAttribute('aria-label', S.muted ? 'Sound off' : 'Sound on');
}
function toggleMute() { S.muted = !S.muted; persist(); renderSound(); if (!S.muted) sfx.pop(false); toast(S.muted ? 'Sound off' : 'Sound on', { ms: 1200 }); }
$('#soundBtn').addEventListener('click', toggleMute);
$('#helpBtn').addEventListener('click', () => $('#helpSheet').showModal());
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

/* ───────────── sync ───────────── */
let flushTimer = 0, syncing = false, again = false;
const api = (path, opt = {}) => fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', 'x-passcode': S.passcode, ...(opt.headers || {}) } });
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(sync, 250); }
function setMode(m) { if (S.mode !== m) { S.mode = m; renderSync(); } }
function renderSync() {
  const dot = $('#syncDot');
  dot.className = 'dot ' + ({ sync: S.queue.length ? 'busy' : 'ok', busy: 'busy', local: 'off', locked: 'warn', offline: 'warn' }[S.mode] || 'off');
  const txt = {
    sync: S.queue.length ? `Syncing ${S.queue.length} change${S.queue.length > 1 ? 's' : ''}…` : 'Up to date. Changes sync across your devices.',
    busy: 'Syncing…',
    local: S.passcode ? 'Server storage isn’t set up yet, so tasks are saved on this device only.' : 'Tasks are saved on this device only. Add your passcode to sync.',
    locked: 'The passcode was rejected. Enter it again to sync.',
    offline: `You’re offline. ${S.queue.length} change${S.queue.length === 1 ? '' : 's'} will sync when you’re back.`,
  }[S.mode];
  $('#syncText').textContent = txt;
  $('#syncBtn').title = $('#syncBtn').ariaLabel = 'Sync: ' + txt;
}
async function sync() {
  if (syncing) { again = true; return; }
  if (!S.passcode) return setMode('local');
  if (!navigator.onLine) return setMode('offline');
  syncing = true;
  try {
    // 1. push queued writes (in order)
    while (S.queue.length) {
      const q = S.queue[0];
      const r = q.t === 'put'
        ? await api('/api/tasks', { method: 'POST', body: JSON.stringify(q.task) })
        : await api('/api/tasks?id=' + encodeURIComponent(q.id), { method: 'DELETE' });
      if (r.status === 401) return lock('Passcode not accepted.');
      if (r.status === 503) return setMode('local');
      if (!r.ok && r.status >= 500) throw new Error('server');
      if (!r.ok && r.status !== 404) { console.warn('dropping bad write', await r.text()); }
      S.queue.shift(); persist();
    }
    // 2. pull
    const r = await api('/api/tasks');
    if (r.status === 401) return lock('Passcode not accepted.');
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
  } catch (e) {
    setMode(navigator.onLine ? 'offline' : 'offline');
  } finally {
    syncing = false;
    if (again) { again = false; scheduleFlush(); }
  }
}
setInterval(() => { if (!document.hidden) sync(); }, 15000);
addEventListener('focus', sync);
addEventListener('online', sync);
addEventListener('offline', () => setMode('offline'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); if (builtFor.split('|')[0] !== todayKey()) render(); } });

/* lock / passcode */
const lockDlg = $('#lock');
function lock(msg) {
  setMode('locked');
  S.passcode = ''; persist();
  $('#lockErr').textContent = msg || '';
  if (!lockDlg.open) lockDlg.showModal();
  $('#lockInput').focus();
}
$('#lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#lockInput').value.trim();
  if (!code) return;
  $('#lockGo').disabled = true;
  try {
    const r = await fetch('/api/ping', { headers: { 'x-passcode': code } });
    const j = await r.json();
    if (j.authed) { S.passcode = code; S.skipLock = false; persist(); lockDlg.close(); $('#lockInput').value = ''; $('#lockErr').textContent = ''; sync(); toast('Unlocked. Syncing…', { ms: 1800 }); }
    else $('#lockErr').textContent = 'That passcode doesn’t match.';
  } catch { $('#lockErr').textContent = 'Can’t reach the server. Check your connection.'; }
  $('#lockGo').disabled = false;
});
$('#lockSkip').addEventListener('click', () => { S.skipLock = true; persist(); lockDlg.close(); setMode('local'); });
$('#syncBtn').addEventListener('click', () => { $('#syncSheet').showModal(); sync(); });
$('#syncNow').addEventListener('click', () => { if (!S.passcode) { $('#syncSheet').close(); lockDlg.showModal(); } else { sync(); toast('Syncing…', { ms: 1200 }); $('#syncSheet').close(); } });
$('#syncSignOut').addEventListener('click', () => { $('#syncSheet').close(); lock(''); });

/* ───────────── install ───────────── */
let deferred = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() { $('#installBtn').hidden = standalone() || !(deferred || isIOS); }
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; renderInstall(); });
addEventListener('appinstalled', () => { deferred = null; renderInstall(); toast('Installed. Find Done on your home screen.'); });
matchMedia('(display-mode: standalone)').addEventListener('change', renderInstall);
$('#installBtn').addEventListener('click', async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; renderInstall(); }
  else if (isIOS) $('#iosSheet').showModal();
});

/* ───────────── boot ───────────── */
renderSound();
renderInstall();
render();
if (new URLSearchParams(location.search).has('new')) setTimeout(() => focusAdd('today'), 100);
if (!S.passcode && !S.skipLock) setTimeout(() => { if (!lockDlg.open) { lockDlg.showModal(); } }, 400);
else sync();
setInterval(() => { if (builtFor.split('|')[0] !== todayKey()) render(); }, 60000);
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
window.__done = { S, render };
