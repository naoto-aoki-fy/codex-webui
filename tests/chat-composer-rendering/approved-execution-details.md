# MCP and Web search execution details (06)

Setup: supported external server or `scripts/approved-fixture.cjs` interception.
Run `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-approved-execution.cjs`.
Open the fixture conversation; expand MCP and Web search rows. Expect public text,
arguments/query, actual status, empty versus unavailable results, no executable
markup or internal metadata. Emit started/progress/completed events: one row must
update in place without history reads. Reopen history and compare IDs/order.
Check 1280×900, 375×812, 768×1024 in both themes. Cleanup: close fixture browser;
no remote changes or persistent settings are made.

Performance: zero extra startup/history RPCs or listeners. Normalization visits at
most 200 nodes, 5 levels, 40 entries per collection and 12,000 text characters per
item; details collapsed, rendered as text. Existing message windowing applies.
Live item events use the existing overlay and do not reload history. Fixture
asserts no extra thread/read calls across item lifecycle events. Live latency and
large-history heap use were not measured.

Structured MCP results: supply public structuredContent along with empty/nonempty
text blocks and private _meta/debug/credential fields. Expect bounded public JSON
as inert text, private fields omitted, and no Empty result claim when structured
results exist. This uses the same bounded formatter; no extra reads are made.
