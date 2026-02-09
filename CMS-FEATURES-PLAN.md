# Robust CMS Features Plan

## Current state

- **Drafts**: writer-server.js writes drafts to `drafts/<slug>.md` via `POST /api/posts/draft`; list shows draft vs published. Save is **manual only** (button).
- **Published**: `content/<slug>.md`; build reads `content/` and emits `posts.json` + `posts/*.html`. No versioning.
- **Legacy**: `writer-save` (handleSave) writes raw content to `posts/` and is not used by the current writer UI.

---

## 1. Drafts (enhancements)

- **"Revert to draft"** for published posts: move `content/<slug>.md` → `drafts/<slug>.md` (set `draft: true`), run build. New API: e.g. `POST /api/posts/<slug>/revert-to-draft`.
- **Draft list filter**: filter by "Draft" / "Published" / "All" in the writer list.
- **New post** flow: unchanged (saves as draft first).

**Files**: writer-server.js (new route), writer.html (filter UI + revert button).

---

## 2. Auto-save

- **Server**: Reuse `POST /api/posts/draft`; optional `?autosave=1` for logging.
- **Client**: Debounced save (e.g. 2–3 s after last change); "Saving…" / "Saved" indicator; save or warn on `beforeunload`. Only for drafts / new posts.
- **Files**: writer.html (debounce, status, beforeunload).

---

## 3. Revision history

- **Storage**: `revisions/<slug>/<timestamp>.md` (full markdown); optional `revisions/<slug>/index.json` for list.
- **When**: Create revision on publish; optionally on draft save (throttled/capped, e.g. every N min or max 20–50 per post).
- **API**: `GET /api/posts/<slug>/revisions`, `GET /api/posts/<slug>/revisions/<id>`, `POST /api/posts/<slug>/restore` (body: `{ revisionId }`). Restore into draft.
- **Build**: Ignore `revisions/`.
- **Files**: writer-server.js (revision write + 3 routes), writer.html (Revisions panel: list, preview, Restore).

---

## 4. Unsaved changes warning

- Track "dirty" (form !== last saved) and "pending save".
- `beforeunload`: if dirty or pending, prevent leave with standard prompt.
- In-app nav ("Back to list", "View site"): confirm "Discard changes?" or "Save and go".
- **Files**: writer.html (dirty flag, beforeunload, confirm on nav).

---

## 5. Previews

**Goal**: See how the post will look on the live site (with real layout, styles, and markdown → HTML) without publishing.

**Options**:

- **A) Server-rendered preview route (recommended)**  
  - New route: `GET /api/preview?slug=<slug>` or `GET /preview.html?slug=<slug>`.  
  - Server reads current draft or content for that slug (or accepts raw body in POST), runs the same markdown → HTML and post-page template the build uses (e.g. reuse `buildPostPage()` logic from build-from-markdown.js or a shared module), returns full HTML.  
  - Writer opens preview in a new tab (e.g. "Preview" button → `window.open(API_BASE + '/preview.html?slug=' + encodeURIComponent(slug))`).  
  - For **unsaved** content: `POST /api/preview` with body = full form data (or raw markdown); server renders that and returns HTML (or redirects to a temporary preview URL). So preview always reflects current editor state.

- **B) Client-only preview**  
  - In the writer page, a "Preview" pane or modal that renders markdown → HTML in an iframe or div with the site’s CSS loaded. Simpler but may not match build output exactly (different template, no layout).

- **C) Staged build**  
  - On "Preview", write current form to a temp draft, run build with a flag that outputs to `preview/` and serve that. Heavy; only worth it if you need 100% build parity.

**Recommendation**: **A** with POST for unsaved: one "Preview" button that sends current form to `POST /api/preview`, server returns HTML; open in new tab via `data:` URL or a dedicated preview endpoint that stores last preview in memory/session and serves it at `GET /preview/current` (or return HTML in JSON and writer sets iframe srcdoc). Simpler variant: `POST /api/preview` returns `{ html: "..." }` and the client opens a new window and writes `document.write(res.html)` or uses a blob URL.

**Files**: writer-server.js (preview route(s), reuse build’s markdown + template logic or require the build script’s helpers), writer.html (Preview button, call API, open result). Optionally extract `buildPostPage` + markdown into a small shared module used by both build and writer-server.

---

## 6. Other suggestions

- **Trash (soft delete)**  
  Move deleted posts to `trash/<slug>.md` instead of removing; "Restore from trash" and "Empty trash". Build ignores `trash/`.

- **Scheduled publish**  
  Frontmatter `publish_at: 2025-03-01`; build excludes posts where `publish_at` is in the future. Writer: date-time picker and "Schedule" instead of "Publish".

- **Media / uploads**  
  Upload images (or paste) to `uploads/` (or `media/`), insert link into body. List existing uploads, reuse in posts. Avoids external URLs only.

- **SEO / meta**  
  Optional frontmatter: `meta_description`, `og_image`; build outputs into `<meta>`. Writer: optional fields in edit form.

- **Search in writer**  
  Filter the post list by title/slug/category (client-side or `GET /api/posts?q=...`).

- **Keyboard shortcuts**  
  e.g. Ctrl+S = Save draft, Ctrl+P = Publish, Ctrl+Shift+P = Preview (with preventDefault so browser print doesn’t trigger).

- **Conflict detection**  
  On save, send `lastModified` or version; if server copy changed, respond 409 and show "Changed elsewhere. Reload / Overwrite?".

- **Permalink / slug lock**  
  Once published, optionally "lock slug" so changing title doesn’t change URL (avoid broken links). Store canonical slug in frontmatter.

- **Bulk actions**  
  In list: select multiple posts → "Move to trash", "Change category", "Revert to draft".

- **List columns**  
  Sort by date, title; optional column for "Last modified" (from file mtime or from revision index).

---

## Implementation order

1. Auto-save  
2. Unsaved changes warning  
3. Revision history (storage, APIs, UI)  
4. **Previews** (server preview route + Preview button)  
5. Draft enhancements (revert to draft, list filter)  
6. Then: trash, scheduling, media, SEO, search, shortcuts, conflict, bulk as needed.
