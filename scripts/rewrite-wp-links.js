/**
 * Rewrite in-content WordPress permalink links to static paths and build a redirect map.
 * - Finds hrefs like https?://(www.)?futarigurashi.com/YYYY/MM/... or /YYYY/MM/DD/...
 * - Resolves each to the corresponding posts/XXX.html (by matching path slug to static filenames)
 * - Replaces hrefs in all HTML with the correct relative path
 * - Writes redirects.txt: old URL -> new path for 301s when domain points to this site
 *
 * Usage: node scripts/rewrite-wp-links.js
 *        node scripts/rewrite-wp-links.js --dry-run  (report only, no rewrite; lists unmapped URLs)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'posts');

// WP permalink href (capture path: YYYY/MM or YYYY/MM/DD then rest)
const WP_HREF_REGEX = /href=(["'])(https?:\/\/(?:www\.)?futarigurashi\.com\/(\d{4}\/\d{2}(?:\/\d{2})?\/[^"']+))\1/g;

const DRY_RUN = process.argv.includes('--dry-run');

function getAllHtmlFiles() {
  const files = [];
  for (const dirName of ['posts', 'page', 'category']) {
    const dir = path.join(ROOT, dirName);
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.html')) {
          files.push({
            filePath: path.join(dir, name),
            relDir: dirName,
          });
        }
      }
    }
  }
  for (const name of ['index.html', 'archive.html', 'category.html', 'top.html']) {
    const filePath = path.join(ROOT, name);
    if (fs.existsSync(filePath)) {
      files.push({ filePath, relDir: '' });
    }
  }
  return files;
}

function getStaticSlugs() {
  if (!fs.existsSync(POSTS_DIR)) return new Set();
  return new Set(
    fs.readdirSync(POSTS_DIR)
      .filter((f) => f.endsWith('.html'))
      .map((f) => f.slice(0, -5))
  );
}

/** Extract post slug from WP path. Path is like "2013/06/借りている家が売りに出された時" or "2012/06/17/金とんのしょうゆラーメン/kinton" */
function postSlugFromWpPath(wpPath) {
  const segments = wpPath.split('/').filter(Boolean);
  if (segments.length < 3) return null;
  const [y, m, second] = segments;
  if (y.length !== 4 || m.length !== 2) return null;
  // Second might be DD (2 digits) or the slug
  const postSegmentIndex = second.length === 2 && /^\d{2}$/.test(second) ? 3 : 2;
  const raw = segments[postSegmentIndex];
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.replace(/～/g, '-').replace(/\s+/g, '-').trim();
  } catch {
    return raw.replace(/～/g, '-').trim();
  }
}

/** Normalize WP-style slug to be closer to our static slugs (import-wp uses slugify / wp:post_name). */
function normalizeForMatch(s) {
  return (
    s
      .replace(/～/g, '-')
      .replace(/〜/g, '-')
      .replace(/、/g, '-')
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.codePointAt(0) - 0xfee0)) // fullwidth punctuation/symbols -> ASCII
      .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.codePointAt(0) - 0xfee0)) // fullwidth digits ０-９ -> 0-9
      .replace(/①/g, '1')
      .replace(/②/g, '2')
      .replace(/③/g, '3')
      .replace(/④/g, '4')
      .replace(/⑤/g, '5')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^\s+|\s+$/g, '')
  );
}

/** Find best-matching static slug. Prefer exact match, then normalized match, then prefix/substring, then without digits. */
function findStaticSlug(wpSlug, staticSlugs) {
  if (!wpSlug) return null;
  if (staticSlugs.has(wpSlug)) return wpSlug;
  const n = normalizeForMatch(wpSlug);
  for (const slug of staticSlugs) {
    if (normalizeForMatch(slug) === n) return slug;
  }
  for (const slug of staticSlugs) {
    const sn = normalizeForMatch(slug);
    if (sn.startsWith(n) || n.startsWith(sn)) return slug;
  }
  if (wpSlug.length >= 8) {
    for (const slug of staticSlugs) {
      if (slug.includes(wpSlug) || wpSlug.includes(slug)) return slug;
      if (normalizeForMatch(slug).includes(n) || n.includes(normalizeForMatch(slug))) return slug;
    }
  }
  // WP slug may have extra digits (e.g. ステビア栽培2012-発芽 vs ステビア栽培-発芽)
  const nNoDigits = n.replace(/\d+/g, '');
  for (const slug of staticSlugs) {
    const sn = normalizeForMatch(slug).replace(/\d+/g, '');
    if (sn === nNoDigits || sn.startsWith(nNoDigits) || nNoDigits.startsWith(sn)) return slug;
  }
  // Strip repeated ? ! so ジムで日本人を人種差別？？-続き- matches ジムで日本人を人種差別-続き-
  const nClean = nNoDigits.replace(/\?+/g, '').replace(/!+/g, '').replace(/-+/g, '-');
  for (const slug of staticSlugs) {
    const sn = normalizeForMatch(slug).replace(/\d+/g, '').replace(/\?+/g, '').replace(/!+/g, '').replace(/-+/g, '-');
    if (sn === nClean || sn.startsWith(nClean) || nClean.startsWith(sn)) return slug;
  }
  return null;
}

function collectWpUrls(htmlFiles) {
  const urlToPath = new Map(); // full URL -> path part (YYYY/MM/...)
  for (const { filePath } of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    let m;
    WP_HREF_REGEX.lastIndex = 0;
    while ((m = WP_HREF_REGEX.exec(content)) !== null) {
      urlToPath.set(m[2], m[3]);
    }
  }
  return urlToPath;
}

function buildUrlToRelative(urlToPath, staticSlugs) {
  const urlToRelative = new Map();
  const unmapped = [];
  for (const [url, wpPath] of urlToPath) {
    const wpSlug = postSlugFromWpPath(wpPath);
    const slug = findStaticSlug(wpSlug, staticSlugs);
    if (slug) {
      urlToRelative.set(url, `posts/${slug}.html`);
    } else {
      unmapped.push({ url, wpPath, wpSlug });
    }
  }
  return { urlToRelative, unmapped };
}

function linkToPost(relDir, targetBasename) {
  if (relDir === 'posts') return targetBasename;
  if (relDir === 'page' || relDir === 'category') return `../posts/${targetBasename}`;
  return `posts/${targetBasename}`;
}

function rewriteAllHtml(htmlFiles, urlToRelative) {
  let count = 0;
  for (const { filePath, relDir } of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const newContent = content.replace(WP_HREF_REGEX, (_, quote, fullUrl) => {
      const target = urlToRelative.get(fullUrl);
      if (target) {
        const basename = path.basename(target);
        const href = linkToPost(relDir, basename);
        return `href=${quote}${href}${quote}`;
      }
      return _;
    });
    if (newContent !== content) {
      if (!DRY_RUN) fs.writeFileSync(filePath, newContent);
      count++;
    }
  }
  return count;
}

function writeRedirectMap(urlToRelative) {
  // Canonical old base for redirects (user can add 301 to /posts/xxx.html when domain points here)
  const lines = [
    '# Redirect map: old WordPress permalink -> new static path',
    '# Use with Netlify _redirects, Cloudflare, or nginx to preserve SEO',
    '# Format: old_path new_path 301',
    '',
  ];
  const seenPaths = new Set();
  for (const [url, newPath] of urlToRelative) {
    try {
      const u = new URL(url);
      const oldPath = u.pathname.replace(/\/$/, '') || '/';
      const key = u.origin + oldPath;
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      lines.push(`${oldPath}  /${newPath}  301`);
    } catch {
      // skip
    }
  }
  const outPath = path.join(ROOT, 'redirects.txt');
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  return outPath;
}

function main() {
  console.log('Loading static slugs from posts/...');
  const staticSlugs = getStaticSlugs();
  console.log(`  ${staticSlugs.size} post files`);

  console.log('Collecting HTML files...');
  const htmlFiles = getAllHtmlFiles();
  console.log(`  ${htmlFiles.length} files`);

  console.log('Collecting WordPress permalink URLs...');
  const urlToPath = collectWpUrls(htmlFiles);
  console.log(`  ${urlToPath.size} unique WP permalink URLs`);

  const { urlToRelative, unmapped } = buildUrlToRelative(urlToPath, staticSlugs);
  console.log(`  Mapped: ${urlToRelative.size}, Unmapped: ${unmapped.length}`);

  if (unmapped.length > 0) {
    console.log('\nUnmapped (no matching post file):');
    unmapped.slice(0, 20).forEach(({ url, wpSlug }) => console.log(`  ${wpSlug || url}`));
    if (unmapped.length > 20) console.log(`  ... and ${unmapped.length - 20} more`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would rewrite HTML and write redirects.');
    return;
  }

  console.log('\nRewriting hrefs in HTML...');
  const rewritten = rewriteAllHtml(htmlFiles, urlToRelative);
  console.log(`  ${rewritten} files updated`);

  if (urlToRelative.size > 0) {
    const outPath = writeRedirectMap(urlToRelative);
    console.log(`Redirect map written: ${path.relative(ROOT, outPath)}`);
  }
}

main();
