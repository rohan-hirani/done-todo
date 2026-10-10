# Done

A calm, day-by-day to-do list in the spirit of TeuxDeux. Installable PWA, works offline, syncs through Vercel Blob, and tasks can be added remotely with one HTTP call or one SQL statement.

- **Days**: Today, Tomorrow, then the next days as columns (desktop) or swipeable pages (mobile), plus a **Someday** list. On mobile the default is **Focus** (Today with a big progress ring, swipe between days); the header button switches to an all-days overview.
- **Zero-friction capture**: a floating **+** button, a **swipe up from the bottom** of the screen (mobile), or on desktop **any letter key / `n` / `/`**. The capture sheet opens with the input focused and the keyboard up. `Enter` adds and keeps the sheet open for rapid multi-add; swipe down, tap outside or `Esc` closes. Chips pick Today / Tomorrow / Someday / a date. Natural phrases are parsed and stripped from the title: `tomorrow`, `friday`, `next week`, `this weekend`, `in 3 days`, `someday` (only at the start or end of the title, e.g. "Call mom by friday").
- **Voice**: tap the big mic: the app records in-app (MediaRecorder; `audio/mp4` on iOS, webm/ogg elsewhere) with a live waveform and timer, and stops when you tap again or after ~1.5 s of silence (max ~60 s). Audio is transcribed by **Groq Whisper** when the server has a key, otherwise by **Whisper-tiny on your device**. One utterance = one task; "and then" / "also" splits it into several with a confirm preview, and dates like "tomorrow" are parsed. **Voice first** (Settings) starts recording when capture opens.
- **Gestures**: swipe a task **right** to complete it (confetti, haptic, undo toast), **left** to reveal Top 3 / Move / Delete. Long-press (touch) or drag (mouse) to reorder or move between days. Pull down to sync. Star up to 3 tasks as the day's **Top 3**.
- **Carried over**: unfinished tasks from past days roll forward into Today with a red "Carried over from…" marker.
- **Dopamine**: animated checkbox, strike-through sweep, confetti burst, haptic tick, soft pop (Settings → Sound), daily streak, progress ring, bigger celebration when today is clear. Honors `prefers-reduced-motion`.
- **Install**: Add to Home Screen button (Chrome `beforeinstallprompt`, a friendly Share → Add to Home Screen sheet on iOS). Hidden once installed. A home-screen long-press shortcut **Add task** opens `/?capture=1`, which opens the capture sheet immediately (also usable from an iOS Shortcut that opens that URL).
- **Light/dark** follows the system. Safe-area insets, 16px+ inputs (no iOS zoom), big tap targets.
- **Desktop shortcuts**: any letter / `n` / `/` capture, `?` help, arrows to move between tasks, `Space`/`x` complete, `Enter`/`e` edit, `Alt+↑↓` reorder, `Alt+←→` change day, `Del` delete.

### Auto-rollover and insights
- **Rollover:** any not-done task dated before today (America/New_York) moves to today. The server does it lazily on `GET /api/tasks` (and on any write); the client does the same at midnight/on focus. The task keeps `original_date` (first planned date) and `rollovers` (days carried) and shows a "Carried over from…" marker. Done tasks and Someday tasks never move.
- **Analytics fields:** `planned_date` (first scheduled date; set on creation and when you explicitly move a task, never by rollover), `done_at`, `original_date`, `rollovers`. Existing tasks are backfilled with `planned_date = date` (Someday tasks stay unplanned, so they never count as missed).
- **On time** = `done_at`'s New York date equals `planned_date`. "Last 7 / 30 days" cover the 7 / 30 days *before today* (today is still in progress and is shown separately). **Deleted tasks are excluded** from all stats. Recurring-task instances are counted like any other task (the app has no recurrence feature yet; once instances exist as tasks they are included automatically).
- **Insights** (bar-chart icon in the header): today's completion, on-time 7/30 days, overall completion, streak (current/best), average rollovers per task, a 14/30-day on-time bar chart and a per-weekday breakdown.
- **API:** `curl https://done-todo-rohan-hirani.vercel.app/api/stats` returns all of it as JSON (plus a one-line `summary`).

### Voice: how transcription works
Works in the iOS home-screen app too (it does not use Web Speech). The client probes `GET /api/transcribe` once (cached 6 h) and picks a backend:
1. **Groq (server)**: `POST /api/transcribe` forwards the clip to `whisper-large-v3-turbo` (English). Enable it by setting the env var **`GROQ_API_KEY`** on the Vercel project `done-todo` and redeploying. Without it the route answers `501` and the client silently uses the on-device model. Clips are limited to ~60 s / ~3 MB (Vercel's request limit is 4.5 MB). Like the rest of the API this route is open, so anyone with the URL could use your Groq quota.
2. **On device**: Transformers.js runs `Xenova/whisper-tiny.en` (q8, WASM; WebGPU when available) in a Web Worker. The first use downloads ~40 MB with a progress bar; files are cached in Cache Storage and the library/wasm by the service worker, so it works offline afterwards.

Notes: iOS asks for microphone permission the first time (and may require a tap to start, so *Voice first* falls back to "tap the mic" when opened without a gesture). A web app **cannot launch Whisper Flow or switch keyboards**; if you prefer it, switch to its keyboard with the 🌐 key and dictate into the capture field. If the mic is blocked, the app shows how to re-enable it.

### Access
**The app and `/api/tasks` are open: anyone with the URL can read and edit the list.** There is no passcode, lock screen or setup link. Old `?key=` links are ignored, and an `x-passcode` header is still accepted (and ignored) so existing scripts keep working. Don't share the URL if you don't want others to see your tasks.

## Architecture

```
public/            static PWA (no build step): index.html, app.js, fx.js (confetti), sound.js, sw.js, manifest, icons
api/tasks.js       GET/POST/PATCH/DELETE  (open, no auth; stores everything in one JSON document in a private Vercel Blob)
api/stats.js       GET productivity stats (on-time rate, streaks, rollovers, daily + weekday breakdown)
api/transcribe.js  POST audio -> text via Groq Whisper (501 without GROQ_API_KEY)
api/ping.js        health check (is server storage configured)
scripts/dev.js     local dev server with an in-memory store  (npm run dev)
scripts/icons.py   regenerates the PNG icons
```

The browser never holds a storage token; the API routes talk to Blob server-side. There is no authentication. The UI is optimistic and local-first: every change is applied instantly, cached in `localStorage` and pushed through an offline-safe write queue. The app polls every 15 s and on focus/online, so tasks added remotely appear on their own.

### Storage

All tasks live in one JSON document (`done/tasks.json`) in a **private Vercel Blob** store (free tier). Writes are guarded by the blob ETag (optimistic concurrency, automatic retry), each task carries `updated_at` and the newest write wins, and deletions leave a tombstone so a stale offline device cannot resurrect a deleted task.

### Environment variables (Vercel)

| name | value |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | added automatically when you connect a Blob store to the project |
| `APP_TZ` | optional, default `America/New_York`: what "today" means for API calls that omit `date` |

Until a Blob store is connected the app still works fully on-device ("local only") and the API answers `503 storage_not_configured`.

## Add a task remotely

```bash
curl -X POST https://done-todo-rohan-hirani.vercel.app/api/tasks \
  -H "content-type: application/json" \
  -d '{"title":"Call the dentist","date":"tomorrow"}'
```

`date` may be omitted (= today in `APP_TZ`), `"today"`, `"tomorrow"`, `"YYYY-MM-DD"`, or `null` / `"someday"` for the Someday list. Optional: `source` (e.g. `"assistant"`). A wrong passcode returns `401`. Returns `201 {"task": {...}}`.

Other routes: `GET /api/tasks`, `PATCH /api/tasks?id=<uuid>` (title, date, done, position), `DELETE /api/tasks?id=<uuid>`. The app picks up remote changes within ~15 s, or immediately on focus.

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
