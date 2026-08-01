# Sprintster Request: insert images into a markdown body from the editor

**From:** sprintster-cms (client) · **To:** sprintster core team · **Date:** 2026-07-26

## What we want to use

A way to get an image into the body of a `markdown` field from inside the editor: pick a
file (or paste, or drag one in), have it uploaded, and have a markdown image inserted at the
cursor.

## Why we need it

There is no image affordance in `packages/web/src/ui/MarkdownEditor.tsx` today. The only
image path in the CMS is the `image` property type, which covers `cover` and `ogImage` but
nothing inside prose.

So an author who wants a picture in the middle of a post must switch the combo editor to
source mode and hand-type:

```markdown
![A blue cover](/assets/a2a08d0b4b5367642518f54c522111799684a8dc47cb9fb37af3bb6c3b580625)
```

They have to obtain that 64 character hash first, which means uploading the file somewhere
else and reading the response. In practice nobody will do this.

It blocks us concretely: `scms build` resolves in-body image references, processes them with
sharp into a responsive `<picture>`, and rewrites the URL. We can build and test that only
against content our seed script fabricates, because the editor cannot produce it. A feature
whose only input is synthetic is a feature we cannot trust.

## Suggested shape

The pieces already exist. `uploadAsset(file)` in `packages/web/src/api/assets.ts` does the
multipart `POST /assets` and returns `{ hash, filename, contentType, size }`, and the editor
gained a toolbar in `08d0bd7`.

1. **Toolbar button** in the WYSIWYG: file picker, upload, insert at the cursor.
2. **Paste and drag** are the interactions authors actually reach for, especially paste for
   screenshots. Same upload path.
3. **Alt text**: prompt on insert, or let it be edited in place afterwards. It ends up inside
   the markdown, so it needs to be authorable.

Content addressing makes this pleasant: pasting the same screenshot twice uploads once and
yields the same hash, so there is nothing to deduplicate.

## The one constraint that matters to us

**Insert the root-relative form, `/assets/<hash>`, never an absolute URL.**

`assetUrl()` in `web/src/api/assets.ts` returns `${resolveApiBaseUrl()}/assets/${hash}`.
That is an empty prefix when the daemon hosts the bundle, but a full origin whenever
`VITE_API_URL` is set. If that value reaches the stored markdown, the content itself becomes
environment specific: bodies authored against a dev daemon would carry
`http://127.0.0.1:3939/...` into the database, and every generated page would point at
someone's laptop.

Rendering may resolve the URL however it likes. Only the stored string needs to stay
root-relative.

Two smaller points in the same spirit:

- **Store plain CommonMark**, `![alt](/assets/<hash>)`, not an HTML `<img>` and not a custom
  node syntax. Our generator parses bodies with markdown-it and rewrites the `image` token.
  Anything else means our pipeline has to special-case sprintster-flavoured markdown.
- **No dimension metadata needed** in the markdown. We read the real dimensions from the blob
  at build time, so please do not encode width or height into the URL or a title attribute.

## Not asking for

TUI parity. Inserting images from a terminal editor is a much worse fit, and source mode
remains available there for anyone who needs it.

## Acceptance

- An author can insert an image into a body from the WYSIWYG without leaving the editor or
  knowing what a hash is.
- The stored markdown contains `![alt](/assets/<hash>)` with a root-relative URL, verified by
  reading the row back from the API rather than by looking at the rendered editor.
- Alt text is authorable and round-trips.
- Pasting the same image twice results in one blob.
