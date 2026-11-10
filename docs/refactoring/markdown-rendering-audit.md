# Markdown rendering audit (Task 9-B-7)

## Scope and preceding work

Audited `src/components/content/ThreadConversation.vue` on `main`. The preceding changes exist in history and their extracted utilities/components are imported and used: file-change indexing (`562a656`), conversation links (`36c279c`), Plan interpretation (`579f766`), thread-switch guards (`4e76dc2`), and diff viewer presentation (`9d4f6c7`). Their presence is verified; this is not a claim that every historical manual acceptance case was rerun. The earlier structural audit is a historical baseline, including risks subsequently addressed by those commits.

Only the lazy-highlighter trigger changes in production: recognize `~~~` as well as triple backticks. No parser, escaping, link, pagination, scroll, API, persistence, or Telegram changes.

## Reproducible observations

The existing Node setup-script harness executes the real component functions/watchers with reactive props and controlled DOM/animation boundaries. Parser instrumentation is test-only and counts `parseMessageBlocks` entry calls. These are deterministic operation counts, not browser timings or render-frame counts.

| Scenario | Baseline | After focused fix |
| --- | --- | --- |
| Tilde-only incomplete JavaScript fence | Lazy initialization version stays 0; highlighting test fails | Version becomes 1; HTML contains highlighted keyword spans |
| Backtick fence, then language update to Python | Initializes once; highlights both snapshots | Same |
| Warm plain code HTML before highlighter loads | Escaped code | Loader clears HTML/highlight caches; rerender produces highlighted HTML |
| 101 same-ID, same-text block lookups | 1 parser call | Same |
| 20 changed streaming snapshots, each looked up twice | 20 parser calls; 1 message entry | Same |
| Same ID with changed text, then changed cwd | 3 total parser calls including original | Same |
| 400 distinct message IDs | 300 retained message entries | Same |
| Mount setup with 120 messages and loading=false | 120 visible candidates; next messages-array replacement reduces to 50 | Same; deferred |
| Local earlier-history load after windowing | 50 → 80 candidates, order preserved; synthetic height +600 restores scrollTop 10 → 610 | Same |
| Message removed or thread identity changes | Old message cache entry retained; changed text still replaces it correctly | Same; unmount clears entries |

The tilde test failed before the production edit and passed after it. Highlight tests use the real highlight.js common bundle with the async import boundary controlled by the harness. They cover incomplete fences, fence closure and language changes under the same message ID. No speed gain is inferred from these results.

## Pipeline and performance analysis

- This is a custom parser. `getMessageBlocks` checks ID, exact text, and cwd; unchanged messages reuse blocks. `v-memo` also depends on ID, text, cwd, highlight version, and image-failure version. Plans use a separate cached HTML renderer. Inline segments are cached by exact text.
- A changed streamed message reparses its entire current text. Changed fenced code is highlighted in full; unknown or absent languages fall back to escaped text, with no automatic language detection. Incomplete fences consume the remaining lines as code. Existing exact-marker closing behavior is preserved.
- The lazy loader shares one in-flight promise. Successful loading clears code/Markdown HTML caches and increments the version so escaped pre-load output is replaced. The trigger still scans message text using substring searches; it can eagerly load for inline markers and hidden history. This preserves the existing broad backtick trigger. The fix adds one tilde search when the backtick search fails, without splitting text or invoking the parser.
- Cache limits are entry counts: message blocks 300, inline segments 1200, Markdown HTML 300, highlighted code 250. Reads refresh recency. Highlight keys include version, normalized and original language, and code; HTML keys include cwd, version and text. Old streamed prefixes can remain in the content-keyed caches. Deletion/thread switches do not clear these caches; unmount does. No stale rendered text was reproduced with changed text/cwd/language. Byte retention and heap impact are unmeasured.
- Initial `renderWindowStart=0` and non-immediate window watchers permit all preloaded messages at setup. Normal messages-array/loading/thread updates enforce the trailing 50-message window while following output. This bounds message candidates, not descendants or bytes. Reading history expands by 30 without an overall cap. Group-hidden messages can reduce actual mounted rows.
- Earlier history records height/top, awaits Vue, and restores by height delta with a thread-generation guard. Bottom following uses a 16px threshold; history triggers within 200px. Scroll scheduling shares a pending promise and uses animation frames; deep overlay updates have separate bottom-lock work. No thresholds or scheduling changes are made.
- Collapsed command output uses CSS grid/overflow, with full `aggregatedOutput` still passed to `v-text`. Static minimum: output wrapper + inner div + pre = 3 elements and a text node per command, excluding buttons/group wrappers. Line count does not create one DOM node per line, but retained text/layout work can still be large. Browser results, when available, are separate artifacts.
- No new HTTP calls, request fanout, blocking I/O, API payloads, or cache invalidation rules are introduced. The cold tilde-only path now requests the existing lazy highlight chunk once and runs synchronous highlighting, as backticks already do. Unknown-language fallback and generated-HTML escaping remain intact. The ordinary Markdown/inline-code test checks escaping; it is not a comprehensive security audit.

## Prioritized follow-ups

| Priority / scope | Evidence and expected benefit | Risk and required coverage |
| --- | --- | --- |
| 1. Initialize render window at cached mount only | 120 visible candidates in setup instead of 50; reduce initial mounted work | Avoid hiding history or breaking loading/thread transitions. Test full browser mounts, cached/uncached load, rollback shrink, thread changes, scroll anchoring and pagination. |
| 2. Bound caches by retained bytes; assess thread cleanup | Entry limits allow large code/text snapshots; confirmed retention across thread/deletion | Heap benefit unmeasured. Profile long streams and thread churn first; test eviction, cwd/language invalidation and pre/post-load output. Keep cache ownership local. |
| 3. Reduce hidden command-output work | Full output text remains mounted behind CSS collapse | Preserve expansion animation, running-command defaults, selection and copy. Measure large-output heap/layout; test command groups, expansion/collapse, themes/mobile and scroll geometry. Scope to command bodies. |
| 4. Profile then optimize streaming parsing/highlighting | One full parse per distinct growing snapshot; repeated code-prefix highlighting | No frame-time bottleneck established. Measure frame time/long tasks and bytes before considering completed-block reuse or update coalescing. Cover partial fences, edits, language changes, nested Markdown and scroll following. |
| 5. Refine highlight lifecycle only with evidence | Full-history substring scan can trigger on non-fence markers; failed import has no explicit recovery UI | Avoid delaying real code highlighting. Test concurrent streams, import failure/retry, both fence styles and unmount during import. Do not replace the library. |

## Verification boundaries

Unit cases cover ordinary Markdown, inline code/escaping, both fences, incomplete streaming fences, language/content changes, warm-cache invalidation, unchanged lookups, cache bounds/retention, long-history windowing and local scroll restoration. Existing cases cover persisted pagination across thread changes, stale async scroll/image/action callbacks and Undo/Redo. Node tests do not prove browser anchoring, actual paint speed, mobile layout, or live external-server streaming. No runtime speed improvement is claimed.

## Verification results

- `pnpm run typecheck`: passed.
- `pnpm run build`: passed (frontend and ESM CLI).
- `pnpm run test:unit`: 49 files, 482 tests passed, including 17 conversation cases.
- `pnpm run test:integration:fixture`: passed for built CLI and dev wrapper; each used one upstream connection and the independent fixture survived shutdown. This is credential-free protocol verification, not a live authenticated Codex stream.
- `git diff --check`: passed.

Browser Use was unavailable. Playwright used page-context mutation to mount the real component with reactive synthetic props, loading its real CSS and lazy highlight module. Existing listeners on 4173–4178 could not be attributed with `lsof` in the sandbox process namespace; they were left untouched. The current-checkout dev command selected 4179, so the verified URL was `http://127.0.0.1:4179/__markdown-audit`. The route is fulfilled by the browser harness, not a new application route. The temporary browser installation is under `/tmp/task9b7-browsers`.

At each viewport (1280x900, 375x812, 768x1024), assertions passed for initially incomplete tilde-only code highlighting, same-ID Python update, backtick highlighting, collapsed output, expand/collapse, and 50 → 80 actual mounted history rows after an array update. Collapsed output retained 140,000 ASCII characters, 3 elements and a 1px border height. Desktop light and phone dark screenshots were visually inspected. The dark code surfaces are dark. No application styling was changed.

Browser artifacts (absolute paths rooted at `/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`):

| Viewport | Light screenshot | Dark screenshot |
| --- | --- | --- |
| 1280x900 | `markdown-audit-1280-light.png` | `markdown-audit-1280-dark.png` |
| 375x812 | `markdown-audit-375-light.png` | `markdown-audit-375-dark.png` |
| 768x1024 | `markdown-audit-768-light.png` | `markdown-audit-768-dark.png` |

The ignored `markdown-audit.cjs` and `markdown-audit-results.json` in that directory preserve the synthetic browser procedure and observed counts. No TestChat message was sent: this fix changes the loader trigger only, without changing chat parsing or link rendering. Live token delivery, actual browser scroll-anchor geometry during streaming, network-request counts for the full app, frame-time comparisons and heap profiling were not measured. Unit scroll-height restoration and synthetic browser history counts do not replace those checks.

![Phone dark Markdown verification](../../output/playwright/markdown-audit-375-dark.png)
