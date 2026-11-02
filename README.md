# Done

A calm to-do list organised by topic, in the spirit of TeuxDeux. Installable PWA, works offline, stores tasks in Vercel Blob, and tasks can be added remotely with one HTTP call or one SQL statement.

- **Topic lists**: the main navigation. By default **Personal**, **Investor Relations**, **Social Media**, **Strategy.com** (in that order): columns on desktop, swipeable pages with a switcher on mobile (the header button on mobile switches between one list at a time and all lists stacked). Every task has a `list` id; tasks from before lists existed (and tasks of a deleted list) live in **Personal** (server-side backfill). Move a task with the `⋯` menu / swipe-left **Move** → *Move to*, by dragging it to another column, or with `Alt+←→`.
- **Customizing lists**: lists are stored server-side in the blob doc as `lists: [{id, name, color, order}]`, so every device shows the same names, colors and order (offline edits are queued like task edits). Ids are stable slugs (built-ins `personal`, `ir`, `social`, `website`; a new list gets a slug of its name), so renames never move or break anything.
  - **Rename / recolor**: tap a list's name (column header) or a row in **Settings → Lists**; pick a palette color or any custom hex.
  - **Reorder**: drag a column header sideways on desktop, or drag the ⠿ handles in **Settings → Lists** (touch or mouse; arrow keys on a handle also work). The mobile switcher follows the order.
  - **Add**: **Settings → + Add list** (name + color); it gets its own column, quick-add row and archive.
  - **Delete**: *Delete list* in the list editor (tap twice to confirm). Its tasks, open and archived, move to **Personal**; tasks are never deleted. **Personal** (the fallback) and the last remaining list can't be deleted.
- **Archive**: completing a task plays the usual animation and undo toast; the task then stays in its list, crossed out and sorted to the bottom, for the rest of the day it was completed (America/New_York). Unchecking it during that day simply restores it. Overnight (once the NY date of `done_at` is before today) it moves into that list's **Archive**. The archive is hidden by default; **View archive (N)** at the bottom of each list opens it (newest first, with the completion date and time). Tapping the check on an archived task restores it to the active list (with Undo). Nothing is ever auto-deleted.
- **Due dates (optional)**: `date` is an optional due date that never moves by itself. Undated tasks show no label; otherwise the task shows **Overdue** (past, red), **Due Today** (only when it is actually today) or e.g. **Due Mon, Nov 3**. Set one with natural phrases when adding (`tomorrow`, `friday`, `next week`, `in 3 days`, ... at the start or end of the title, stripped from it) or with the `⋯` menu (*Due* → Today / Tomorrow / Pick a date / No due date). v9 ran a one-time migration that cleared the old "day" on open tasks created before v8 (when every task had a day that auto-rolled forward); the old value is kept in `pre_v9_date`.
- **Quick add**: every list ends with an inline **Add a task…** row. `Enter` adds and keeps focus for rapid entry; a leading/trailing `!` marks it high priority and natural dates set a due date (both stripped from the title). On desktop, typing any letter (or `n` / `/`) anywhere jumps into the quick-add row of the list you were last in (or the first list). There is no floating + button or swipe-up gesture any more.
- **Voice**: tap the mic in a list's quick-add row: the voice sheet opens for that list and records in-app (MediaRecorder; `audio/mp4` on iOS, webm/ogg elsewhere) with a live waveform and timer, and stops when you tap again or after ~1.5 s of silence (max ~60 s). Audio is transcribed by **Groq Whisper** when the server has a key, otherwise by **Whisper-tiny on your device**. One utterance = one task; "and then" / "also" splits it into several with a confirm preview, and dates like "tomorrow" and a leading/trailing "!" are parsed. The sheet's chips can switch the list and due date.
- **Gestures**: swipe a task **right** to complete it (confetti, haptic, undo toast), **left** to reveal Priority / Move / Delete. Long-press (touch) or drag (mouse) to reorder or move between lists. Pull down to refresh.
- **High priority**: mark any number of tasks high priority (swipe left → **Priority**, `⋯` → *Mark high priority*, the `!` key on a focused task, or a leading/trailing `!` when adding, e.g. `!Call the bank` or `Call the bank tomorrow!`; the `!` is stripped from the title). High-priority tasks show a red **!** and sort to the top of their list's open tasks. This replaced the old *Top 3* star; previously starred tasks were migrated to high priority (server-side backfill; `pinned` is kept as a read-only mirror).
- **Dopamine**: animated checkbox, strike-through sweep, confetti burst, haptic tick, soft pop (Settings → Sound), daily streak, progress ring, bigger celebration when today is clear. Honors `prefers-reduced-motion`.
- **Install**: Add to Home Screen button (Chrome `beforeinstallprompt`, a friendly Share → Add to Home Screen sheet on iOS). Hidden once installed. A home-screen long-press shortcut **Add task** opens `/?capture=1`, which focuses Personal's quick-add row (also usable from an iOS Shortcut that opens that URL).
- **Light/dark** follows the system. Safe-area insets, 16px+ inputs (no iOS zoom), big tap targets.
- **Service worker** cache version: `done-v9` (bump `VERSION` in `public/sw.js` and the `?v=` query strings in `index.html` on each release so installed home-screen apps update).
- **Desktop shortcuts**: any letter / `n` / `/` add a task (current list), `?` help, arrows to move between tasks, `Space`/`x` complete, `!` toggle high priority, `Enter`/`e` edit, `Alt+↑↓` reorder, `Alt+←→` move to previous / next list, `Del` delete.

### Insights
- **No rollover (since v9):** due dates stay where you put them; past-due open tasks show *Overdue*. `original_date` / `rollovers` remain on older tasks for the stats but are no longer updated.
- **Analytics fields:** `planned_date` (first scheduled date; set on creation and when you explicitly move a task, never by rollover), `done_at`, `original_date`, `rollovers`. Existing tasks are backfilled with `planned_date = date` and `list = "personal"` when `list` is missing or unknown (additive, nothing is removed or moved between dates) (Someday tasks stay unplanned, so they never count as missed).
- **On time** = `done_at`'s New York date equals `planned_date`. "Last 7 / 30 days" cover the 7 / 30 days *before today* (today is still in progress and is shown separately). **Deleted tasks are excluded** from all stats. Recurring-task instances are counted like any other task (the app has no recurrence feature yet; once instances exist as tasks they are included automatically).
- **Insights** (bar-chart icon in the header): today's completion, on-time 7/30 days, overall completion, streak (current/best), average rollovers per task, a 14/30-day on-time bar chart and a per-weekday breakdown.
- **API:** `curl https://done-todo-rohan-hirani.vercel.app/api/stats` returns all of it as JSON (plus a one-line `summary`).

### Voice: how transcription works
Works in the iOS home-screen app too (it does not use Web Speech). The client probes `GET /api/transcribe` once (cached 6 h) and picks a backend:
1. **Groq (server)**: `POST /api/transcribe` forwards the clip to `whisper-large-v3-turbo` (English). Enable it by setting the env var **`GROQ_API_KEY`** on the Vercel project `done-todo` and redeploying. Without it the route answers `501` and the client silently uses the on-device model. Clips are limited to ~60 s / ~3 MB (Vercel's request limit is 4.5 MB). POST requires login like the rest of the API.
2. **On device**: Transformers.js runs `Xenova/whisper-tiny.en` (q8, WASM; WebGPU when available) in a Web Worker. The first use downloads ~40 MB with a progress bar; files are cached in Cache Storage and the library/wasm by the service worker, so it works offline afterwards.

Notes: iOS asks for microphone permission the first time (and may require a tap to start, so *Voice first* falls back to "tap the mic" when opened without a gesture). A web app **cannot launch Whisper Flow or switch keyboards**; if you prefer it, switch to its keyboard with the 🌐 key and dictate into the capture field. If the mic is blocked, the app shows how to re-enable it.

### Access
The app is behind a simple password gate. The passcode is set via `APP_PASSCODE` (case-insensitive). You enter it once per device: the server sets a 1-year `httpOnly` cookie (`done_auth`, an HMAC of the password keyed with the `DONE_SECRET` env var) and the app remembers it in `localStorage` (`done.auth`). Every device sees the same list because tasks live server-side in Vercel Blob; there is no per-device sync step or prompt.

All `/api/*` routes (`tasks`, `stats`, POST `transcribe`) require that cookie **or** the header `x-passcode` / `Authorization: Bearer` with the same value (set via `APP_PASSCODE`), which is how the assistant, the morning routine and any Scriptable widget talk to the API. Without either they return `401`. `POST /api/login {"password":"..."}` sets the cookie; `DELETE /api/login` logs out. Changing the password: set `APP_PASSCODE` (and optionally rotate `DONE_SECRET`, which logs everyone out) on Vercel and redeploy.

## Architecture

```
public/            static PWA (no build step): index.html, app.js, fx.js (confetti), sound.js, sw.js, manifest, icons
api/tasks.js       GET/POST/PATCH/DELETE  (password cookie or x-passcode header; stores everything in one JSON document in a private Vercel Blob)
api/lists.js       GET/PATCH list names & colors (stored in the same blob doc as data.lists)
api/stats.js       GET productivity stats (on-time rate, streaks, rollovers, daily + weekday breakdown)
api/transcribe.js  POST audio -> text via Groq Whisper (501 without GROQ_API_KEY)
api/login.js       POST password -> long-lived auth cookie
api/ping.js        health check (is server storage configured)
scripts/dev.js     local dev server with an in-memory store  (npm run dev)
scripts/icons.py   regenerates the PNG icons
```

The browser never holds a storage token; the API routes talk to Blob server-side. Access is gated by the password above. The UI is optimistic and local-first: every change is applied instantly, cached in `localStorage` and pushed through an offline-safe write queue. The app polls every 15 s and on focus/online, so tasks added remotely appear on their own.

### Storage

All tasks live in one JSON document (`done/tasks.json`) in a **private Vercel Blob** store (free tier). Writes are guarded by the blob ETag (optimistic concurrency, automatic retry), each task carries `updated_at` and the newest write wins, and deletions leave a tombstone so a stale offline device cannot resurrect a deleted task.

### Environment variables (Vercel)

| name | value |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | added automatically when you connect a Blob store to the project |
| `DONE_SECRET` | HMAC secret for the auth cookie (required in production) |
| `APP_PASSCODE` | the app password (set this in production; there is only a weak built-in fallback for local dev) |
| `APP_TZ` | optional, default `America/New_York`: what "today" means for API calls that omit `date` |

Until a Blob store is connected the app still works fully on-device ("local only") and the API answers `503 storage_not_configured`.

## Add a task remotely

```bash
curl -X POST https://done-todo-rohan-hirani.vercel.app/api/tasks \
  -H "content-type: application/json" -H "x-passcode: $DONE_PASSCODE" \
  -d '{"title":"Call the dentist","date":"tomorrow"}'

curl -X POST https://done-todo-rohan-hirani.vercel.app/api/tasks \
  -H "content-type: application/json" -H "x-passcode: $DONE_PASSCODE" \
  -d '{"title":"Send Q4 investor update","list":"ir","date":null}'
```

`list` is optional: a list id (`personal` (default), `ir`, `social`, `website`, or a user-added list's slug) **or** the list's current display name, case-insensitive (e.g. `"Strategy.com"`, `"Investor Relations"`); ids win if a name ever equals an id. Anything else returns `400` (the error names the current lists). `GET /api/tasks` returns `{tasks, lists}`: `list` (the id) on every task, plus `lists: [{id, name, color, order}]` sorted by order.

Lists: `GET /api/lists` → `{lists}`; `POST /api/lists {"name", "color"?}` adds one (id = slug of the name); `PATCH /api/lists?id=<id or name>` with `{"name"?, "color"?: "#rrggbb"}` renames / recolors (names unique, 1-40 chars); `PUT /api/lists {"order": [ids…]}` reorders; `DELETE /api/lists?id=<id or name>` deletes a list and moves its tasks to Personal (Personal and the last list can't be deleted).

`date` is an optional **due date**: omit it (or send `null` / `"someday"`) for no due date, or send `"today"`, `"tomorrow"` (in `APP_TZ`) or `"YYYY-MM-DD"`. Optional: `source` (e.g. `"assistant"`). A missing/wrong passcode returns `401`. Returns `201 {"task": {...}}`.

`priority` is optional: `"high"` or `"normal"` (default), or a boolean (`"priority": true`, or `"high": true`). `GET` returns `priority` on every task.

Other routes: `GET /api/tasks`, `PATCH /api/tasks?id=<uuid>` (title, list, date, done, position, priority), `DELETE /api/tasks?id=<uuid>`. The app picks up remote changes within ~15 s, or immediately on focus.

## Develop

```bash
npm run dev      # http://localhost:3000, in-memory fake database
```

Deploy: import the repo into Vercel (framework "Other", output directory `public`), create a Blob store (private) and connect it to the project.

## Deployment notes

The Vercel GitHub app must have access to this repo (github.com/settings/installations → Vercel → add `done-todo`) for push-to-deploy. Without that, deploy from the Vercel dashboard/CLI (`vercel --prod`).

| Env var | Purpose |
|---|---|
| `GROQ_API_KEY` | optional: enables server-side voice transcription (Groq Whisper) |
