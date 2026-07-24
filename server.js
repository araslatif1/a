/**
 * server.js
 * -----------------------------------------------------------------------
 * A tiny, dependency-free local server for the HTML Documentation Viewer.
 *
 * Why this exists:
 *   Browsers cannot list the contents of a local folder from plain
 *   JavaScript (for security reasons, especially over file://). To satisfy
 *   requirement #7/#8 (auto-detecting new/removed/renamed .html files)
 *   we run this tiny server which:
 *
 *     1. Serves the static files in this folder (index.html, style.css,
 *        script.js, config.json, page*.html, ...).
 *     2. Exposes GET /api/files -> a fresh JSON snapshot of every .html
 *        file in the folder (except index.html), including its <title>
 *        (parsed from the file) and last-modified timestamp.
 *
 * No npm install, no external dependencies -- only Node's built-in
 * "http", "fs", "path", and "url" modules are used.
 *
 * Run with:  node server.js
 * Then open: http://localhost:8080
 * -----------------------------------------------------------------------
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT_DIR = __dirname;
const PORT = process.env.PORT || 8080;

// Basic content-type map for the file types this project uses.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Pull the <title>...</title> text out of an HTML file's contents.
 * Falls back to a "prettified" version of the filename if no title
 * tag is present.
 */
function extractTitle(htmlContent, fileName) {
  const match = htmlContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  // Fallback: "page1.html" -> "Page1"
  const base = fileName.replace(/\.html?$/i, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Scan the root directory for .html files (excluding index.html),
 * read each one to grab its <title>, and return an array of
 * { file, title, mtime } objects. This is recomputed on every
 * request, so renames/adds/removals are picked up immediately.
 */
function listHtmlPages() {
  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => /\.html?$/i.test(entry.name))
    .filter((entry) => entry.name.toLowerCase() !== 'index.html')
    .map((entry) => {
      const fullPath = path.join(ROOT_DIR, entry.name);
      const stats = fs.statSync(fullPath);
      let title = entry.name;
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        title = extractTitle(content, entry.name);
      } catch (err) {
        // If the file vanished between readdir and readFile (race
        // condition from a rename/delete happening live), just skip
        // gracefully by keeping the filename as the title.
      }
      return {
        file: entry.name,
        title,
        mtime: stats.mtime.toISOString(),
      };
    });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // ---- API endpoint -----------------------------------------------
  if (pathname === '/api/files') {
    try {
      const pages = listHtmlPages();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        // Never cache this - the whole point is live freshness.
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(pages));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to list files', detail: String(err) }));
    }
    return;
  }

  // ---- Static file serving -----------------------------------------
  if (pathname === '/') pathname = '/index.html';

  // Prevent path traversal (e.g. /../../etc/passwd)
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`HTML Documentation Viewer running at http://localhost:${PORT}`);
  console.log(`Serving files from: ${ROOT_DIR}`);
});
