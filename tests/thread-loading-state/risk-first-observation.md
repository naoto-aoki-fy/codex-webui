# Risk-first native observation panels

Prerequisites: development server at `127.0.0.1:4173`, independently managed
supported App Server for manual use. Automated checks intercept RPC/WS traffic;
they require no credentials and do not mutate user resources.

## 05 — Subagent visibility

1. Open a conversation, then Conversation tools → Subagents. No request occurs
   until **Read subagents** is pressed.
2. Read the active direct children; inspect one preview and follow its native
   thread link. Return to the parent: its draft and running work remain intact.
3. Toggle Archived children and read again. Page through large results; the UI
   stops at 200 rows and rejects repeated cursors or an ignored parent filter.
4. Test empty/error/unsupported replies, double-click, delayed read followed by
   navigation, and a connection/profile change. Old results must not repopulate.
5. Check light/dark at 1280×900, 375×812 and 768×1024. Previews are escaped,
   bounded and collapsed. No child history is loaded by inspecting metadata.

Expected: exact native parent/child identity, status, role and navigation, with
unknown fields displayed honestly. No spawning, termination or recursive loading.
Cleanup: close the panels; no server state was changed.

Automation: `pnpm exec vitest run src/api/subagents.test.ts`, `pnpm run typecheck`,
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-subagents.cjs`.
Screenshots: `output/playwright/risk-05-{1280,375,768}-{light,dark}.png`.

Performance audit: browser fixture asserts zero child requests before use; first
read uses one native child page and one metadata read, inspection one metadata
read, subsequent pages one request each. Twenty rows/page, 200 retained rows,
4,000-character previews, no new subscriptions or polling. Live timings NOT RUN.

## 21 — Hooks inspection

Open Conversation tools → Hooks inspection → Read Hooks. Check native event,
exact key, enabled/managed/trust values, then expand definition/origin/hash.
Disabled and untrusted are independent states. Commands are displayed as inert
text with recognizable credential assignments redacted. Test no scopes, no
Hooks, malformed definitions, unavailable API, repeated clicks, and disconnect
during a delayed read. Changing thread/profile clears the snapshot.

Expected: no Hook execution, trust or config write. Cleanup: close the panel.
Automation: `pnpm exec vitest run src/api/hooksInspection.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-hooks.cjs`.
Screenshots: `output/playwright/risk-21-{1280,375,768}-{light,dark}.png`.
Performance: zero reads before use, one thread-scoped `hooks/list` per refresh,
100 rendered definitions total, ten bounded warnings/errors per scope, no new
subscription, polling or resume. No live timing was measured.

## 23 — Configuration inspection

Open Configuration inspection → Read configuration. Expand setting origins,
layers, named profiles and managed restrictions. The remote project cwd must be
shown. Thread overrides can differ from these project defaults. Only selected
public settings are displayed; arbitrary keys, secrets and internal instructions
must not appear in any layer or profile view. Test null requirements, omitted
layers, empty profiles, malformed results, API failure and delayed disconnect.
Changing project/connection clears all results. No setting is changed. Cleanup:
close the panel.

Automation: `pnpm exec vitest run src/api/configInspection.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-config.cjs`.
Screenshots: `output/playwright/risk-23-{1280,375,768}-{light,dark}.png`.
Performance: no startup reads; exactly two requests per explicit refresh,
independently handled failures; 40 layers/100 profile names/12,000 characters per
projected value, collapsed layer/profile details; no subscriptions or polling.
Large fixture projection is unit-tested. Live performance NOT RUN.

## 28 — External-agent configuration manifest

Open External-agent import preview. Choose Claude Code or Cursor using the custom
picker; press Discover import candidates. Verify the exact remote cwd and source.
Review resource descriptions/destinations and expand public identities. Skills,
plugins, MCP lifecycle and memory extensions remain skipped. Home/session/connector
discovery is not requested. Conflict/content-diff availability must be stated
honestly; there is no import button. Test empty, unsupported/malformed, delayed
disconnect and source/project changes. No content is executed. Cleanup: close.

Automation: `pnpm exec vitest run src/api/importPreview.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-import.cjs`.
Screenshots: `output/playwright/risk-28-{1280,375,768}-{light,dark}.png`.
Performance: one lazy detect RPC per action; 100 manifest rows, twenty identities
per resource class, bounded/collapsed details. Native repository scan timing was
not measured live. No repeated subscriptions or client filesystem recursion.

## 03 — Effective permission inspection

Open Permissions inspection. A normally resumed thread displays its observed
approval policy/reviewer, sandbox, writable roots and active-profile provenance.
Absent native evidence must show Unknown; config defaults are not substituted.
Read permission restrictions explicitly and check managed restrictions. A native
settings update supersedes an older in-flight resume response. Other-thread
events must not alter the selected snapshot. Disconnect/profile change clears
snapshots; no resume or write is issued just to inspect permissions.

Automation: `pnpm run test:unit`, `pnpm run typecheck`,
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-permissions.cjs`.
Screenshots: `output/playwright/risk-03-{1280,375,768}-{light,dark}.png`.
Performance: zero extra resume/startup requests, one lazy restrictions read,
100 bounded transient snapshots, one existing event owner, no persistence or
subscription. Native ordering/stale-resume and eviction are unit-tested.
Cleanup: close; all controls are read-only in this scope. Live NOT RUN.
