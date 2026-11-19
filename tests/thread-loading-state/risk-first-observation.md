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

## 04 — Denied-action observation

Open Denied-action inspection. Emit a fixture native completed auto-review with
`review.status=denied`, exact thread/turn/review/item IDs and a public action.
Check identities and collapsed escaped/redacted action details. Repeat the event:
one row remains. An unrelated thread must stay invisible. Approved/non-denial
updates remove the matching denial; disconnect clears all observations. Missing
history is stated. No retry is available without the original native event and
eligibility contract. No command is reconstructed or executed. Cleanup: close.

Automation: `pnpm exec vitest run src/composables/deniedActionObservation.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-denials.cjs`.
Screenshots: `output/playwright/risk-04-{1280,375,768}-{light,dark}.png`.
Performance: zero RPCs and zero extra subscriptions; at most fifty bounded
transient rows globally, 12,000-character action details, no history reload.

## 29 — Native account status

See the [native account controls test](../accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).

## 03 — Permission mutation acceptance gate

Use fixture settings and managed requirements. Read restrictions, choose an
approval/sandbox change with the custom pickers, and confirm the exact thread.
No write is allowed without observed settings and known policy. Full access and
never-approve choices must clearly disclose broader access/reduced oversight.
Workspace write means native cwd, no additional/temp roots, no network. Custom
roots/named managed profiles are not edited here.

Delay acknowledgment and emit matching settings before/after it: completion
requires both. Unrelated/mismatched events cannot complete the request. Double
click sends one write. Native rejection differs from reply loss. Unknown results
block affected-thread sending/actions until fresh native settings are explicitly
reconciled; no blind replay. Reopen and verify actual native state. Managed
restrictions must remove disallowed choices. Other threads/global defaults and
historical generation metadata remain intact. Cleanup: fixture-only; do not
change real user permissions for development.

Commands: `pnpm exec vitest run src/composables/threadPermissions.test.ts src/composables/threadSecurityObservation.test.ts`,
`pnpm run test:unit`, `pnpm run typecheck`, `pnpm run build`,
`pnpm run test:integration:fixture`,
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-permission-changes.cjs`.
Screenshots: `output/playwright/risk-03-changes-{1280,375,768}-{light,dark}.png`.
Performance: one native write, existing native settings event and no history
reload for completion; one explicit requirements read, no additional connection,
polling or startup calls. Live permission-effect verification NOT RUN.

### Native managed ChatGPT sign-in and automatic account verification

Use the [account controls acceptance test](../accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).
The state and wire guarantees are described in the [native account guide](../../docs/native-authentication-state.md).
