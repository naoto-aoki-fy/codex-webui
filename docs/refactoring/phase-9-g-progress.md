> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# Phase 9-G progress

## Status and accepted policy

Authorized Phase 9-G focused work and final integration audit are complete.
Resumed clean `main` at `a9cf361`; all work stayed on `main`, with no pushes.
The user authorized optimistic Undo conflict detection and explicitly accepted
the external-writer race between final validation and mutation. The prior
concurrency blocker is lifted; it is not fully resolved or hidden.

See [final audit](phase-9-g-final-audit.md) for invariants, scope, performance,
remaining risks and policy-dependent decisions. Earlier findings and the initial
blocked investigation remain in Git history and the
[data-safety audit](phase-9-g-data-safety-audit.md).

## Completed task inventory

| Task | Result | Commit |
|---|---|---|
| G-1 | Remove destructive Undo HEAD/index restoration; validate additions/updates; protect rename targets; refuse absent preimages; truthful partial results and patch scope | `d4df8ca` — `fix: preserve user edits during unsafe Undo reversals` |
| G-1 report | Record accepted policy and verified milestone | `05a6b19` — `docs: record verified preservation-first Undo milestone` |
| G-2 | Guard all realtime completion cleanup before it can retire a newer active turn; keep historical sync | `b331362` — `fix: guard all completion cleanup by active turn ownership` |
| G-3 characterization | Reproduce page-first detail loss and post-archive response resurrection using deterministic deferred promises | `35f2727` — `test: characterize history refresh and archive response races` |
| G-3 fix | Preserve earlier history/absolute indices; invalidate pruned/archived read owners, metadata and flags; protect replacement reads | `3d8757f` — `fix: retain paginated history and invalidate retired thread reads` |
| G-3 edge | Preserve exhaustion from an empty older page during overlapping refresh | `a602aef` — `fix: preserve empty-page pagination exhaustion during refresh` |
| G-4 | Audit connection deadlines, settlement, disconnect/replacement, correlation, Resume eviction, HTTP lifetime and no replay; 53 focused tests pass | Audit-only; no RPC policy changes |
| G-5 | Audit retention, streaming, projections, catalogs, workspace cache, subscriptions, timers, normalization and synchronous persistence | Audit-only beyond G-3 cache retirement; no speculative optimizations |
| Final | Review production diff and integration boundaries; run complete required verification and CJS smoke | Final documentation commit in Git history |

The G-3 characterization commit used three expected-failure assertions to record
reproduced violations. The subsequent fix converts them to ordinary passing
regression tests. No expected-failure test remains in those cases.
The original concurrent-editor characterization from `d6d215e` is retained as
paired tests: pre-final-validation edits are detected, post-validation writes
still reproduce the accepted race. No production excluded functionality changed.

## Verification

Each production commit passed the requested sequential checks:

| Milestone | Typecheck/build | Unit tests | WebSocket then Unix fixtures |
|---|---|---|---|
| G-1 | Passed | 77 files / 1,208 tests | Both passed |
| G-2 | Passed | 77 files / 1,211 tests | Both passed |
| G-3 | Passed | 77 files / 1,218 tests | Both passed |
| Empty-page correction / final integration | Passed | 77 files / 1,219 tests, 10.96 s | Both passed |

Focused checks:

- G-1 helper/bridge: 39 tests, 1.25 s.
- G-2 desktop messages: 149 tests, 1.43 s.
- G-3 desktop messages: 156 tests, 1.46 s.
- Final desktop messages including empty page: 157 tests, 1.47 s.
- G-4 transport/RPC/Resume/notification lifecycle: 53 tests, 0.83 s.
- `git diff --check` passed; final diffs reviewed before staging.

Post-build CJS public executable smoke passed, exit 0, CLI help output:

```sh
node --input-type=commonjs -e "process.argv=['node','dist-cli/index.js','--help']; require('./dist-cli/index.js')"
```

This is an executable CLI entry, not a library export assertion. No production
module dependency edges were added; import signatures and persistence/wire DTOs
were unchanged by diff inspection.

Logs (transient local evidence): `/tmp/9g1-{focused,typecheck,build,unit,ws,unix}.log`,
`/tmp/9g2-{focused,typecheck,build,unit,ws,unix}.log`,
`/tmp/9g3-{characterization,focused,typecheck,build,unit,ws,unix}.log`,
`/tmp/9g3-empty-{before,focused}.log`, `/tmp/9g4-focused.log`,
`/tmp/9g-final-{typecheck,build,unit,ws,unix,cjs}.log`.

## Remaining risks and future decisions

- Accepted: external writers can still race Undo's final validation and mutation.
  No complete data-loss prevention, transaction, I/O compensation or crash safety.
- Missing per-turn deletion/command preimages are explicitly refused. Parser
  whitespace normalization can conservatively reject otherwise valid additions.
- Established unanswered RPCs retain promises/maps until response or disconnect;
  Resume eviction does not cancel them. Deadlines/cancellation and unknown turn
  outcomes need a product contract; no arbitrary timeout or replay was introduced.
- Aggregate retained history/stream bytes and connected pending requests have no
  global budget. No measured latency/heap bottleneck justified further changes.
- Untested: live authenticated Codex turns, real approvals/reconnect/process
  survival, actual editor timing, disk failures/crashes, browser light/dark UI and
  representative large-workload profiling. Fixtures are not a real Codex server.

No remaining confirmed critical fallback data-loss defect or reproduced newer
active-turn/history-response corruption remains in the exercised scenarios;
this does not establish absence of other defects. APIs, Redo behavior, persistence,
Telegram and authentication remain unchanged.

Next recommended work: define RPC and aggregate resource budgets, measure real
workloads, and verify live-server behavior under the existing external-server
manual procedure. No additional major refactoring phase is started or required
for the completed scoped fixes. Final Git status is checked after documentation
commit; all changes are committed, with no pushes.
