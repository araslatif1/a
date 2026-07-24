# HTML Library — GitHub Pages Viewer

A zero-dependency, zero-server HTML page viewer that runs entirely on GitHub Pages. Automatically discovers all `.html` files in your repository using the GitHub API.

## How it works

1. Push this project to a GitHub repository
2. Enable GitHub Pages (Settings → Pages → Source: your branch)
3. Every `.html` file in the repo automatically appears as a card — no manual config needed

## Features

- **Auto-discovery** — uses GitHub Git Trees API to find all `.html` files (including subfolders)
- **Title extraction** — fetches each page to extract its `<title>` tag
- **Last modified dates** — shows when each page was last updated
- **Live search** — filter by title, filename, or path
- **Sort** — alphabetical, newest first, oldest first
- **Dark mode** — toggle with persistent preference (localStorage)
- **Responsive** — works on mobile, tablet, and desktop
- **Glass morphism** — modern translucent card design with backdrop blur
- **Subfolder support** — files in `docs/`, `tutorials/`, etc. are discovered automatically
- **Back to Index** — floating button on every sub-page
- **Error handling** — rate limits, private repos, network errors all handled gracefully
- **Auto-refresh** — polls every 60 seconds for new files

## Project structure

```
/
├── index.html    Minimal HTML shell
├── script.js     All logic — API, DOM, search, sort, theme
├── style.css     Glass morphism theme with light/dark modes
├── *.html        Your content pages
└── README.md     This file
```

## Adding a new page

Just push any `.html` file to the repository. It appears on the index page automatically within 60 seconds. No code changes required.

## Requirements

- Repository must be **public** (or you need a GitHub token)
- Must be hosted on GitHub Pages (`username.github.io/repo-name/`)

## How detection works

The script auto-detects the repository owner and name from the GitHub Pages URL:

```
https://username.github.io/MyRepository/
                           ↓            ↓
                        owner        repo
```

No hardcoded values. No configuration file.