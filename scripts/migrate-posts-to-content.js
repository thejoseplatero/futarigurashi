/**
 * Batch migration: convert all existing posts (posts.json + posts/*.html)
 * into the new format: content/<slug>.md with YAML frontmatter + body.
 * Then runs the build so posts/*.html and data/posts.json are regenerated.
 *
 * Usage: node scripts/migrate-posts-to-content.js
 *        node scripts/migrate-posts-to-content.js --dry-run  (write nothing, only report)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const POSTS_JSON = path.join(ROOT, 'data', 'posts.json');
const POSTS_DIR = path.join(ROOT, 'posts');
const CONTENT_DIR = path.join(ROOT, 'content');

const DRY_RUN = process.argv.includes('--dry-run');

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

function buildMarkdownContent(post, body) {
  const title = (post.title || '').trim() || post.slug || 'Untitled';
  const date = (post.date || '').trim() || '';
  const categories = Array.isArray(post.categories) ? post.categories : [];
  const excerpt = (post.excerpt || '').trim();
  let out = '---\n';
  out += 'title: "' + title.replace(/"/g, '\\"') + '"\n';
  out += 'date: ' + date + '\n';
  if (categories.length) {
    out += 'categories:\n';
    categories.forEach((c) => { out += '  - ' + String(c).replace(/\n/g, ' ') + '\n'; });
  }
  if (excerpt) out += 'excerpt: "' + excerpt.replace(/"/g, '\\"').replace(/\n/g, ' ') + '"\n';
  out += '---\n\n' + (body || '').trim() + '\n';
  return out;
}

function main() {
  if (!fs.existsSync(POSTS_JSON)) {
    console.error('Missing', POSTS_JSON);
    process.exit(1);
  }

  let list;
  try {
    list = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
  } catch (e) {
    console.error('Invalid posts.json:', e.message);
    process.exit(1);
  }

  if (!fs.existsSync(CONTENT_DIR)) {
    if (!DRY_RUN) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const post of list) {
    const slug = post.slug;
    if (!slug) {
      fail++;
      console.warn('Skipping post with no slug:', post.title || post);
      continue;
    }

    const htmlPath = path.join(POSTS_DIR, slug + '.html');
    if (!fs.existsSync(htmlPath)) {
      fail++;
      console.warn('Missing HTML:', slug + '.html');
      continue;
    }

    const existingMd = path.join(CONTENT_DIR, slug + '.md');
    if (fs.existsSync(existingMd) && !DRY_RUN) {
      skip++;
      continue;
    }

    const html = fs.readFileSync(htmlPath, 'utf8');
    const body = extractEntryContent(html);

    const content = buildMarkdownContent(post, body);

    if (!DRY_RUN) {
      try {
        fs.writeFileSync(path.join(CONTENT_DIR, slug + '.md'), content, 'utf8');
        ok++;
      } catch (e) {
        fail++;
        console.warn('Write failed', slug + '.md:', e.message);
      }
    } else {
      ok++;
    }
  }

  console.log('Migration: ' + ok + ' written, ' + skip + ' skipped (already in content/), ' + fail + ' failed');

  if (DRY_RUN) {
    console.log('[DRY RUN] No files written. Run without --dry-run to migrate, then run: node scripts/build-from-markdown.js');
    return;
  }

  if (ok > 0 || skip > 0) {
    console.log('Running build-from-markdown.js...');
    const r = spawnSync('node', ['scripts/build-from-markdown.js'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) {
      console.error('Build failed:', r.stderr || r.stdout);
      process.exit(1);
    }
    console.log('Build complete. Posts and data/posts.json have been regenerated from content/.');
  }
}

main();
