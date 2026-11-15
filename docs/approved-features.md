# Approved feature implementation and evidence

Scope: 01, 02, 06, 08, 12, 15–20, 25, 31. Ceiling: medium regression risk.
Starting state: clean `main`, `99acc2c`; no merge/rebase in progress.
Read PROJECT_SPEC.md, product-requirements.md, native-project-migration.md,
app-server-client-boundaries.md, conversation-tools.md and its verification record.
No deployment mutations or live model turns are authorized for this pass.

Authoritative runtime evidence: OpenAI Codex release `rust-v0.169.0`, commit
`d32063f96c2dff1dc96af839b3952abb6acfeda4`, downloaded directly from upstream.
Contracts below refer to `codex-rs/app-server-protocol/src/protocol/v2/` and
implementations in `codex-rs/app-server/src/request_processors/` at that revision.
The server must expose each optional API; fixture acceptance does not establish
that a connected deployment supports it. The bundled catalog is not negotiation.

| ID | Existing behavior | Minimum useful scope / evidence | State and verification / reassessed risk |
| --- | --- | --- | --- |
| 06 | Normal history and single live notification owner; MCP/search items omitted | Bounded, collapsed safe execution details; `item.rs`, `mcp.rs`; same item IDs in history/events | Existing message overlays only; normalization, ordering, malformed/large/secret tests, theme/device fixtures; medium |
| 12 | Remote `command/exec`, filesystem services; turn diffs | Explicit working-tree read via fixed Git argument arrays, separate index/worktree patches, lazy untracked previews | Connection/project-scoped disposable results; no Git writes or polling; Git fixture/error/bounds tests and browser; medium |
| 02 | Context usage events, turn lifecycle, normal history | Explicit `thread/compact/start`; thread_processor submits `Op::Compact`, empty reply is acknowledgment only | Native context only; idle guard, pending/event completion/failure/uncertainty; fixtures and browser; medium |
| 01 | Review protocol exists, not surfaced | Inline `review/start` only; review.rs and turn_processor support four distinct target variants | Native conversation history; block active work, use existing interruption, render review boundaries; fixtures/browser and metadata regressions; medium |
| 08 | Command history, no process manager | Native paginated thread background list and exact process termination, no bulk clean | Native loaded thread resources only; list is manageable processes, no output in list contract; recent output from known item if available; fixtures/browser; medium |
| 25 | Goal/Plan/Skills slash suggestions, drafts | Discover actual actions; profile-scoped bounded text presets and submitted prompt history | Browser text only, no attachment bytes; editable selection; storage failure/IME/settlement regressions and browser; medium |
| 15 | Native Fork, optional ephemeral API | Investigate separate question isolation; ephemeral alone does not constrain MCP side effects | Block if native read-only tool isolation/lifecycle requires engine overhaul; no mutation probes; high for full scope |
| 18 | Skill/attachment composer inputs | Lazy available-app picker with exact native `mention` / `app://id` semantics; apps.rs, turn_start fixture | Draft/input schema and profile reset; exact serializer and draft tests, fixtures/browser; medium |
| 20 | Existing memory default retained | Read native readiness and selected thread summary; memory.rs; contribution control only with readable effective mode | Server state, no global writes/reset; unknown/null remain explicit; fixtures/browser; low for reads, medium for settings |
| 16 | MCP status/OAuth/reload/tools | Investigate targeted safe definition editing; no blind whole-config round trip | Config layers/version/secrets; blocked unless exact entry preservation and effective-state reconciliation established; high until proven |
| 19 | Installed skill list/details/toggle/selection | Investigate extra roots and plugin-owned workflows | `skills/extraRoots/set` replaces shared roots; no getter in contract. Avoid shadow registry/root overwrite; high until safe ownership established |
| 17 | No Marketplace UI | Investigate useful read-only browsing; plugin/list implementation starts background synchronization even without forceRefetch | No feature flags/install/sync mutations. Experimental lifecycle unsupported by repository policy; reads only if safe subset verified; medium reads / high mutations |
| 31 | Existing remote transport stays independently managed | On-demand status and client list; remote_control.rs and transport tests | No enable/pair/revoke/infrastructure changes; environment ID from status only, paged reads scoped to connection; fixtures/browser; low |

Feature 22 remains blocked, 33 excluded, other excluded IDs untouched.
09 remains fixture-validated with incomplete live acceptance: empty restore succeeded
but native active list omitted it after refresh; nonempty restore NOT RUN. This is
not a confirmed upstream defect. 11 live multi-page/persisted Portable export NOT RUN.
24 accepted for available live data; other states fixtures. 32 accepted for observed
connection/copy/reconnect; adversarial warning/redaction fixtures. No pending live
09/11 acceptance will be resumed without designated data.

Baseline: production build at 99acc2c using the existing locked dependencies;
copy retained in /tmp/approved-baseline/dist for identical-fixture comparison.
Each feature receives focused tests, manual acceptance and a code-path performance
audit; final full suite/build/integration/CLI and browser matrix follow.

## 06 validation

Implemented public MCP/search details in existing normalization and live owner.
`pnpm exec vitest run src/api/normalizers/executionDetails.test.ts src/api/normalizers/v2.test.ts src/composables/useDesktopState.test.ts`: 85 passed.
`pnpm run typecheck`: passed. Browser execution matrix: passed, 3 viewports × 2 themes;
history/live/progress/dedup/no history reads, public-text redaction and safe markup.
No parser/link code changed. Live validation NOT RUN. Risk: medium.
