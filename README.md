# HTML Library — Local Documentation Viewer

A lightweight, dependency-free local documentation viewer built with plain
HTML, CSS, and JavaScript, plus a tiny optional Node.js server for live
file discovery. No database, no frameworks, no build step.

## Project structure

```
/
├── index.html      Home page — renders the card grid, search, and sort
├── config.json     All app settings (title, theme, hidden, favorites, sort...)
├── script.js       Shared logic: config loading, discovery, search/sort, theming,
│                   and "Back to Index" button injection
├── style.css       Modern, responsive, light/dark UI
├── server.js       Tiny dependency-free Node.js server (static files + /api/files)
├── page1.html      Sample content page (marked as a favorite)
├── page2.html      Sample content page
├── page3.html      Sample content page
└── README.md       This file
```

## Running it

Browsers cannot list a local folder's contents from plain JavaScript
(especially over `file://`), so this project ships a tiny zero-dependency
Node server that exposes the file list live.

```bash
node server.js
```

Then open **http://localhost:8080** in your browser.

No `npm install` is required — `server.js` only uses Node's built-in
`http`, `fs`, `path`, and `url` modules.

> If you skip the server and open `index.html` directly via `file://`,
> the app will detect that `/api/files` is unreachable and show a banner
> explaining how to start the server. Every other part of the UI
> (theme, layout, injected back button on sub-pages) still works fine
> without the server.

## How automatic discovery works

- `server.js` re-scans the project folder on **every** request to
  `/api/files` — nothing is cached or stored in a database.
- Each `.html` file's `<title>` tag is parsed to use as the card title,
  and the filesystem's last-modified timestamp is included.
- `index.html` polls `/api/files` every few seconds (interval configurable
  via `config.json`'s `pollIntervalMs`). When the response changes —
  because a file was **added**, **removed**, or **renamed** — the grid
  re-renders automatically. No manual editing of any file list is ever
  required.

## Configuration (`config.json`)

```json
{
  "title": "My HTML Library",
  "theme": "light",
  "hidden": [],
  "favorites": ["page1.html"],
  "sort": "alphabetical",
  "showLastModified": true,
  "pollIntervalMs": 3000
}
```

| Key                | Purpose                                                              |
|--------------------|-----------------------------------------------------------------------|
| `title`            | Site title shown in the header and browser tab                        |
| `theme`            | `"light"` or `"dark"` (users can also toggle it live with the 🌙/☀️ button) |
| `hidden`           | Array of filenames to exclude from the index, e.g. `["draft.html"]`   |
| `favorites`        | Array of filenames to star and prioritize when sorting by "Favorites" |
| `sort`             | Default sort mode: `alphabetical`, `newest`, `oldest`, or `favorites`  |
| `showLastModified` | Whether cards display the last-modified date                          |
| `pollIntervalMs`   | How often (ms) the index page checks for file changes                 |

`index.html` never needs manual edits — adding a new page is as simple as
dropping a new `.html` file into the folder.

## Adding a new page

1. Create `myNewPage.html` in the project root (include a `<title>` tag
   and a `<script src="script.js"></script>` before `</body>` so the
   floating "Back to Index" button and theme are applied automatically).
2. Save it. Within `pollIntervalMs` (default 3s), it appears as a new
   card on the index page — no code changes needed.
3. To hide a page instead of deleting it, add its filename to
   `config.json`'s `"hidden"` array.

## Features implemented

- ✅ Auto-detects every `.html` file except `index.html` and files listed in `config.json`'s `hidden` array
- ✅ Cards show title, filename, last-modified date, and an Open button
- ✅ Floating "Back to Index" button on every page (auto-injected via JS if missing)
- ✅ Live search by filename and title
- ✅ Sort by alphabetical / newest / oldest / favorites-first
- ✅ Automatic updates on add / remove / rename (via polling, no manual refresh)
- ✅ Responsive layout, rounded cards, shadows, smooth animations
- ✅ Light & dark mode
- ✅ Zero external libraries, zero database — settings live entirely in `config.json`
