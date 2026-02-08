/**
 * Migrate images and videos from futarigurashi.com wp-content/uploads to local uploads/.
 * - Discovers all media URLs (img src, a href, [video mp4="..."]) from those two bases
 * - Downloads each file to futarigurashi/uploads/<path>
 * - Rewrites HTML to use local paths and converts [video] shortcodes to <video><source>
 *
 * Usage: node scripts/migrate-media.js
 * Optional: node scripts/migrate-media.js --dry-run  (discover + report only, no download/rewrite)
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

const BASE_URLS = [
  'http://www.futarigurashi.com/wp-content/uploads/',
  'http://futarigurashi.com/wp-content/uploads/',
];

// Match path after /wp-content/uploads/ (for src= and href=)
const URL_PATH_REGEX = /(?:src|href)=["']https?:\/\/(?:www\.)?futarigurashi\.com\/wp-content\/uploads\/([^"']+)["']/g;
// Match [video ... mp4="...url..."][/video] and capture the path part of the URL
const VIDEO_SHORTCODE_REGEX = /\[video\s+([^]]*?)mp4=["']https?:\/\/(?:www\.)?futarigurashi\.com\/wp-content\/uploads\/([^"']+)["']([^]]*)\]\s*\[\/video\]/g;
// Match already-rewritten shortcode (mp4 points to local uploads/) so we can convert to <video>
const VIDEO_SHORTCODE_REWRITTEN_REGEX = /\[video\s+([^\]]*?)\s+mp4=["']([^"']+)["'][^\]]*\]\s*\[\/video\]/g;

const DRY_RUN = process.argv.includes('--dry-run');
const FIX_VIDEO_ONLY = process.argv.includes('--fix-video-only');

function getAllHtmlFiles() {
  const files = [];
  const dirs = [
    { dir: path.join(ROOT, 'posts'), prefix: '../uploads/' },
    { dir: path.join(ROOT, 'page'), prefix: '../uploads/' },
    { dir: path.join(ROOT, 'category'), prefix: '../uploads/' },
  ];
  for (const { dir } of dirs) {
    if (fs.existsSync(dir)) {
      const names = fs.readdirSync(dir);
      for (const name of names) {
        if (name.endsWith('.html')) {
          files.push({ filePath: path.join(dir, name), relDir: path.relative(ROOT, path.dirname(path.join(dir, name))) });
        }
      }
    }
  }
  const rootFiles = ['index.html', 'archive.html', 'category.html', 'top.html'];
  for (const name of rootFiles) {
    const filePath = path.join(ROOT, name);
    if (fs.existsSync(filePath)) {
      files.push({ filePath, relDir: '' });
    }
  }
  return files;
}

function extractPathsFromContent(content) {
  const paths = new Set();
  let m;
  URL_PATH_REGEX.lastIndex = 0;
  while ((m = URL_PATH_REGEX.exec(content)) !== null) {
    paths.add(m[1]);
  }
  VIDEO_SHORTCODE_REGEX.lastIndex = 0;
  while ((m = VIDEO_SHORTCODE_REGEX.exec(content)) !== null) {
    paths.add(m[2]);
  }
  return paths;
}

function collectAllPaths(htmlFiles) {
  const allPaths = new Set();
  for (const { filePath } of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const paths = extractPathsFromContent(content);
    paths.forEach((p) => allPaths.add(p));
  }
  return Array.from(allPaths);
}

async function downloadFile(url) {
  const { get } = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function downloadAll(paths) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  const baseUrl = BASE_URLS[0];
  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (let i = 0; i < paths.length; i++) {
    const relPath = paths[i];
    const localPath = path.join(UPLOADS_DIR, relPath);
    if (fs.existsSync(localPath)) {
      skip++;
      if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${paths.length} (${skip} skipped, ${ok} downloaded, ${fail} failed)`);
      continue;
    }
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const url = baseUrl + relPath;
    try {
      const buf = await downloadFile(url);
      fs.writeFileSync(localPath, buf);
      ok++;
    } catch (err) {
      fail++;
      console.error(`  FAIL ${url}: ${err.message}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${paths.length} (${skip} skipped, ${ok} downloaded, ${fail} failed)`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok, skip, fail };
}

function uploadsPrefix(relDir) {
  return relDir ? '../uploads/' : 'uploads/';
}

function rewriteContent(content, prefix) {
  let out = content;
  // Convert [video ... mp4="URL"][/video] first (while URL is still full), then replace all upload URLs
  VIDEO_SHORTCODE_REGEX.lastIndex = 0;
  out = out.replace(
    VIDEO_SHORTCODE_REGEX,
    (_, before, pathPart) => `<video${before}controls><source src="${prefix}${pathPart}" type="video/mp4"></source></video>`
  );
  out = out.replace(/https?:\/\/www\.futarigurashi\.com\/wp-content\/uploads\//g, prefix);
  out = out.replace(/https?:\/\/futarigurashi\.com\/wp-content\/uploads\//g, prefix);
  // Convert any remaining [video ... mp4="uploads/..." or "../uploads/..."][/video] (e.g. from a previous partial run)
  VIDEO_SHORTCODE_REWRITTEN_REGEX.lastIndex = 0;
  out = out.replace(
    VIDEO_SHORTCODE_REWRITTEN_REGEX,
    (_, before, srcPath) => `<video ${before.trim()} controls><source src="${srcPath}" type="video/mp4"></source></video>`
  );
  return out;
}

// One-off fix: convert [video ... mp4="../uploads/..."][/video] to <video> in all posts (run once)
function fixVideoShortcodesOnly() {
  const htmlFiles = getAllHtmlFiles();
  let rewritten = 0;
  for (const { filePath } of htmlFiles) {
    VIDEO_SHORTCODE_REWRITTEN_REGEX.lastIndex = 0;
    const content = fs.readFileSync(filePath, 'utf8');
    const hasShortcode = VIDEO_SHORTCODE_REWRITTEN_REGEX.test(content);
    VIDEO_SHORTCODE_REWRITTEN_REGEX.lastIndex = 0;
    const newContent = content.replace(
      VIDEO_SHORTCODE_REWRITTEN_REGEX,
      (_, before, srcPath) => `<video ${before.trim()} controls><source src="${srcPath}" type="video/mp4"></source></video>`
    );
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent);
      rewritten++;
    }
  }
  return rewritten;
}

function rewriteAllHtml(htmlFiles) {
  let rewritten = 0;
  for (const { filePath, relDir } of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const prefix = uploadsPrefix(relDir);
    const newContent = rewriteContent(content, prefix);
    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent);
      rewritten++;
    }
  }
  return rewritten;
}

async function main() {
  if (FIX_VIDEO_ONLY) {
    console.log('Converting [video] shortcodes to <video> in all HTML...');
    const rewritten = fixVideoShortcodesOnly();
    console.log(`Rewrote ${rewritten} files.`);
    return;
  }

  console.log('Discovering HTML files...');
  const htmlFiles = getAllHtmlFiles();
  console.log(`Found ${htmlFiles.length} HTML files`);

  console.log('Collecting media paths from wp-content/uploads...');
  const paths = collectAllPaths(htmlFiles);
  console.log(`Found ${paths.length} unique media paths`);

  if (DRY_RUN) {
    if (paths.length === 0) console.log('No wp-content/uploads URLs found.');
    else {
      console.log('\n[DRY RUN] Would download and rewrite. Sample paths:');
      paths.slice(0, 15).forEach((p) => console.log('  ', p));
      if (paths.length > 15) console.log('  ...');
    }
    return;
  }

  if (paths.length > 0) {
    console.log('\nDownloading to uploads/...');
    const { ok, skip, fail } = await downloadAll(paths);
    console.log(`Downloaded: ${ok}, skipped (existing): ${skip}, failed: ${fail}`);
  }

  console.log('\nRewriting HTML to use local uploads/...');
  const rewritten = rewriteAllHtml(htmlFiles);
  console.log(`Rewrote ${rewritten} HTML files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
