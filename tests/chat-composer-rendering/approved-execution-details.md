# MCP and Web search execution details (06)

Start `pnpm run dev --host 127.0.0.1 --port 4173`. With Playwright Chromium
installed, run `node scripts/test-approved-execution.cjs`. Set
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers` if using the shared browser
cache. The script intercepts RPCs and notifications with `scripts/approved-fixture.cjs`
at `http://127.0.0.1:4173/#/thread/approved-fixture`.

1. Compare a standalone Web Search, an MCP call and an `N web searches` row with
   `N commands` at 1280×900, 375×812 and 768×1024, in light and dark. Expect the
   same left edge, label alignment, 32px row height, 16px label line height and
   normal conversation spacing. The execution rows have 0px outer margin.
2. Open a standalone search and MCP call. Expect public arguments, query,
   status and results as readable plain text. Check the difference between
   empty and unavailable results. Script-like text stays visible as text, and
   credentials and internal metadata are omitted.
3. Open a collapsed Web Search group. Expect the group header at the first
   search's position and its headings in chronological order. Select one
   heading and then another. Only the current selection should show details.
   Verify one-line query labels, ellipsis on a long query and the `Web search`
   fallback for an empty query. Close and reopen the group to see the selection
   again.
4. Check searches around MCP calls, commands, replies, saved question answers
   and turn boundaries. These items interrupt or separate groups. Open a live
   search and MCP row, then emit progress and completion events through the
   fixture. Each open row should update in place without duplicate rows or
   history requests. If another search joins a standalone search whose details
   are already open, its details should stay visible inside the group.
5. Click `Load earlier messages`. The fixture starts with one turn containing
   three native items and retrieves two older turns containing three more items
   in one `thread/turns/list` request. Verify the same IDs and order after opening
   the older group. Searches outside the current render window appear only
   after loading that window. If loading expands an existing group to include
   earlier searches, the group retains its open or closed state and its selected
   search.

The script saves six screenshots under `output/playwright/` and closes its
browser. It uses isolated browser contexts and fixture data.

Grouping scans the visible messages once and renders details on expansion.
The fixture recorded identical history requests and item counts before and
after the change, with no history requests during live item updates.

Structured MCP results: supply public structuredContent along with empty/nonempty
text blocks and private _meta/debug/credential fields. Expect bounded public JSON
as inert text, private fields omitted, and no Empty result claim when structured
results exist. This uses the same bounded formatter; no extra reads are made.
