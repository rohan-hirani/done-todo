# Done

A calm, day-by-day to-do list in the spirit of TeuxDeux. Installable PWA, works offline, syncs through Vercel Blob, and tasks can be added remotely with one HTTP call or one SQL statement.

- **Days**: Today, Tomorrow, then the next days as columns (desktop) or swipeable pages with a day strip (mobile), plus a **Someday** list.
- **Quick add** at the top of every day (`Enter` to add, focus stays put so you can keep typing).
- **Move** a task by dragging (mouse, or long-press on touch), or with the `⋯` menu: Today / Tomorrow / pick a date / Someday. Edit inline, delete with undo, reorder.
- **Carried over**: unfinished tasks from past days roll forward into Today with a red "Carried over from…" marker.
- **Dopamine**: animated checkbox, strike-through sweep, confetti burst, haptic tick, soft pop (mute with `m`), daily streak, a progress ring for today and a bigger celebration when today is clear. Honors `prefers-reduced-motion`.
- **Install**: Add to Home Screen button (Chrome `beforeinstallprompt`, friendly Share → Add to Home Screen sheet on iOS). Hidden once installed.
- **Light/dark** follows the system.
- **Shortcuts**: `n` new, `t` today, `s` someday, `m` mute, `?` help, arrows to move, `Space`/`x` complete, `Enter`/`e` edit, `Alt+↑↓` reorder, `Alt+←→` change day, `Del` delete.

## Architecture

```
public/            static PWA (no build step): index.html, app.js, fx.js (confetti), sound.js, sw.js, manifest, icons
api/tasks.js       GET/POST/PATCH/DELETE  (passcode-protected; stores everything in one JSON document in a private Vercel Blob)
api/ping.js        tells the client whether the server is configured / passcode is valid
scripts/dev.js     local dev server with an in-memory store  (npm run dev, passcode "dev")
scripts/icons.py   regenerates the PNG icons
```

The browser never holds a storage token. It stores a passcode in `localStorage` and sends it as the `x-passcode` header; the API compares it with `APP_PASSCODE`. The UI is optimistic and local-first: every change is applied instantly, cached in `localStorage` and pushed through an offline-safe write queue. The app polls every 15 s and on focus/online, so tasks added remotely appear on their own.

### Storage

All tasks live in one JSON document (`done/tasks.json`) in a **private Vercel Blob** store (free tier). Writes are guarded by the blob ETag (optimistic concurrency, automatic retry), each task carries `updated_at` and the newest write wins, and deletions leave a tombstone so a stale offline device cannot resurrect a deleted task.

### Environment variables (Vercel)

| name | value |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | added automatically when you connect a Blob store to the project |
| `APP_PASSCODE` | the passcode Rohan types once per device |
| `APP_TZ` | optional, default `America/New_York`: what "today" means for API calls that omit `date` |

Until a Blob store is connected the app still works fully on-device ("local only") and the API answers `503 storage_not_configured`.

## Add a task remotely

```bash
curl -X POST https://done-todo-rohan-hirani.vercel.app/api/tasks \
  -H "x-passcode: <APP_PASSCODE>" -H "content-type: application/json" \
  -d '{"title":"Call the dentist","date":"tomorrow"}'
```

`date` may be omitted (= today in `APP_TZ`), `"today"`, `"tomorrow"`, `"YYYY-MM-DD"`, or `null` / `"someday"` for the Someday list. Optional: `source` (e.g. `"assistant"`). A wrong passcode returns `401`. Returns `201 {"task": {...}}`.

Other routes: `GET /api/tasks`, `PATCH /api/tasks?id=<uuid>` (title, date, done, position), `DELETE /api/tasks?id=<uuid>`. The app picks up remote changes within ~15 s, or immediately on focus.

## Develop

```bash
npm run dev      # http://localhost:3000, passcode "dev", in-memory fake database
```

Deploy: import the repo into Vercel (framework "Other", output directory `public`), create a Blob store (private) and connect it to the project, set `APP_PASSCODE`.

## Deployment notes

The Vercel GitHub app must have access to this repo (github.com/settings/installations → Vercel → add `done-todo`) for push-to-deploy. Without that, deploy from the Vercel dashboard/CLI (`vercel --prod`).
