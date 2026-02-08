/**
 * Build site from Markdown in content/ + existing data/posts.json.
 * Merges content/*.md into the post list, regenerates index, page/, archive, sitemap, feed.
 * Does not touch category/ or sidebar (keeps existing WP-import structure).
 * Usage: node scripts/build-from-markdown.js
 * Env: SITE_URL (default https://thejoseplatero.github.io/futarigurashi)
 */

const fs = require('fs');
const path = require('path');
let marked;
try {
  marked = require('marked').marked;
} catch (e) {
  marked = null;
}

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const POSTS_DIR = path.join(ROOT, 'posts');
const DATA_DIR = path.join(ROOT, 'data');
const PAGE_DIR = path.join(ROOT, 'page');
const POSTS_JSON = path.join(DATA_DIR, 'posts.json');
const PER_PAGE = 10;
const SITE_URL = (process.env.SITE_URL || 'https://thejoseplatero.github.io/futarigurashi').replace(/\/$/, '');
const SITE_NAME = 'FUTARIGURASHI';
const OG_IMAGE_URL = SITE_URL + '/images/og-default.png';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return str
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'post';
}

function formatDateRel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const months = Math.floor((now - d) / (30 * 24 * 60 * 60 * 1000));
  if (months < 1) return 'recently';
  if (months < 12) return months + ' months ago';
  const years = Math.floor(months / 12);
  return years + ' year' + (years > 1 ? 's' : '') + ' ago';
}

function formatDateYMD(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function metaDescription(text, maxLen) {
  const stripped = String(text || '').replace(/\s+/g, ' ').trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen).trim().replace(/\s+\S*$/, '') + '…';
}

function buildPostPage(slug, title, dateStr, categories, contentHtml, excerpt) {
  const isoDate = formatDateYMD(dateStr);
  const dateRel = formatDateRel(dateStr);
  const meta = categories.length ? escapeHtml(categories.join(', ')) + ' · <time datetime="' + isoDate + '">' + dateRel + '</time>' : '<time datetime="' + isoDate + '">' + dateRel + '</time>';
  const escapedTitle = escapeHtml(title);
  const desc = metaDescription(excerpt || title, 155);
  const canonicalUrl = SITE_URL + '/posts/' + slug + '.html';
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    datePublished: isoDate,
    dateModified: isoDate,
    author: { '@type': 'Person', name: SITE_NAME },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(desc)}">
  <meta property="og:image" content="${OG_IMAGE_URL}">
  <meta name="twitter:image" content="${OG_IMAGE_URL}">
  <title>${escapedTitle} — ${SITE_NAME}</title>
  <link rel="stylesheet" href="../styles.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Libre+Baskerville:ital@0;1&display=swap" rel="stylesheet">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="site-wrap">
    <header class="site-header">
      <h1 class="site-title"><a href="../index.html">${SITE_NAME}</a></h1>
      <nav class="header-nav">
        <a href="../archive.html" class="nav-link">記事一覧</a>
        <a href="../profile.html" class="nav-link">プロフィール</a>
      </nav>
    </header>

    <main class="main">
      <article class="entry">
        <header class="page-header">
          <a href="../index.html" class="back-link">← 最新記事へ</a>
          <p class="entry-meta">${meta}</p>
          <h2 class="entry-title">${escapedTitle}</h2>
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
</html>
`;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const front = match[1];
  const body = match[2].trimEnd();
  const meta = {};
  let key = null;
  let list = null;
  for (const line of front.split(/\r?\n/)) {
    if (/^\s+-\s+/.test(line) && list !== null) {
      list.push(line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
      continue;
    }
    list = null;
    const kv = line.match(/^([a-z]+):\s*(.*)$/i);
    if (kv) {
      key = kv[1].toLowerCase();
      const v = kv[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'categories') {
        meta.categories = [v];
        if (v) list = meta.categories;
      } else {
        meta[key] = v;
      }
      continue;
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

function getPageNumbers(current, total) {
  if (total <= 1) return [1];
  const windowSize = 2;
  const left = Math.max(2, current - windowSize);
  const right = Math.min(total - 1, current + windowSize);
  const out = [1];
  if (left > 2) out.push('…');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('…');
  if (total > 1) out.push(total);
  return out;
}

function buildPreviews(posts, baseUrl, featuredIndex) {
  const url = (p) => baseUrl + 'posts/' + p.slug + '.html';
  return posts.map((p, i) => {
    const meta = [p.categories.join(', '), p.dateRel].filter(Boolean).join(' · ');
    const excerpt = p.excerpt ? `<p class="post-excerpt">${escapeHtml(p.excerpt)}</p>` : '';
    const excerptClass = featuredIndex === i ? ' post-preview--featured' : '';
    const readMore = `<p class="read-more"><a href="${url(p)}" class="read-more-link">Read more</a></p>`;
    return `        <article class="post-preview${excerptClass}">
          <span class="post-meta">${escapeHtml(meta)}</span>
          <h3 class="post-title"><a href="${url(p)}">${escapeHtml(p.title)}</a></h3>
          ${excerpt}
          ${readMore}
        </article>`;
  }).join('\n');
}

function pageUrl(n, baseUrl) {
  return n === 1 ? baseUrl + 'index.html' : baseUrl + 'page/' + n + '.html';
}

function buildPagination(pageNum, totalPages, baseUrl) {
  const prevLink = pageNum === 1 ? null : pageUrl(pageNum - 1, baseUrl);
  const nextLink = pageNum < totalPages ? pageUrl(pageNum + 1, baseUrl) : null;
  const pageNumbers = getPageNumbers(pageNum, totalPages);
  let nav = '<nav class="pagination" aria-label="Pagination">';
  if (prevLink) nav += `<a href="${prevLink}" class="pagination-link pagination-prev">« Newer</a>`;
  nav += '<span class="pagination-pages">';
  pageNumbers.forEach((n) => {
    if (n === '…') {
      nav += '<span class="pagination-ellipsis" aria-hidden="true">…</span>';
    } else if (n === pageNum) {
      nav += `<span class="pagination-current" aria-current="page">${n}</span>`;
    } else {
      nav += `<a href="${pageUrl(n, baseUrl)}" class="pagination-num">${n}</a>`;
    }
  });
  nav += '</span>';
  if (nextLink) nav += `<a href="${nextLink}" class="pagination-link pagination-next">Older »</a>`;
  nav += '<label class="pagination-goto">Go to page <select class="pagination-select" onchange="if(this.value)window.location.href=this.value">';
  nav += '<option value="">—</option>';
  for (let i = 1; i <= totalPages; i++) {
    nav += `<option value="${pageUrl(i, baseUrl)}"${i === pageNum ? ' selected' : ''}>${i}</option>`;
  }
  nav += '</select></label>';
  nav += '</nav>';
  return nav;
}

function markdownToHtml(text) {
  if (marked) return marked.parse(String(text || ''), { async: false });
  return String(text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>\n');
}

function main() {
  if (!marked) {
    try {
      marked = require('marked').marked;
    } catch (e) {
      console.warn('marked not available, using plain text for body');
    }
  }
  let postsData = [];
  if (fs.existsSync(POSTS_JSON)) {
    try {
      postsData = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));
    } catch (e) {
      console.error('Could not read', POSTS_JSON, e.message);
      process.exit(1);
    }
  }
  const bySlug = new Map(postsData.map((p) => [p.slug, { ...p }]));

  if (fs.existsSync(CONTENT_DIR)) {
    const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const slug = file.slice(0, -3);
      const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      if (meta.draft === true || meta.draft === 'true') continue;
      const title = meta.title || slug;
      const dateStr = meta.date || new Date().toISOString().slice(0, 10);
      const categories = Array.isArray(meta.categories) ? meta.categories : (meta.categories ? [meta.categories] : []);
      const excerpt = meta.excerpt || '';
      const contentHtml = markdownToHtml(body);
      const html = buildPostPage(slug, title, dateStr, categories, contentHtml, excerpt);
      fs.mkdirSync(POSTS_DIR, { recursive: true });
      fs.writeFileSync(path.join(POSTS_DIR, slug + '.html'), html, 'utf8');
      bySlug.set(slug, {
        slug,
        title,
        date: formatDateYMD(dateStr),
        dateRel: formatDateRel(dateStr),
        categories: categories || [],
        excerpt
      });
    }
    console.log('Processed', files.length, 'Markdown files from content/');
  }

  postsData = [...bySlug.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POSTS_JSON, JSON.stringify(postsData, null, 2), 'utf8');
  console.log('Wrote', POSTS_JSON, '(' + postsData.length, 'posts)');

  const totalPages = Math.ceil(postsData.length / PER_PAGE);
  const indexPath = path.join(ROOT, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  const page1Posts = postsData.slice(0, PER_PAGE);
  const section1 = `<section class="latest">
        <h2 class="section-title">最新記事</h2>
${buildPreviews(page1Posts, '', 0)}
        ${buildPagination(1, totalPages, '')}
      </section>`;
  indexHtml = indexHtml.replace(/<section class="latest">[\s\S]*?<\/section>/, section1);
  indexHtml = indexHtml.replace(/https:\/\/yoursite\.com/g, SITE_URL).replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL);
  if (totalPages >= 2 && !indexHtml.includes('rel="next"')) {
    indexHtml = indexHtml.replace('</head>', '  <link rel="next" href="' + SITE_URL + '/page/2.html">\n</head>');
  }
  if (!indexHtml.includes('og:image')) {
    indexHtml = indexHtml.replace('</head>', '  <meta property="og:image" content="' + OG_IMAGE_URL + '">\n  <meta name="twitter:image" content="' + OG_IMAGE_URL + '">\n</head>');
  }
  fs.writeFileSync(indexPath, indexHtml, 'utf8');
  console.log('Updated index.html');

  fs.mkdirSync(PAGE_DIR, { recursive: true });
  let baseTemplate = fs.readFileSync(indexPath, 'utf8');
  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    const start = (pageNum - 1) * PER_PAGE;
    const pagePosts = postsData.slice(start, start + PER_PAGE);
    const section = `<section class="latest">
        <h2 class="section-title">最新記事</h2>
${buildPreviews(pagePosts, '../', 0)}
        ${buildPagination(pageNum, totalPages, '../')}
      </section>`;
    let pageHtml = baseTemplate.replace(/<section class="latest">[\s\S]*?<\/section>/, section);
    const pageUrlFull = SITE_URL + '/page/' + pageNum + '.html';
    pageHtml = pageHtml.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${pageUrlFull}">`);
    pageHtml = pageHtml.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${pageUrlFull}">`);
    pageHtml = pageHtml.replace(/<title>[^<]*<\/title>/, `<title>Page ${pageNum} — ${SITE_NAME}</title>`);
    pageHtml = pageHtml.replace(/href="index.html"/g, 'href="../index.html"');
    pageHtml = pageHtml.replace(/href="posts\//g, 'href="../posts/');
    pageHtml = pageHtml.replace(/href="styles.css"/g, 'href="../styles.css"');
    pageHtml = pageHtml.replace(/href="feed.xml"/g, 'href="../feed.xml"');
    pageHtml = pageHtml.replace(/href="profile.html"/g, 'href="../profile.html"');
    pageHtml = pageHtml.replace(/href="category\//g, 'href="../category/');
    pageHtml = pageHtml.replace(/href="archive.html"/g, 'href="../archive.html"');
    pageHtml = pageHtml.replace(/href="top.html"/g, 'href="../top.html"');
    pageHtml = pageHtml.replace(/href="page\//g, 'href="../page/');
    fs.writeFileSync(path.join(PAGE_DIR, pageNum + '.html'), pageHtml, 'utf8');
  }
  if (totalPages > 1) console.log('Wrote page/2.html through page/' + totalPages + '.html');

  const archivePath = path.join(ROOT, 'archive.html');
  const archiveTemplate = fs.readFileSync(archivePath, 'utf8');
  const archiveBlocks = [];
  archiveBlocks.push(`<p class="archive-pages-intro">全${postsData.length}件の記事一覧。新しい順。下のページ別リストから各記事へ直接リンクできます。</p>`);
  for (let n = 1; n <= totalPages; n++) {
    const start = (n - 1) * PER_PAGE;
    const pagePosts = postsData.slice(start, start + PER_PAGE);
    const pageHref = n === 1 ? 'index.html' : `page/${n}.html`;
    archiveBlocks.push(`<div class="archive-page-block">`);
    archiveBlocks.push(`<h3 class="archive-page-heading"><a href="${pageHref}">Page ${n}</a></h3>`);
    archiveBlocks.push('<ul class="archive-post-list">');
    pagePosts.forEach((p) => {
      archiveBlocks.push(`<li><a href="posts/${p.slug}.html">${escapeHtml(p.title)}</a></li>`);
    });
    archiveBlocks.push('</ul></div>');
  }
  const newArchive = archiveTemplate.replace(
    /<div class="archive-list">[\s\S]*?<\/div>/,
    `<div class="archive-list">\n        ${archiveBlocks.join('\n        ')}\n        </div>`
  ).replace(/FUTARIGURASHI の全\d+記事一覧[\s\S]*?。/g, `FUTARIGURASHI の全${postsData.length}記事一覧。新しい順。各記事のタイトルから直接読めます。`).replace(/https:\/\/yoursite\.com/g, SITE_URL).replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL);
  fs.writeFileSync(archivePath, newArchive, 'utf8');
  console.log('Updated archive.html');

  const today = new Date().toISOString().slice(0, 10);
  const sitemapUrls = [
    { loc: '', priority: '1.0' },
    { loc: '/top.html', priority: '0.9' },
    { loc: '/profile.html', priority: '0.8' },
    { loc: '/archive.html', priority: '0.8' }
  ];
  for (let n = 2; n <= totalPages; n++) sitemapUrls.push({ loc: '/page/' + n + '.html', priority: '0.7' });
  postsData.forEach((p) => sitemapUrls.push({ loc: '/posts/' + p.slug + '.html', priority: '0.6', lastmod: p.date }));
  const sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemapUrls.map((u) => {
      const url = SITE_URL + (u.loc || '/');
      const lastmod = u.lastmod || today;
      return '  <url><loc>' + escapeHtml(url) + '</loc><lastmod>' + lastmod + '</lastmod>' + (u.priority ? '<priority>' + u.priority + '</priority>' : '') + '</url>';
    }).join('\n') + '\n</urlset>';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log('Wrote sitemap.xml');

  const feedEntries = postsData.slice(0, 50).map((p) => {
    const postUrl = SITE_URL + '/posts/' + p.slug + '.html';
    const summary = metaDescription(p.excerpt, 200);
    return '    <entry><title>' + escapeHtml(p.title) + '</title><link href="' + escapeHtml(postUrl) + '"/><id>urn:post:' + escapeHtml(p.slug) + '</id><updated>' + p.date + 'T00:00:00Z</updated><summary>' + escapeHtml(summary) + '</summary></entry>';
  }).join('\n');
  const feedXml = '<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>' + escapeHtml(SITE_NAME) + '</title>\n  <link href="' + escapeHtml(SITE_URL) + '/"/>\n  <link href="' + escapeHtml(SITE_URL) + '/feed.xml" rel="self" type="application/atom+xml"/>\n  <updated>' + today + 'T00:00:00Z</updated>\n  <id>' + escapeHtml(SITE_URL) + '/</id>\n' + feedEntries + '\n</feed>';
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), feedXml, 'utf8');
  console.log('Wrote feed.xml');

  console.log('Done.');
}

main();
