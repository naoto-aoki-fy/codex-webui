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

## 29 — Authentication inspection

Open Settings → Native authentication details → Read authentication details.
Check native provider/account/email/workspace and server-allowed methods.
Signed out, unknown account, empty policy and unavailable restrictions remain
distinct. No credentials/token/routing blob is shown. No login/refresh-token
request is initiated. Delay a read across disconnect/profile change: the old
account must not reappear. Test both themes and all three supported viewports.
Cleanup: close; no authentication state changed.

Automation: `pnpm exec vitest run src/api/authInspection.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-auth.cjs`.
Screenshots: `output/playwright/risk-29-{1280,375,768}-{light,dark}.png`.
Performance: two explicit lazy native reads, fixed small account projection,
twenty method identifiers maximum, no poll/listener. Live acceptance NOT RUN.

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

## 23 — Active user/profile model defaults

Read configuration and expand Active user configuration model defaults. Confirm
the server-supplied file, active profile (or explicit base-user scope) and version.
Edit only a model identifier or low/medium/high default effort, then confirm.
No legacy profile table, secret, unknown key, other file or experimental flag is
edited. Model availability still follows the native catalog. A project layer can
override the saved value; existing threads retain their overrides.

Double-click: one write. CAS/version conflict is rejected with no replay. Lost
response: outcome unknown, disable more writes, read actual configuration and
explicitly acknowledge inspection. Verify saved-layer value after success and
after refresh. Missing/ambiguous active layers disable writes. Change connection
or project during reads/writes: discard stale results and report uncertainty.
Cleanup: fixture config only; restore disposable fixture values if manual.

Commands: `pnpm exec vitest run src/api/userConfigDefaults.test.ts src/api/configInspection.test.ts src/api/codexRpcClient.test.ts src/api/mcpConfiguration.test.ts`,
`pnpm run typecheck`, `pnpm run build`, `pnpm run test:integration:fixture`,
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-config-changes.cjs`.
Screenshots: `output/playwright/risk-23-changes-{1280,375,768}-{light,dark}.png`.
Performance: one targeted write and one post-write config read; no polling,
automatic reload, thread resume or extra startup requests. Generic default config
error responses remain unchanged, verified alongside the new opt-in response.

Shared failure injection: return native `-32603` after persisting a fixture write,
then disconnect/reconnect. Queue, permission and config controls must retain an
unknown outcome and require inspection; a numeric error alone is not rejection.
Only verified validation/method errors are definitive rejections. Inject a very
large error containing credential assignments: at most 2,000 characters are
processed/rendered and recognizable credentials are redacted. Generic RPC error
objects remain unchanged for unrelated consumers.

## 21 — Future-load Hook policy changes

Read loaded Hooks, then Read saved Hook policies. Only complete user/project
command/MCP definitions expose actions. Check actual loaded state separately from
the selected user/profile file's saved overrides. Prepare enable/disable or trust
approval; review the exact definition, origin, hash, file and effects, then confirm.
One native key/field is saved with expected-version CAS. Saving trust preserves
enablement; disabling preserves trust. Other Hooks/config/secrets remain intact.

No reload or execution is requested. Loaded threads can retain their prior state;
do not claim they were disabled immediately. Managed/plugin Hooks and revocation
remain outside this limited editor. Change the loaded hash during preflight:
reject before writing. Reject CAS; lose a persisted-write response; emit disconnect
or navigate during preflight. Never send a later write to a replacement owner.
Read saved state and explicitly acknowledge unknown outcomes before further edits.
The UI never calls cwd-based Hook listing, whose native plugin discovery can
migrate legacy trust. Cleanup: fixture policies only; no real Hook executes.

Commands: `pnpm exec vitest run src/api/hookPolicy.test.ts src/api/hooksInspection.test.ts`,
`pnpm run typecheck`, `pnpm run build`, `pnpm run test:integration:fixture`,
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-hook-policies.cjs`.
Screenshots: `output/playwright/risk-21-policies-{1280,375,768}-{light,dark}.png`.
Performance: at most 100 loaded declarations, one policy config read and three
calls per save (native preflight/write/saved verification), no scans or listeners.

## 33 — Native Daybreak inspection

Open Native Daybreak status → Read native Daybreak status. Check exact thread
choice (false/unset/missing remain distinct) and the default provider's native
caller-advertised model programs. A model name containing Daybreak does not prove
access; missing metadata differs from an explicitly empty list. Page lazily up
to 100 rows. No preference/program/flag changes and no turn is started. Delayed
reads cannot populate a replacement connection/thread. Check themes and sizes.
Cleanup: close; no server state changed. This is separate from security scans.

Commands: `pnpm exec vitest run src/api/daybreakStatus.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-daybreak.cjs`.
Screenshots: `output/playwright/risk-33-{1280,375,768}-{light,dark}.png`.
Performance: zero startup calls; two initial reads, one per explicit additional
catalog page; twenty rows/page, 100 retained rows, no new subscriptions/history.

### Native managed ChatGPT sign-in (29, partial)

Prerequisites: credential-free intercepted App Server; signed-out default provider,
explicit native `allowed_login_methods: [chatgpt]`, and a complete inventory of at
most 20 loaded idle threads. Run `node scripts/test-risk-native-authentication.cjs`
with the documented Playwright browser path. Never sign in a real account here.

Actions: open Settings → Native Codex sign-in; prepare; review scope and confirm;
start browser or device-code sign-in. Cancel the identified attempt, then simulate
matching completion and actual account change. Inject an unrelated completion,
expiry, cancellation/completion race, internal error and disconnect during start.

Expected: no login on opening/preparing; all loaded activity is checked without
resume/history reads. Only explicit confirmation starts native login. Cancellation
uses the exact ID. Codes/URLs remain in memory and clear on completion/cancel or
connection change. Unrelated completion is ignored; success requires matching
native completion and account read. Sending stays paused until explicit reconnect
and page reload invalidate account caches. Unknown writes never replay. Existing
signed-in accounts, unknown policy, external credentials and excess inventory are
rejected by this limited workflow. Check all three viewports in both themes.

Cleanup: close fixture browser contexts; no live account mutation. A real pending
attempt remains server-owned; closing a panel is not a cancellation guarantee.
