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

const PORT = parseInt(process.env.PORT || '3765', 10);
const BIND = process.env.BIND || '0.0.0.0';
const REPO_ROOT = path.resolve(process.env.REPO_ROOT || __dirname);
const WRITER_BASE = (process.env.WRITER_BASE || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://thejoseplatero.github.io/futarigurashi').replace(/\/$/, '');
const WRITER_MODE = process.env.WRITER_MODE || (WRITER_BASE.includes('localhost') || WRITER_BASE.includes('127.0.0.1') ? 'local' : 'server');

const POSTS_DIR = path.join(REPO_ROOT, 'posts');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const DRAFTS_DIR = path.join(REPO_ROOT, 'drafts');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const POSTS_JSON = path.join(DATA_DIR, 'posts.json');

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
        meta.categories = [v];
        if (v) list = meta.categories;
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

function getPost(slug) {
  const safeSlug = slugify(slug) || 'post';
  for (const dir of [DRAFTS_DIR, CONTENT_DIR]) {
    const filePath = path.join(dir, safeSlug + '.md');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      return {
        slug: safeSlug,
        title: meta.title || safeSlug,
        date: meta.date || '',
        categories: meta.categories || [],
        excerpt: meta.excerpt || '',
        body,
        status: dir === DRAFTS_DIR ? 'draft' : 'published'
      };
    }
  }
  return null;
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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

  if (pathname === '/api/posts') {
    if (req.method === 'GET') {
      jsonResponse(res, 200, listPosts());
      return;
    }
  }

  if (pathname.startsWith('/api/posts/')) {
    const suffix = pathname.slice('/api/posts/'.length);
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
        let data;
        try {
          data = JSON.parse(body);
        } catch (e) {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }
        const slug = slugify(data.slug || data.title) || 'post';
        const content = buildMarkdownContent({ ...data, draft: false });
        fs.mkdirSync(CONTENT_DIR, { recursive: true });
        const draftPath = path.join(DRAFTS_DIR, slug + '.md');
        if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
        try {
          fs.writeFileSync(path.join(CONTENT_DIR, slug + '.md'), content, 'utf8');
        } catch (err) {
          jsonResponse(res, 500, { error: err.message });
          return;
        }
        const buildResult = runBuild();
        if (!buildResult.ok) {
          jsonResponse(res, 500, { error: 'Build failed', detail: buildResult.stderr });
          return;
        }
        const pushResult = runGitPush('Publish: ' + (data.title || slug));
        if (!pushResult.ok) {
          jsonResponse(res, 500, { error: 'Push failed', detail: pushResult.error });
          return;
        }
        jsonResponse(res, 200, { slug, published: true });
      });
      return;
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
      const slug = slugify(suffix) || 'post';
      let removed = false;
      for (const dir of [DRAFTS_DIR, CONTENT_DIR]) {
        const filePath = path.join(dir, slug + '.md');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed = true;
          if (dir === CONTENT_DIR) {
            const buildResult = runBuild();
            if (!buildResult.ok) {
              jsonResponse(res, 500, { error: 'Build failed after delete', detail: buildResult.stderr });
              return;
            }
            const pushResult = runGitPush('Delete post: ' + slug);
            if (!pushResult.ok) {
              jsonResponse(res, 500, { error: 'Push failed', detail: pushResult.error });
              return;
            }
          }
          break;
        }
      }
      if (removed) {
        jsonResponse(res, 200, { deleted: true, slug });
      } else {
        jsonResponse(res, 404, { error: 'Not found' });
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
