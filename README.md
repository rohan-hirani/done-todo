# Done

A calm, day-by-day to-do list in the spirit of TeuxDeux. Installable PWA, works offline, syncs through Vercel Blob, and tasks can be added remotely with one HTTP call or one SQL statement.

- **Days**: Today, Tomorrow, then the next days as columns (desktop) or swipeable pages (mobile), plus a **Someday** list. On mobile the default is **Focus** (Today with a big progress ring, swipe between days); the header button switches to an all-days overview.
- **Zero-friction capture**: a floating **+** button, a **swipe up from the bottom** of the screen (mobile), or on desktop **any letter key / `n` / `/`**. The capture sheet opens with the input focused and the keyboard up. `Enter` adds and keeps the sheet open for rapid multi-add; swipe down, tap outside or `Esc` closes. Chips pick Today / Tomorrow / Someday / a date. Natural phrases are parsed and stripped from the title: `tomorrow`, `friday`, `next week`, `this weekend`, `in 3 days`, `someday` (only at the start or end of the title, e.g. "Call mom by friday").
- **Voice**: a big mic button uses the Web Speech API with a live transcript and auto-stop on pause. One utterance = one task; saying "and then" / "also" splits it into several tasks with a confirmation preview. Optional **Voice first** setting (Settings) starts listening as soon as capture opens.
- **Gestures**: swipe a task **right** to complete it (confetti, haptic, undo toast), **left** to reveal Top 3 / Move / Delete. Long-press (touch) or drag (mouse) to reorder or move between days. Pull down to sync. Star up to 3 tasks as the day's **Top 3**.
- **Carried over**: unfinished tasks from past days roll forward into Today with a red "Carried over from…" marker.
- **Dopamine**: animated checkbox, strike-through sweep, confetti burst, haptic tick, soft pop (Settings → Sound), daily streak, progress ring, bigger celebration when today is clear. Honors `prefers-reduced-motion`.
- **Install**: Add to Home Screen button (Chrome `beforeinstallprompt`, a friendly Share → Add to Home Screen sheet on iOS). Hidden once installed. A home-screen long-press shortcut **Add task** opens `/?capture=1`, which opens the capture sheet immediately (also usable from an iOS Shortcut that opens that URL).
- **Light/dark** follows the system. Safe-area insets, 16px+ inputs (no iOS zoom), big tap targets.
- **Desktop shortcuts**: any letter / `n` / `/` capture, `?` help, arrows to move between tasks, `Space`/`x` complete, `Enter`/`e` edit, `Alt+↑↓` reorder, `Alt+←→` change day, `Del` delete.

### Voice and iOS: what a web app can and cannot do
- Web Speech works in Chrome/Android and in desktop Safari/Chrome. **In an iOS home-screen (standalone) app it is generally unavailable**, so the mic button falls back to focusing the text field and shows a hint to use the keyboard's own dictation mic.
- A web app **cannot launch Whisper Flow or switch keyboards**. If Rohan wants Whisper Flow on iPhone, he switches to its keyboard once with the 🌐 (globe) key while the capture field is focused; iOS remembers the last keyboard used per app, so it comes back next time.
- Browsers only raise the on-screen keyboard from a real tap/swipe. Opening via `/?capture=1` from a shortcut focuses the field, but iOS may still need one tap to show the keyboard.

### Access
**The app and `/api/tasks` are open: anyone with the URL can read and edit the list.** There is no passcode, lock screen or setup link. Old `?key=` links are ignored, and an `x-passcode` header is still accepted (and ignored) so existing scripts keep working. Don't share the URL if you don't want others to see your tasks.

## Architecture

```
public/            static PWA (no build step): index.html, app.js, fx.js (confetti), sound.js, sw.js, manifest, icons
api/tasks.js       GET/POST/PATCH/DELETE  (open, no auth; stores everything in one JSON document in a private Vercel Blob)
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
