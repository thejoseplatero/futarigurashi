# FUTARIGURASHI — Recreated theme

A clean, fixed recreation of the [Futarigurashi](https://www.futarigurashi.com/) WordPress blog theme. Same structure and content organization, modern HTML/CSS, no WordPress. **All 415 posts** from the WordPress export have been imported as static HTML.

## What’s included

- **index.html** — Home: title, RSS/profile links, latest posts, category sidebar
- **post.html** — Sample single post (El Salvador travel)
- **profile.html** — プロフィール page
- **category.html** — Category archive example
- **archive.html** — Older posts list
- **styles.css** — Layout, typography (Noto Sans JP + Libre Baskerville), responsive design

## Improvements over the original

- Semantic HTML5
- Responsive layout (sidebar stacks on small screens)
- Accessible links and structure
- No PHP/WordPress; static files only
- Simple, maintainable CSS with variables
- Fast load (no WordPress DB or plugins)

## Re-import WordPress export

To re-run the import (e.g. after a new export):

```bash
npm install   # if not done
npm run import-wp
# or: node scripts/import-wp.js /path/to/your-export.xml
```

This reads the WXR file, generates `posts/<slug>.html` for each post, updates `data/posts.json`, and regenerates `index.html`, `archive.html`, category pages, `robots.txt`, `sitemap.xml`, and `feed.xml`.

**SEO / canonical URLs:** Set your site’s public URL so canonical links, sitemap, and feed point to the right domain:

```bash
SITE_URL=https://yoursite.com node scripts/import-wp.js
```

If unset, URLs default to `https://yoursite.com` (replace in templates or set `SITE_URL` when you deploy).

## Push to GitHub (one-time setup)

If `git push` fails with "could not read Username" or "Permission denied", authenticate Git with GitHub once:

**Option A — GitHub CLI (recommended)**  
In Terminal (or Cursor’s terminal):

```bash
brew install gh   # if needed
gh auth login
```

Choose GitHub.com → HTTPS → log in in the browser. Then:

```bash
cd /Users/jp/apps/beacon/futarigurashi
git push -u origin main
```

**Option B — SSH**  
Add your SSH key to GitHub (Settings → SSH and GPG keys), then:

```bash
git remote set-url origin git@github.com:thejoseplatero/futarigurashi.git
git push -u origin main
```

## Writer (CMS)

The writer is a simple CMS: **post list** (all posts + drafts), **edit/create** form, **Save draft** (saves to `drafts/`) and **Publish** (saves to `content/`, runs build, then `git push`). No terminal needed for your wife.

**Run the writer (local):**

```bash
node writer-server.js
# Open http://localhost:3765/writer.html
```

- **記事一覧** — list of all posts (published + drafts). Edit, Delete, 新規記事.
- **下書き保存** — saves to `drafts/<slug>.md`; post does not appear on the site.
- **公開する** — saves to `content/<slug>.md`, runs `npm run build`, then `git add` / `commit` / `push`. Site updates after GitHub Pages deploys.

**Build from Markdown (without writer UI):**

```bash
npm run build
# or: node scripts/build-from-markdown.js
```

This merges `content/*.md` into the post list, regenerates index, page/, archive, sitemap, feed. Existing category sidebar is left unchanged.

**Config (environment variables)** — defaults are for localhost; override when you run on a server:

| Variable      | Default | Description |
|---------------|---------|-------------|
| `PORT`        | `3765`  | Port to listen on. |
| `BIND`        | `0.0.0.0` | `0.0.0.0` = reachable from network (for server); `127.0.0.1` = local only. |
| `WRITER_BASE` | `http://localhost:3765` | Base URL of the writer (for redirects / links). |
| `SITE_URL`    | `https://thejoseplatero.github.io/futarigurashi` | Public blog URL (used for “back to blog” link). |
| `REPO_ROOT`   | this directory | Repo path (used when you add publish/build). |
| `WRITER_MODE` | auto | `local` or `server`; set explicitly if you want. |

**Running on a server later:**  
Clone the repo on the server, install Node, then run with env set, e.g.:

```bash
PORT=3765 BIND=0.0.0.0 \
WRITER_BASE=https://writer.yoursite.com \
SITE_URL=https://thejoseplatero.github.io/futarigurashi \
REPO_ROOT=/var/www/futarigurashi \
WRITER_MODE=server \
node writer-server.js
```

Put the writer behind HTTPS and add auth (e.g. reverse proxy with basic auth or a login page) so only your wife can access it.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
cd futarigurashi
npx serve .
# or: python3 -m http.server 8000
```

Then open http://localhost:3000 (or 8000).

## Customization

- **Colors:** Edit `:root` in `styles.css` (e.g. `--color-accent`, `--color-bg`)
- **Fonts:** Swap the Google Fonts link in each HTML file if you want different type
- **RSS:** The import generates `feed.xml` (Atom, 50 latest posts). The template includes a feed link in the head or point “このブログを購読する” to your feed URL
