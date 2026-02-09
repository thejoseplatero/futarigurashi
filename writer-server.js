/**
 * Writer server: run so the writer UI can save .md files and (later) publish to GitHub.
 * Usage: node writer-server.js
 * Then open the URL shown (e.g. http://localhost:3765/writer.html)
 *
 * Config via environment (defaults = localhost; override for server):
 *   PORT          - port to listen on (default 3765)
 *   BIND          - host to bind: "0.0.0.0" = all interfaces (server), "127.0.0.1" = local only
 *   WRITER_BASE   - base URL of this writer app, e.g. https://writer.example.com
 *   SITE_URL      - public blog URL for "View site" link, e.g. https://thejoseplatero.github.io/futarigurashi
 *   REPO_ROOT     - path to repo (default: this directory); used for build/git when you add publish
 *   WRITER_MODE   - "local" | "server" (optional; auto-detected from WRITER_BASE if not set)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
let marked;
try {
  marked = require('marked').marked;
} catch (e) {
  marked = null;
}

const PORT = parseInt(process.env.PORT || '3765', 10);
const BIND = process.env.BIND || '0.0.0.0';
const REPO_ROOT = path.resolve(process.env.REPO_ROOT || __dirname);
const WRITER_BASE = (process.env.WRITER_BASE || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://thejoseplatero.github.io/futarigurashi').replace(/\/$/, '');
const WRITER_MODE = process.env.WRITER_MODE || (WRITER_BASE.includes('localhost') || WRITER_BASE.includes('127.0.0.1') ? 'local' : 'server');

const POSTS_DIR = path.join(REPO_ROOT, 'posts');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const DRAFTS_DIR = path.join(REPO_ROOT, 'drafts');
const REVISIONS_DIR = path.join(REPO_ROOT, 'revisions');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const POSTS_JSON = path.join(DATA_DIR, 'posts.json');

const MAX_REVISIONS_PER_POST = 50;

function saveRevision(slug, markdownContent, label) {
  const dir = path.join(REVISIONS_DIR, slug.replace(/\.\./g, '').replace(/\//g, ''));
  if (!dir || dir === REVISIONS_DIR) return;
  fs.mkdirSync(dir, { recursive: true });
  const id = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const file = path.join(dir, id + '.md');
  fs.writeFileSync(file, markdownContent, 'utf8');
  const indexPath = path.join(dir, 'index.json');
  let list = [];
  if (fs.existsSync(indexPath)) {
    try {
      list = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (e) {}
  }
  list.push({ id, date: new Date().toISOString(), label: label || 'Save' });
  list = list.slice(-MAX_REVISIONS_PER_POST);
  fs.writeFileSync(indexPath, JSON.stringify(list, null, 2), 'utf8');
  return id;
}

function slugify(str) {
  return String(str || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'post';
}

function parseFrontmatter(raw) {
  const match = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const front = match[1];
  const body = match[2].trimEnd();
  const meta = {};
  let list = null;
  for (const line of front.split(/\r?\n/)) {
    if (/^\s+-\s+/.test(line) && list !== null) {
      list.push(line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
      continue;
    }
    list = null;
    const kv = line.match(/^([a-z]+):\s*(.*)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      const v = kv[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'categories') {
        meta.categories = v ? [v] : [];
        list = meta.categories;
      } else {
        meta[key] = v;
      }
    }
  }
  if (meta.categories && Array.isArray(meta.categories)) {
    meta.categories = meta.categories.filter(Boolean);
  } else if (meta.categories && typeof meta.categories === 'string') {
    meta.categories = meta.categories.split(',').map((c) => c.trim()).filter(Boolean);
  } else if (!Array.isArray(meta.categories)) {
    meta.categories = [];
  }
  return { meta, body };
}

function buildMarkdownContent(data) {
  const title = (data.title || '').trim() || 'Untitled';
  const date = (data.date || '').trim() || new Date().toISOString().slice(0, 10);
  const categories = Array.isArray(data.categories) ? data.categories : (data.categories ? String(data.categories).split(',').map((c) => c.trim()).filter(Boolean) : []);
  const excerpt = (data.excerpt || '').trim();
  const body = (data.body || '').trim();
  let out = '---\n';
  out += 'title: "' + title.replace(/"/g, '\\"') + '"\n';
  out += 'date: ' + date + '\n';
  if (data.draft !== undefined) out += 'draft: ' + (data.draft ? 'true' : 'false') + '\n';
  if (categories.length) {
    out += 'categories:\n';
    categories.forEach((c) => { out += '  - ' + c + '\n'; });
  }
  if (excerpt) out += 'excerpt: "' + excerpt.replace(/"/g, '\\"').replace(/\n/g, ' ') + '"\n';
  out += '---\n\n' + body + '\n';
  return out;
}

function escapeHtmlPreview(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateYMD(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function formatDateRel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const months = Math.floor((now - d) / (30 * 24 * 60 * 60 * 1000));
  if (months < 1) return 'recently';
  if (months < 12) return months + ' months ago';
  return Math.floor(months / 12) + ' year' + (months >= 24 ? 's' : '') + ' ago';
}

function markdownToHtml(text) {
  if (marked) return marked.parse(String(text || ''), { async: false });
  return String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>\n');
}

function buildPreviewHtml(data) {
  const slug = (data.slug || 'post').replace(/\.\./g, '').replace(/\//g, '');
  const title = (data.title || '').trim() || 'Untitled';
  const dateStr = (data.date || '').trim() || new Date().toISOString().slice(0, 10);
  const categories = Array.isArray(data.categories) ? data.categories : (data.categories ? String(data.categories).split(',').map((c) => c.trim()).filter(Boolean) : []);
  const excerpt = (data.excerpt || '').trim();
  const contentHtml = markdownToHtml(data.body || '');
  const isoDate = formatDateYMD(dateStr);
  const dateRel = formatDateRel(dateStr);
  const meta = categories.length ? escapeHtmlPreview(categories.join(', ')) + ' · <time datetime="' + isoDate + '">' + dateRel + '</time>' : '<time datetime="' + isoDate + '">' + dateRel + '</time>';
  const desc = (excerpt || title).slice(0, 155).replace(/\s+/g, ' ').trim();
  const base = WRITER_BASE + '/';
  const SITE_NAME = 'FUTARIGURASHI';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtmlPreview(desc)}">
  <title>${escapeHtmlPreview(title)} — ${SITE_NAME}</title>
  <link rel="stylesheet" href="${base}styles.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Libre+Baskerville:ital@0;1&display=swap" rel="stylesheet">
</head>
<body>
  <div class="site-wrap">
    <header class="site-header">
      <h1 class="site-title"><a href="${base}index.html">${SITE_NAME}</a></h1>
      <nav class="header-nav">
        <a href="${base}archive.html" class="nav-link">記事一覧</a>
        <a href="${base}profile.html" class="nav-link">プロフィール</a>
      </nav>
    </header>
    <main class="main">
      <article class="entry">
        <header class="page-header">
          <a href="${base}index.html" class="back-link">← 最新記事へ</a>
          <p class="entry-meta">${meta}</p>
          <h2 class="entry-title">${escapeHtmlPreview(title)}</h2>
        </header>
        <div class="entry-content">
${contentHtml}
        </div>
      </article>
    </main>
    <footer class="site-footer">
      <p class="footer-flag" aria-hidden="true">🇨🇦</p>
      <p class="copyright">${SITE_NAME}</p>
    </footer>
  </div>
</body>
</html>`;
}

function serveFile(filePath, res) {
  const full = path.join(__dirname, filePath);
  const ext = path.extname(full);
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.md': 'text/markdown'
  };
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function jsonResponse(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function listPosts() {
  const list = [];
  if (fs.existsSync(POSTS_JSON)) {
    try {
      const published = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
      published.forEach((p) => list.push({ ...p, status: 'published' }));
    } catch (e) {
      // ignore
    }
  }
  if (fs.existsSync(DRAFTS_DIR)) {
    fs.readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.md')).forEach((file) => {
      const slug = file.slice(0, -3);
      if (list.some((p) => p.slug === slug)) return;
      try {
        const raw = fs.readFileSync(path.join(DRAFTS_DIR, file), 'utf8');
        const { meta } = parseFrontmatter(raw);
        list.push({
          slug,
          title: meta.title || slug,
          date: meta.date || '',
          dateRel: '',
          categories: meta.categories || [],
          excerpt: meta.excerpt || '',
          status: 'draft'
        });
      } catch (e) {
        list.push({ slug, title: slug, date: '', dateRel: '', categories: [], excerpt: '', status: 'draft' });
      }
    });
  }
  list.sort((a, b) => {
    const da = new Date(a.date || 0).getTime();
    const db = new Date(b.date || 0).getTime();
    return db - da;
  });
  return list;
}

/** Extract inner HTML of first <div class="entry-content"> (match closing div by depth). */
function extractEntryContent(html) {
  const startTag = '<div class="entry-content">';
  const idx = html.indexOf(startTag);
  if (idx === -1) return '';
  let start = html.indexOf('>', idx) + 1;
  let depth = 1;
  let pos = start;
  const len = html.length;
  while (depth > 0 && pos < len) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(start, nextClose).trim();
      }
      pos = nextClose + 6;
    }
  }
  return '';
}

/** Load published post from posts.json + posts/slug.html when no .md in drafts/content. */
function getPostFromPublished(safeSlug) {
  if (!fs.existsSync(POSTS_JSON)) return null;
  let list;
  try {
    list = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
  } catch (e) {
    return null;
  }
  const found = list.find((p) => p.slug === safeSlug);
  if (!found) return null;
  const htmlPath = path.join(POSTS_DIR, safeSlug + '.html');
  if (!fs.existsSync(htmlPath)) return null;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const body = extractEntryContent(html);
  return {
    slug: found.slug,
    title: found.title || found.slug,
    date: found.date || '',
    categories: found.categories || [],
    excerpt: found.excerpt || '',
    body,
    status: 'published'
  };
}

function getPost(slug) {
  const safeSlug = slugify(slug) || 'post';
  // After migration, published posts live in content/<slug>.md; drafts in drafts/<slug>.md.
  for (const dir of [DRAFTS_DIR, CONTENT_DIR]) {
    const filePath = path.join(dir, safeSlug + '.md');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const fileSlug = path.basename(filePath, '.md');
      return {
        slug: fileSlug,
        title: meta.title || fileSlug,
        date: meta.date || '',
        categories: meta.categories || [],
        excerpt: meta.excerpt || '',
        body,
        status: dir === DRAFTS_DIR ? 'draft' : 'published'
      };
    }
  }
  return getPostFromPublished(safeSlug);
}

function runBuild() {
  const r = spawnSync('node', ['scripts/build-from-markdown.js'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, stderr: r.stderr, stdout: r.stdout };
}

function runGitPush(message) {
  spawnSync('git', ['add', '-A'], { cwd: REPO_ROOT });
  const commit = spawnSync('git', ['commit', '-m', message], { cwd: REPO_ROOT });
  if (commit.status !== 0 && commit.stderr && !commit.stderr.includes('nothing to commit')) {
    return { ok: false, error: commit.stderr.trim() || 'git commit failed' };
  }
  const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: REPO_ROOT, timeout: 60000 });
  return { ok: push.status === 0, error: push.stderr ? push.stderr.trim() : (push.status !== 0 ? 'git push failed' : '') };
}

function handleSave(body, res) {
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    jsonResponse(res, 400, { error: 'Invalid JSON' });
    return;
  }
  const slug = (data.slug || 'post').replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/gi, '-').replace(/-+/g, '-') || 'post';
  const filename = slug + '.md';
  const filePath = path.join(POSTS_DIR, filename);

  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  fs.writeFile(filePath, data.content || '', 'utf8', (err) => {
    if (err) {
      jsonResponse(res, 500, { error: err.message });
      return;
    }
    jsonResponse(res, 200, { path: 'posts/' + filename });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = (req.url || '').split('?')[0];

  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      jsonResponse(res, 200, { baseUrl: WRITER_BASE, siteUrl: SITE_URL, mode: WRITER_MODE });
      return;
    }
  }

  if (pathname === '/api/preview' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const html = buildPreviewHtml(data);
        jsonResponse(res, 200, { html });
      } catch (e) {
        jsonResponse(res, 400, { error: 'Invalid JSON', detail: e.message });
      }
    });
    return;
  }

  if (pathname === '/api/posts') {
    if (req.method === 'GET') {
      jsonResponse(res, 200, listPosts());
      return;
    }
  }

  if (pathname.startsWith('/api/posts/')) {
    let suffix = pathname.slice('/api/posts/'.length);
    try {
      suffix = decodeURIComponent(suffix);
    } catch (e) {
      // leave suffix as-is if decoding fails
    }
    if (suffix === 'draft' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch (e) {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }
        const slug = slugify(data.slug || data.title) || 'post';
        const content = buildMarkdownContent({ ...data, draft: true });
        fs.mkdirSync(DRAFTS_DIR, { recursive: true });
        try {
          fs.writeFileSync(path.join(DRAFTS_DIR, slug + '.md'), content, 'utf8');
          jsonResponse(res, 200, { slug, path: 'drafts/' + slug + '.md' });
        } catch (err) {
          jsonResponse(res, 500, { error: err.message });
        }
      });
      return;
    }
    if (suffix === 'publish' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          let data;
          try {
            data = JSON.parse(body);
          } catch (e) {
            jsonResponse(res, 400, { error: 'Invalid JSON' });
            return;
          }
          const slug = slugify(data.slug || data.title) || 'post';
          const contentPath = path.join(CONTENT_DIR, slug + '.md');
          if (fs.existsSync(contentPath)) {
            const existing = fs.readFileSync(contentPath, 'utf8');
            saveRevision(slug, existing, 'Publish');
          }
          const content = buildMarkdownContent({ ...data, draft: false });
          fs.mkdirSync(CONTENT_DIR, { recursive: true });
          const draftPath = path.join(DRAFTS_DIR, slug + '.md');
          if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
          fs.writeFileSync(contentPath, content, 'utf8');
          const buildResult = runBuild();
          if (!buildResult.ok) {
            jsonResponse(res, 500, { error: 'Build failed', detail: buildResult.stderr });
            return;
          }
          const pushResult = runGitPush('Publish: ' + (data.title || slug));
          if (!pushResult.ok) {
            console.error('Push failed after publish:', pushResult.error);
            jsonResponse(res, 200, { slug, published: true, pushWarning: pushResult.error });
          } else {
            jsonResponse(res, 200, { slug, published: true });
          }
        } catch (err) {
          console.error('Publish error:', err);
          jsonResponse(res, 500, { error: 'Publish failed', detail: err.message });
        }
      });
      return;
    }
    if (suffix.includes('/revert-to-draft') && req.method === 'POST') {
      const parts = suffix.split('/');
      const slug = (parts[0] || '').replace(/\.\./g, '').replace(/\//g, '').trim() || 'post';
      if (parts[1] === 'revert-to-draft') {
        const contentPath = path.join(CONTENT_DIR, slug + '.md');
        if (!fs.existsSync(contentPath)) {
          jsonResponse(res, 404, { error: 'Not found' });
          return;
        }
        const raw = fs.readFileSync(contentPath, 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const asDraft = buildMarkdownContent({
          title: meta.title || slug,
          date: meta.date || '',
          categories: meta.categories || [],
          excerpt: meta.excerpt || '',
          body,
          draft: true
        });
        fs.mkdirSync(DRAFTS_DIR, { recursive: true });
        fs.writeFileSync(path.join(DRAFTS_DIR, slug + '.md'), asDraft, 'utf8');
        fs.unlinkSync(contentPath);
        const buildResult = runBuild();
        if (!buildResult.ok) {
          console.error('Build failed after revert-to-draft:', buildResult.stderr);
        }
        jsonResponse(res, 200, { slug, reverted: true });
        return;
      }
    }
    if (suffix.includes('/revisions')) {
      const parts = suffix.split('/');
      const revSlug = (parts[0] || '').replace(/\.\./g, '').replace(/\//g, '').trim() || 'post';
      const revDir = path.join(REVISIONS_DIR, revSlug);
      if (parts[1] === 'revisions' && parts.length >= 2) {
        if (req.method === 'GET' && parts.length === 2) {
          const indexPath = path.join(revDir, 'index.json');
          let list = [];
          if (fs.existsSync(indexPath)) {
            try {
              list = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            } catch (e) {}
          }
          list.reverse();
          jsonResponse(res, 200, list);
          return;
        }
        if (req.method === 'GET' && parts.length === 3) {
          const id = (parts[2] || '').replace(/\.\./g, '').replace(/\//g, '');
          const file = path.join(revDir, id + '.md');
          if (!fs.existsSync(file)) {
            jsonResponse(res, 404, { error: 'Not found' });
            return;
          }
          const raw = fs.readFileSync(file, 'utf8');
          const { meta, body } = parseFrontmatter(raw);
          jsonResponse(res, 200, { slug: revSlug, title: meta.title, date: meta.date, categories: meta.categories || [], excerpt: meta.excerpt || '', body });
          return;
        }
      }
    }
    if (suffix.includes('/restore') && req.method === 'POST') {
      const parts = suffix.split('/');
      const restSlug = (parts[0] || '').replace(/\.\./g, '').replace(/\//g, '').trim() || 'post';
      if (parts[1] === 'restore') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let data;
          try {
            data = JSON.parse(body);
          } catch (e) {
            jsonResponse(res, 400, { error: 'Invalid JSON' });
            return;
          }
          const revisionId = (data.revisionId || '').replace(/\.\./g, '').replace(/\//g, '');
          const revDir = path.join(REVISIONS_DIR, restSlug);
          const file = path.join(revDir, revisionId + '.md');
          if (!fs.existsSync(file)) {
            jsonResponse(res, 404, { error: 'Revision not found' });
            return;
          }
          const markdown = fs.readFileSync(file, 'utf8');
          const draftPath = path.join(DRAFTS_DIR, restSlug + '.md');
          fs.mkdirSync(DRAFTS_DIR, { recursive: true });
          fs.writeFileSync(draftPath, markdown, 'utf8');
          const { meta, body: postBody } = parseFrontmatter(markdown);
          jsonResponse(res, 200, {
            slug: restSlug,
            title: meta.title || restSlug,
            date: meta.date || '',
            categories: meta.categories || [],
            excerpt: meta.excerpt || '',
            body: postBody,
            status: 'draft'
          });
        });
        return;
      }
    }
    if (req.method === 'GET') {
      const post = getPost(suffix);
      if (post) {
        jsonResponse(res, 200, post);
      } else {
        jsonResponse(res, 404, { error: 'Not found' });
      }
      return;
    }
    if (req.method === 'DELETE') {
      try {
        const normalizedSuffix = suffix.replace(/^\/+|\/+$/g, '').replace(/\.\./g, '').replace(/\//g, '').trim();
        const slugCandidates = [normalizedSuffix, slugify(suffix)].filter(Boolean);
        const seen = new Set();
        const uniq = slugCandidates.filter((s) => {
          if (seen.has(s)) return false;
          seen.add(s);
          return true;
        });
        let removed = false;
        let usedSlug = null;
        for (const dir of [DRAFTS_DIR, CONTENT_DIR]) {
          if (!fs.existsSync(dir)) continue;
          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
          for (const file of files) {
            const fileSlug = file.slice(0, -3);
            const match = uniq.some((c) => c === fileSlug);
            if (match) {
              const filePath = path.join(dir, file);
              fs.unlinkSync(filePath);
              removed = true;
              usedSlug = fileSlug;
              if (dir === CONTENT_DIR) {
                if (fs.existsSync(POSTS_JSON)) {
                  try {
                    let list = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
                    if (Array.isArray(list)) {
                      list = list.filter((p) => p && p.slug !== fileSlug);
                      fs.mkdirSync(DATA_DIR, { recursive: true });
                      fs.writeFileSync(POSTS_JSON, JSON.stringify(list, null, 2), 'utf8');
                    }
                  } catch (e) {
                    console.error('Update posts.json after delete:', e.message);
                  }
                }
                const htmlPath = path.join(POSTS_DIR, fileSlug + '.html');
                if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
                const buildResult = runBuild();
                if (!buildResult.ok) {
                  console.error('Build failed after delete:', buildResult.stderr);
                }
                const pushResult = runGitPush('Delete post: ' + fileSlug);
                if (!pushResult.ok) {
                  console.error('Push failed after delete:', pushResult.error);
                }
              }
              break;
            }
          }
          if (removed) break;
        }
        if (removed) {
          jsonResponse(res, 200, { deleted: true, slug: usedSlug });
        } else {
          jsonResponse(res, 404, { error: 'Not found' });
        }
      } catch (err) {
        console.error('DELETE error:', err);
        jsonResponse(res, 500, { error: 'Delete failed', detail: err.message });
      }
      return;
    }
  }

  if (req.url === '/writer-save') {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => handleSave(body, res));
      return;
    }
  }

  if (req.url === '/' || req.url === '/writer.html') {
    serveFile('writer.html', res);
    return;
  }
  if (req.url.startsWith('/')) {
    serveFile(req.url.slice(1), res);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, BIND, () => {
  const host = BIND === '0.0.0.0' ? (os.hostname() || 'localhost') : BIND;
  const local = BIND === '0.0.0.0' ? ` http://localhost:${PORT}` : '';
  console.log('Writer server running (' + WRITER_MODE + ')');
  console.log('  Writer:  ' + WRITER_BASE + '/writer.html');
  if (local) console.log('  Local:   http://localhost:' + PORT + '/writer.html');
  if (WRITER_MODE === 'server') console.log('  Network: http://' + host + ':' + PORT + '/writer.html');
  console.log('  Site:    ' + SITE_URL);
  console.log('Stop with Ctrl+C.');
});
