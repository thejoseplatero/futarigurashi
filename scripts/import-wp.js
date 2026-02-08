/**
 * Import WordPress WXR export into static HTML + JSON.
 * Usage: node scripts/import-wp.js [path-to-export.xml]
 * Default: ~/Downloads/futarigurashi.WordPress.2026-02-08.xml
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const ROOT = path.join(__dirname, '..');
const XML_PATH = process.argv[2] || path.join(process.env.HOME || '', 'Downloads', 'futarigurashi.WordPress.2026-02-08.xml');
const POSTS_DIR = path.join(ROOT, 'posts');
const DATA_DIR = path.join(ROOT, 'data');
const PAGE_DIR = path.join(ROOT, 'page');
const CATEGORY_DIR = path.join(ROOT, 'category');
const POSTS_JSON = path.join(DATA_DIR, 'posts.json');
const PER_PAGE = 10;
const SITE_URL = (process.env.SITE_URL || 'https://futarigurashi.com').replace(/\/$/, '');
const SITE_NAME = 'FUTARIGURASHI';
const OG_IMAGE_URL = SITE_URL + '/images/og-default.png';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'item' || name === 'category' || name === 'wp:category'
});

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node.trim();
  if (node['#text']) return String(node['#text']).trim();
  return '';
}

function slugify(str) {
  return str
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'post';
}

function categorySlug(name) {
  return slugify(name) || 'category';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractCategories(item) {
  const cat = item.category;
  if (!cat) return [];
  const list = Array.isArray(cat) ? cat : [cat];
  return list
    .filter((c) => (c['@_domain'] || '').toLowerCase() === 'category')
    .map((c) => textOf(c))
    .filter(Boolean);
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

function cleanExcerpt(html, maxLen = 200) {
  const stripped = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&hellip;|&#8230;/g, '…')
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen).trim() + '…';
}

function getPostSlug(item) {
  const name = textOf(item['wp:post_name']);
  if (name) {
    try {
      return decodeURIComponent(name).replace(/[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]/g, '-').replace(/-+/g, '-').slice(0, 80) || 'post';
    } catch (e) {
      // ignore
    }
  }
  return slugify(textOf(item.title));
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

function main() {
  if (!fs.existsSync(XML_PATH)) {
    console.error('XML file not found:', XML_PATH);
    process.exit(1);
  }

  console.log('Reading', XML_PATH, '...');
  const xml = fs.readFileSync(XML_PATH, 'utf8');
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel) {
    console.error('Invalid WXR: no rss.channel');
    process.exit(1);
  }

  // Parse category hierarchy from WXR (for top-level only tabs and category pages)
  let wpCategories = channel['wp:category'];
  if (!wpCategories) wpCategories = [];
  if (!Array.isArray(wpCategories)) wpCategories = [wpCategories];
  const catByNicename = new Map(); // nicename -> { name, parentNicename }
  wpCategories.forEach((c) => {
    const nicename = textOf(c['wp:category_nicename']).trim();
    const name = textOf(c['wp:cat_name']).trim();
    const parent = textOf(c['wp:category_parent']).trim();
    if (name) catByNicename.set(nicename, { name, parentNicename: parent || null });
  });
  const topLevelNicenames = [...catByNicename.entries()]
    .filter(([, v]) => !v.parentNicename)
    .map(([nicename]) => nicename);
  function getDescendantNames(nicename) {
    const names = new Set();
    const add = (n) => {
      const info = catByNicename.get(n);
      if (!info) return;
      names.add(info.name);
      [...catByNicename.entries()]
        .filter(([, v]) => v.parentNicename === n)
        .forEach(([child]) => add(child));
    };
    add(nicename);
    return names;
  }
  const topLevelCats = topLevelNicenames
    .map((n) => catByNicename.get(n).name)
    .filter((name) => name && name !== 'Uncategorized')
    .sort();
  const topLevelDescendants = new Map(); // topLevelName -> Set of category names (self + descendants)
  topLevelCats.forEach((name) => {
    const nicename = [...catByNicename.entries()].find(([, v]) => v.name === name)?.[0];
    if (nicename) topLevelDescendants.set(name, getDescendantNames(nicename));
  });

  const nameToNicename = new Map();
  for (const [nicename, v] of catByNicename) if (v.name) nameToNicename.set(v.name, nicename);

  function getDirectChildren(parentNicename) {
    return [...catByNicename.entries()]
      .filter(([, v]) => v.parentNicename === parentNicename)
      .map(([nicename, v]) => ({ nicename, name: v.name }));
  }

  // All categories (and subcategories) with path-based slugs for unique URLs
  const allCategoriesWithSlug = [];
  function addCategoryWithPath(nicename, pathNames) {
    const info = catByNicename.get(nicename);
    if (!info || !info.name) return;
    const path = pathNames.concat(info.name);
    const slug = path.map(categorySlug).join('-');
    allCategoriesWithSlug.push({ nicename, name: info.name, slug });
    getDirectChildren(nicename).forEach((c) => addCategoryWithPath(c.nicename, path));
  }
  topLevelCats.forEach((name) => {
    const nicename = nameToNicename.get(name);
    if (nicename) addCategoryWithPath(nicename, []);
  });
  const nicenameToSlug = new Map();
  allCategoriesWithSlug.forEach((c) => nicenameToSlug.set(c.nicename, c.slug));

  let items = channel.item;
  if (!items) items = [];
  if (!Array.isArray(items)) items = [items];

  const posts = items.filter((item) => {
    const type = textOf(item['wp:post_type']);
    const status = textOf(item['wp:status']);
    const title = textOf(item.title);
    return type === 'post' && status === 'publish' && title.length > 0;
  });

  console.log('Found', posts.length, 'published posts.');

  // Sort by date descending
  posts.sort((a, b) => {
    const da = new Date(textOf(a['wp:post_date'])).getTime();
    const db = new Date(textOf(b['wp:post_date'])).getTime();
    return db - da;
  });

  if (!fs.existsSync(POSTS_DIR)) fs.mkdirSync(POSTS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const postsData = [];
  const slugUsed = new Set();

  for (let i = 0; i < posts.length; i++) {
    const item = posts[i];
    const title = textOf(item.title);
    const dateStr = textOf(item['wp:post_date']);
    const categories = extractCategories(item);
    let rawContent = textOf(item['content:encoded']);
    let slug = getPostSlug(item);
    while (slugUsed.has(slug)) {
      slug = slug + '-' + (i + 1);
    }
    slugUsed.add(slug);

    const excerpt = cleanExcerpt(rawContent, 220);

    // Basic content cleanup: ensure block-level content for entry-content
    let contentHtml = rawContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/&hellip;/g, '…');
    // Optional: make images responsive (they often have width/height)
    contentHtml = contentHtml.replace(/<img /gi, '<img loading="lazy" ');
    if (contentHtml && !contentHtml.trim().startsWith('<')) {
      contentHtml = '<p>' + contentHtml.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>\n') + '</p>';
    }
    // QA: add rel="noopener" to external target="_blank" links
    contentHtml = contentHtml.replace(/<a [^>]*target="_blank"[^>]*>/g, (tag) => {
      if (/\bnoopener\b/.test(tag)) return tag;
      const relMatch = tag.match(/rel=["']([^"']*)["']/);
      if (relMatch) return tag.replace(relMatch[0], 'rel="' + (relMatch[1].trim() + ' noopener').trim() + '"');
      return tag.replace('>', ' rel="noopener">');
    });

    postsData.push({
      slug,
      title,
      date: formatDateYMD(dateStr),
      dateRel: formatDateRel(dateStr),
      categories,
      excerpt
    });

    const html = buildPostPage(slug, title, dateStr, categories, contentHtml, excerpt);
    const outPath = path.join(POSTS_DIR, slug + '.html');
    fs.writeFileSync(outPath, html, 'utf8');
    if ((i + 1) % 50 === 0) console.log('  wrote', i + 1, 'posts...');
  }

  fs.writeFileSync(POSTS_JSON, JSON.stringify(postsData, null, 2), 'utf8');
  console.log('Wrote', postsData.length, 'post HTML files and', POSTS_JSON);

  const totalPages = Math.ceil(postsData.length / PER_PAGE);

  function buildSidebarCategoryList(baseUrl) {
    function renderItem(nicename, indent) {
      const info = catByNicename.get(nicename);
      if (!info) return '';
      const name = info.name;
      const escapedName = escapeHtml(name);
      if (name === 'プロフィール') {
        return indent + '<li><a href="' + baseUrl + 'profile.html">' + escapedName + '</a></li>';
      }
      const slug = nicenameToSlug.get(nicename);
      const href = slug ? baseUrl + 'category/' + slug + '.html' : baseUrl + 'category/' + categorySlug(name) + '.html';
      const children = getDirectChildren(nicename);
      if (children.length === 0) {
        return indent + '<li><a href="' + href + '">' + escapedName + '</a></li>';
      }
      const subIndent = indent + '  ';
      const childLines = children.map((c) => renderItem(c.nicename, subIndent + '  ')).join('\n');
      return indent + '<li class="has-children">\n' +
        subIndent + '<a href="' + href + '">' + escapedName + '</a>\n' +
        subIndent + '<ul>\n' + childLines + '\n' +
        subIndent + '</ul>\n' +
        indent + '</li>';
    }
    const lines = [];
    for (const topLevelName of topLevelCats) {
      const nicename = nameToNicename.get(topLevelName);
      if (!nicename) continue;
      lines.push(renderItem(nicename, '            '));
    }
    return '<ul class="category-list">\n' + lines.join('\n') + '\n          </ul>';
  }

  const sidebarListRegex = /<ul class="category-list">[\s\S]*?^\s{10}<\/ul>/m;

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

  function categoryPageUrl(catSlug, n, baseUrl) {
    return n === 1 ? baseUrl + 'category/' + catSlug + '.html' : baseUrl + 'category/' + catSlug + '-' + n + '.html';
  }

  function buildCategoryPagination(catSlug, pageNum, totalPages, baseUrl) {
    if (totalPages <= 1) return '';
    const prevLink = pageNum === 1 ? null : categoryPageUrl(catSlug, pageNum - 1, baseUrl);
    const nextLink = pageNum < totalPages ? categoryPageUrl(catSlug, pageNum + 1, baseUrl) : null;
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
        nav += `<a href="${categoryPageUrl(catSlug, n, baseUrl)}" class="pagination-num">${n}</a>`;
      }
    });
    nav += '</span>';
    if (nextLink) nav += `<a href="${nextLink}" class="pagination-link pagination-next">Older »</a>`;
    nav += '<label class="pagination-goto">Go to page <select class="pagination-select" onchange="if(this.value)window.location.href=this.value">';
    nav += '<option value="">—</option>';
    for (let i = 1; i <= totalPages; i++) {
      nav += `<option value="${categoryPageUrl(catSlug, i, baseUrl)}"${i === pageNum ? ' selected' : ''}>${i}</option>`;
    }
    nav += '</select></label>';
    nav += '</nav>';
    return `        ${nav}`;
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
    return `        ${nav}`;
  }

  const indexTemplate = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Page 1 = index.html
  const page1Posts = postsData.slice(0, PER_PAGE);
  const section1 = `<section class="latest">
        <h2 class="section-title">最新記事</h2>
${buildPreviews(page1Posts, '', 0)}
${buildPagination(1, totalPages, '')}
      </section>`;
  let newIndex = indexTemplate.replace(/<section class="latest">[\s\S]*?<\/section>/, section1);
  newIndex = newIndex.replace(sidebarListRegex, buildSidebarCategoryList(''));
  newIndex = newIndex.replace(/https:\/\/yoursite\.com/g, SITE_URL).replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL);
  fs.writeFileSync(path.join(ROOT, 'index.html'), newIndex, 'utf8');
  console.log('Updated index.html (page 1)');

  // Pages 2..N
  if (!fs.existsSync(PAGE_DIR)) fs.mkdirSync(PAGE_DIR, { recursive: true });
  const baseTemplate = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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
    const pageDesc = `${SITE_NAME} の記事一覧、ページ ${pageNum}`;
    pageHtml = pageHtml.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${pageUrlFull}">`);
    pageHtml = pageHtml.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${pageUrlFull}">`);
    pageHtml = pageHtml.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="Page ${pageNum} — ${SITE_NAME}">`);
    pageHtml = pageHtml.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="Page ${pageNum} — ${SITE_NAME}">`);
    pageHtml = pageHtml.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(pageDesc)}">`);
    pageHtml = pageHtml.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(pageDesc)}">`);
    pageHtml = pageHtml.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeHtml(pageDesc)}">`);
    pageHtml = pageHtml.replace(/<title>FUTARIGURASHI(?:\s*\|\s*[^<]*)?<\/title>/, `<title>Page ${pageNum} — ${SITE_NAME}</title>`);
    pageHtml = pageHtml.replace(/href="index.html"/g, 'href="../index.html"');
    pageHtml = pageHtml.replace(/href="posts\//g, 'href="../posts/');
    pageHtml = pageHtml.replace(/href="styles.css"/g, 'href="../styles.css"');
    pageHtml = pageHtml.replace(/href="feed.xml"/g, 'href="../feed.xml"');
    pageHtml = pageHtml.replace(/href="profile.html"/g, 'href="../profile.html"');
    pageHtml = pageHtml.replace(/href="category.html"/g, 'href="../category.html"');
    pageHtml = pageHtml.replace(/href="category\//g, 'href="../category/');
    pageHtml = pageHtml.replace(/href="archive.html"/g, 'href="../archive.html"');
    pageHtml = pageHtml.replace(/href="top.html"/g, 'href="../top.html"');
    pageHtml = pageHtml.replace(/href="page\//g, 'href="../page/');
    pageHtml = pageHtml.replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL);
    // QA: remove template's rel="next" and og:image so we don't duplicate (template came from index)
    pageHtml = pageHtml.replace(/<link rel="next" href="[^"]*">\s*/gi, '');
    pageHtml = pageHtml.replace(/\s*<meta property="og:image" content="[^"]*">\s*/gi, '');
    pageHtml = pageHtml.replace(/\s*<meta name="twitter:image" content="[^"]*">\s*/gi, '');
    let prevNext = '\n  <link rel="prev" href="' + (pageNum === 2 ? SITE_URL + '/' : SITE_URL + '/page/' + (pageNum - 1) + '.html') + '">';
    if (pageNum < totalPages) prevNext += '\n  <link rel="next" href="' + SITE_URL + '/page/' + (pageNum + 1) + '.html' + '">';
    prevNext += '\n  <meta property="og:image" content="' + OG_IMAGE_URL + '">\n  <meta name="twitter:image" content="' + OG_IMAGE_URL + '">';
    pageHtml = pageHtml.replace('</head>', prevNext + '\n</head>');
    fs.writeFileSync(path.join(PAGE_DIR, pageNum + '.html'), pageHtml, 'utf8');
  }
  console.log('Wrote page/2.html through page/' + totalPages + '.html');

  // Fix index.html pagination: "Older »" should go to page/2.html
  const indexAgain = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pagination1 = buildPagination(1, totalPages, '');
  const section1Final = `<section class="latest">
        <h2 class="section-title">最新記事</h2>
${buildPreviews(page1Posts, '', 0)}
${pagination1}
      </section>`;
  let indexFinal = indexAgain.replace(/<section class="latest">[\s\S]*?<\/section>/, section1Final);
  indexFinal = indexFinal.replace(/https:\/\/yoursite\.com/g, SITE_URL).replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL);
  if (!indexFinal.includes('rel="next"') || !indexFinal.includes('og:image')) {
    let indexHeadExtra = '';
    if (totalPages >= 2) indexHeadExtra += '  <link rel="next" href="' + SITE_URL + '/page/2.html">\n';
    indexHeadExtra += '  <meta property="og:image" content="' + OG_IMAGE_URL + '">\n  <meta name="twitter:image" content="' + OG_IMAGE_URL + '">';
    indexFinal = indexFinal.replace('</head>', indexHeadExtra + '\n</head>');
  }
  fs.writeFileSync(path.join(ROOT, 'index.html'), indexFinal, 'utf8');

  // Top posts page (from data/top-posts.json)
  const topPostsPath = path.join(DATA_DIR, 'top-posts.json');
  let topPosts = [];
  if (fs.existsSync(topPostsPath)) {
    try {
      const topSlugs = JSON.parse(fs.readFileSync(topPostsPath, 'utf8'));
      const slugMap = new Map(postsData.map((p) => [p.slug, p]));
      topPosts = topSlugs.map((slug) => slugMap.get(slug)).filter(Boolean);
    } catch (e) {
      console.warn('Could not read top-posts.json:', e.message);
    }
  }
  if (topPosts.length > 0) {
    const topSection = `<section class="latest">
        <h2 class="section-title">おすすめ</h2>
${buildPreviews(topPosts, '', 0)}
      </section>`;
    const topUrl = SITE_URL + '/top.html';
    const topDesc = SITE_NAME + ' のおすすめ記事';
    let topHtml = indexTemplate
      .replace(/<section class="latest">[\s\S]*?<\/section>/, topSection)
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${topUrl}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${topUrl}">`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="おすすめ — ${SITE_NAME}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="おすすめ — ${SITE_NAME}">`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(topDesc)}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(topDesc)}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeHtml(topDesc)}">`)
      .replace(/<title>FUTARIGURASHI(?:\s*\|\s*[^<]*)?<\/title>/, `<title>おすすめ — ${SITE_NAME}</title>`)
      .replace('data-current="index"', 'data-current="top"');
    topHtml = topHtml.replace(sidebarListRegex, buildSidebarCategoryList(''));
    topHtml = topHtml.replace(/https:\/\/yoursite\.com/g, SITE_URL);
    fs.writeFileSync(path.join(ROOT, 'top.html'), topHtml, 'utf8');
    console.log('Wrote top.html (' + topPosts.length + ' posts)');
  }

  // Category pages: one per category/subcategory, 10 posts per page, paginated
  if (!fs.existsSync(CATEGORY_DIR)) fs.mkdirSync(CATEGORY_DIR, { recursive: true });
  const validSlugs = new Set();
  for (const cat of allCategoriesWithSlug) {
    const allowedNames = getDescendantNames(cat.nicename);
    const catPosts = postsData.filter((p) =>
      p.categories.some((c) => allowedNames && allowedNames.has(c))
    );
    const totalCatPages = Math.max(1, Math.ceil(catPosts.length / PER_PAGE));
    validSlugs.add(cat.slug);
    for (let n = 2; n <= totalCatPages; n++) validSlugs.add(cat.slug + '-' + n);
  }
  const existingFiles = fs.existsSync(CATEGORY_DIR) ? fs.readdirSync(CATEGORY_DIR) : [];
  existingFiles.forEach((f) => {
    if (f.endsWith('.html')) {
      const slug = f.slice(0, -5);
      if (!validSlugs.has(slug)) fs.unlinkSync(path.join(CATEGORY_DIR, f));
    }
  });
  for (const cat of allCategoriesWithSlug) {
    const allowedNames = getDescendantNames(cat.nicename);
    const catPosts = postsData.filter((p) =>
      p.categories.some((c) => allowedNames && allowedNames.has(c))
    );
    const totalCatPages = Math.max(1, Math.ceil(catPosts.length / PER_PAGE));
    const baseUrl = '../';
    for (let pageNum = 1; pageNum <= totalCatPages; pageNum++) {
      const start = (pageNum - 1) * PER_PAGE;
      const pagePosts = catPosts.slice(start, start + PER_PAGE);
      const catPagination = buildCategoryPagination(cat.slug, pageNum, totalCatPages, baseUrl);
      const catSection = `<section class="latest">
        <h2 class="section-title">${escapeHtml(cat.name)}</h2>
${buildPreviews(pagePosts, baseUrl, 0)}
${catPagination}
      </section>`;
      const catPageSlug = pageNum === 1 ? cat.slug : cat.slug + '-' + pageNum;
      const catUrl = SITE_URL + '/category/' + catPageSlug + '.html';
      const catDesc = `${escapeHtml(cat.name)} カテゴリーの記事一覧`;
      let catHtml = indexTemplate
        .replace(/<section class="latest">[\s\S]*?<\/section>/, catSection)
        .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${catUrl}">`)
        .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${catUrl}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(cat.name)} — ${SITE_NAME}">`)
        .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeHtml(cat.name)} — ${SITE_NAME}">`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${catDesc}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${catDesc}">`)
        .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${catDesc}">`)
        .replace(/<title>FUTARIGURASHI(?:\s*\|\s*[^<]*)?<\/title>/, `<title>${escapeHtml(cat.name)} — ${SITE_NAME}</title>`)
        .replace('data-current="index"', `data-category="${escapeHtml(cat.name)}"`);
      catHtml = catHtml.replace(sidebarListRegex, buildSidebarCategoryList(baseUrl));
      catHtml = catHtml.replace(/https:\/\/yoursite\.com/g, SITE_URL);
      catHtml = catHtml.replace(/<link rel="next" href="[^"]*">\s*/gi, '');
      catHtml = catHtml.replace(/href="feed\.xml"/g, 'href="../feed.xml"');
      catHtml = catHtml.replace(/href="index.html"/g, 'href="../index.html"');
      catHtml = catHtml.replace(/href="posts\//g, 'href="../posts/');
      catHtml = catHtml.replace(/href="styles.css"/g, 'href="../styles.css"');
      catHtml = catHtml.replace(/href="profile.html"/g, 'href="../profile.html"');
      catHtml = catHtml.replace(/href="category\//g, 'href="../category/');
      catHtml = catHtml.replace(/href="archive.html"/g, 'href="../archive.html"');
      catHtml = catHtml.replace(/href="top.html"/g, 'href="../top.html"');
      catHtml = catHtml.replace(/href="page\//g, 'href="../page/');
      const fileName = pageNum === 1 ? cat.slug + '.html' : cat.slug + '-' + pageNum + '.html';
      fs.writeFileSync(path.join(CATEGORY_DIR, fileName), catHtml, 'utf8');
    }
  }
  console.log('Wrote category/ pages (' + allCategoriesWithSlug.length + ' categories, 10 per page, paginated)');

  // Archive = browse by page with post titles under each page (SEO: full content list, one URL)
  const archiveBlocks = [];
  const archiveIntro = `全${postsData.length}件の記事一覧。新しい順。下のページ別リストから各記事へ直接リンクできます。`;
  archiveBlocks.push(`<p class="archive-pages-intro">${archiveIntro}</p>`);
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

  const archiveTemplate = fs.readFileSync(path.join(ROOT, 'archive.html'), 'utf8');
  const archiveDesc = `FUTARIGURASHI の全${postsData.length}記事一覧。新しい順。各記事のタイトルから直接読めます。`;
  const newArchive = archiveTemplate
    .replace(
      /<div class="archive-list">[\s\S]*?<\/div>/,
      `<div class="archive-list">\n        ${archiveBlocks.join('\n        ')}\n        </div>`
    )
    .replace(/FUTARIGURASHI の記事一覧。全ページへ。/g, archiveDesc)
    .replace(/https:\/\/yoursite\.com/g, SITE_URL)
    .replace(/https:\/\/futarigurashi\.example\.com/g, SITE_URL)
    .replace('</head>', '  <meta property="og:image" content="' + OG_IMAGE_URL + '">\n  <meta name="twitter:image" content="' + OG_IMAGE_URL + '">\n</head>');
  fs.writeFileSync(path.join(ROOT, 'archive.html'), newArchive, 'utf8');
  console.log('Updated archive.html (page index)');

  let profileHtml = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8').replace(/https:\/\/yoursite\.com/g, SITE_URL);
  if (!profileHtml.includes('og:image')) {
    profileHtml = profileHtml.replace('</head>', '  <meta property="og:image" content="' + OG_IMAGE_URL + '">\n  <meta name="twitter:image" content="' + OG_IMAGE_URL + '">\n</head>');
  }
  fs.writeFileSync(path.join(ROOT, 'profile.html'), profileHtml, 'utf8');
  console.log('Updated profile.html (canonical/og URLs)');

  // robots.txt
  const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robotsTxt, 'utf8');
  console.log('Wrote robots.txt');

  // sitemap.xml
  const today = new Date().toISOString().slice(0, 10);
  const sitemapUrls = [
    { loc: '', priority: '1.0' },
    { loc: '/top.html', priority: '0.9' },
    { loc: '/profile.html', priority: '0.8' },
    { loc: '/archive.html', priority: '0.8' }
  ];
  for (let n = 2; n <= totalPages; n++) {
    sitemapUrls.push({ loc: '/page/' + n + '.html', priority: '0.7' });
  }
  for (const cat of allCategoriesWithSlug) {
    const allowedNames = getDescendantNames(cat.nicename);
    const catPosts = postsData.filter((p) =>
      p.categories.some((c) => allowedNames && allowedNames.has(c))
    );
    const totalCatPages = Math.max(1, Math.ceil(catPosts.length / PER_PAGE));
    for (let pageNum = 1; pageNum <= totalCatPages; pageNum++) {
      const slug = pageNum === 1 ? cat.slug : cat.slug + '-' + pageNum;
      sitemapUrls.push({ loc: '/category/' + slug + '.html', priority: '0.7' });
    }
  }
  postsData.forEach((p) => sitemapUrls.push({ loc: '/posts/' + p.slug + '.html', priority: '0.6', lastmod: p.date }));
  const sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemapUrls.map((u) => {
      const url = SITE_URL + (u.loc || '/');
      const lastmod = u.lastmod || today;
      return '  <url><loc>' + escapeHtml(url) + '</loc><lastmod>' + lastmod + '</lastmod>' + (u.priority ? '<priority>' + u.priority + '</priority>' : '') + '</url>';
    }).join('\n') + '\n</urlset>';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXml, 'utf8');
  console.log('Wrote sitemap.xml');

  // feed.xml (Atom)
  const feedEntries = postsData.slice(0, 50).map((p) => {
    const postUrl = SITE_URL + '/posts/' + p.slug + '.html';
    const updated = p.date;
    const summary = metaDescription(p.excerpt, 200);
    return '    <entry><title>' + escapeHtml(p.title) + '</title><link href="' + escapeHtml(postUrl) + '"/><id>urn:post:' + escapeHtml(p.slug) + '</id><updated>' + updated + 'T00:00:00Z</updated><summary>' + escapeHtml(summary) + '</summary></entry>';
  }).join('\n');
  const feedXml = '<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>' + escapeHtml(SITE_NAME) + '</title>\n  <link href="' + escapeHtml(SITE_URL) + '/"/>\n  <link href="' + escapeHtml(SITE_URL) + '/feed.xml" rel="self" type="application/atom+xml"/>\n  <updated>' + today + 'T00:00:00Z</updated>\n  <id>' + escapeHtml(SITE_URL) + '/</id>\n' + feedEntries + '\n</feed>';
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), feedXml, 'utf8');
  console.log('Wrote feed.xml (Atom, 50 latest posts)');

  console.log('Done. 10 posts per page, ' + totalPages + ' pages total.');
}

main();
