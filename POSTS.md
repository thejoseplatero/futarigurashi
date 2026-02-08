# Writing posts with Markdown

## Simple UI (no coding)

Open **writer.html** in your browser (or go to `http://localhost:3765/writer.html` if the writer server is running).

- **Title**, **Date**, **Categories** (comma-separated), **Excerpt** (optional), **Body** (Markdown).
- Click **Download .md** → a `.md` file is downloaded. Move it into `posts/` and add any images to `images/`.
- Optional: run `node writer-server.js` and use **Save to posts/** so the file is written directly into `posts/`.

## Template

Copy `_template.md` when you start a new post. Edit the **frontmatter** (the part between the two `---` lines) and then write your body below.

## Frontmatter (metadata)

```yaml
---
title: "記事のタイトル"
date: 2025-02-08
categories:
  - 旅行
  - ブラジル
excerpt: "一覧用の短い抜粋（任意）"
---
```

- **title** — Post title (required).
- **date** — Publish date (required).
- **categories** — List of categories (optional).
- **excerpt** — Short summary for the index page (optional).

## Images

1. Put image files in the **`images/`** folder (e.g. `images/el-salvador-park.jpg`).
2. In your `.md` file, write:

   ```markdown
   ![説明テキスト（alt）](images/your-photo.jpg)
   ```

3. Optional caption: put a line right under the image:

   ```markdown
   ![公園の写真](images/park.jpg)
   *写真：サンパウロにて*
   ```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`. Keep filenames simple (no spaces).

## Turning MD into HTML

Right now the site is static HTML. To use the `.md` files you have two options:

1. **Manual** — Copy the content from the rendered Markdown into the HTML of `post.html` (or a new post page). Good for few posts.
2. **Build step** — Use a static site generator (e.g. [Eleventy](https://www.11ty.dev/), [Hugo](https://gohugo.io/)) that reads `posts/*.md` and your layout, and outputs HTML. One command rebuilds the site.

If you want, we can add a minimal Eleventy (or similar) setup so `posts/*.md` + `images/` automatically become the live site.
