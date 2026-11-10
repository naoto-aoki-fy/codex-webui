# Conversation link utility characterization

## Setup and actions

- Start the current checkout on `http://127.0.0.1:4173` with a working external app-server and a TestChat thread.
- Send a unique marker followed by `[/tmp/a (copy).ts](</tmp/a (copy).ts>)`, `[site](https://example.com/a?q=1&b=2)`, `[thread](codex://threads/abc-123)`, and a quoted Windows path.
- Inspect the actual rendered message row in light and dark themes. Assert `hrefOk`, `titleOk`, and `textOk` for each link. Save `output/playwright/testchat-conversation-links-cjs.png`.
- Confirm the file href is `/codex-local-browse/tmp/a%20(copy).ts`, title is `/tmp/a (copy).ts`, and label is `/tmp/a (copy).ts`. Confirm HTTP destinations and custom labels remain unchanged; thread links use the current origin and base pathname.
- Confirm incomplete Markdown and unsupported schemes retain their previous rendering; do not click unsafe schemes.
- Cleanup: delete the temporary TestChat thread if created. No source files need rollback.

## Extraction boundary and caller map

`src/utils/conversationLinks.ts` owns the existing pure algorithms:

- `getBasename`: file segments in plain, Markdown, and code-aware inline parsing.
- `parseFileReference`, `trimLinkWrappers`, `parseMarkdownLinkToken`, `readAsteriskLinkWrapper`: the same inline parsers, plus browse URL construction. Internal path detection, file URL decoding, and asterisk counters stay private.
- `normalizePathSeparators`, `normalizePathDots`, `resolveRelativePath`: file-change display paths and browse URL construction; home inference stays private.
- `toLocalThreadUrl`: plain, Markdown, and code-aware parsing through the component's browser/SSR context adapter.
- `toBrowseUrl`: attachment, skill, inline file anchors, generated Markdown anchors, and the context menu through the component's cwd adapter.
- `toRenderableImageUrl`: existing Markdown image rendering.

The component retains inline segment construction, Markdown scanning/rendering, escaping/sanitization, visible labels and titles, all caches and invalidation, DOM events, clipboard, menus, and navigation. HTTP recognition and unsupported-scheme fallback remain at their existing rendering call sites.

## Performance review

The extracted module has no imports, reactive state, watchers, requests, caches, or module initialization work beyond function declarations. Calls remain at their existing sites, with location/cwd passed through thin adapters. No extra parsing pass, blocking I/O, request fanout, payload, or cache invalidation is introduced. Browse URLs were already computed from templates; that frequency is unchanged. No runtime speed improvement is claimed or measured.

Unit characterization deliberately preserves greedy colon suffix parsing, best-effort malformed percent decoding, nested wrapper ordering, and `encodeURI` reserved characters. These are compatibility cases, not new parsing rules.
