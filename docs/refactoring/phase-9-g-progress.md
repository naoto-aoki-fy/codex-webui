# Phase 9-G progress

## Status and prioritized plan

Incomplete; stopped at a confirmed critical Undo safety blocker. Baseline is
clean `main` at `51e05a2`, origin `vast-cow/friuns2-codexapp`. Read repository
`AGENTS.md`, the Phase 9-F audit, Phase 9-G data-safety audit and existing Undo
characterizations. No branch changes, pushes, dependencies or production edits.

Priorities remain:

1. G-1: preservation-first Undo, including concurrency and truthful partial results.
2. G-2: obsolete completion ownership across active turn, approvals and live state.
3. G-3: history refresh/pagination ordering and pruning with deferred reads.
4. G-4: RPC ownership, settlement and retention; leave policy-dependent deadlines open.
5. G-5: measured retention/performance issues, then final integration verification.

## Completed characterization: G-1 concurrent external edits

Added a deterministic bridge-level test in
`src/server/threadFileChangeRetirement.test.ts`. The fixture contains a valid
`before` to `after` patch. A mocked filesystem read first obtains `after`, then
writes `external editor content` to the disposable source file before returning
the read result to Undo. Undo successfully reverses its stale read, writes
`before`, reports no errors and publishes the patch ID as reverted. The editor's
bytes are lost. No sleeps, real-editor timing or destructive development-repo
Git operations are used. The injection is reset before each test and consumed
once; all other filesystem operations use their original implementations.

This is a characterization of an unresolved defect, not a preservation test or
a production fix. It confirms that removing HEAD fallback alone is insufficient:
the ordinary successful reverse-diff path also loses data under concurrency.

## Safety blocker and required decision

The mission requires both successful independent reversals and preservation of
concurrent external edits. Existing asynchronous read/write/remove/rename paths
provide no atomic conditional mutation against external writers. Re-reading
before mutation only narrows the race; a bridge mutex excludes other bridge
operations but does not exclude editors. Atomic rename publishes a whole file
but still replaces edits made after its expected-content check. Backups can aid
recovery but do not by themselves prevent overwrite or establish transactional
ownership. No exact preimage exists for deleted or command-modified paths.

Per the mission instruction, “If behavior cannot be made safe without a
significant policy decision, document the exact limitation and stop that
implementation rather than risking data loss.” No partial production fix is
presented as satisfying the preservation guarantee. The final stop rule for a
critical defect applies; G-2 through G-5 remain pending rather than verified.

Required decision: either explicitly accept optimistic conflict detection with
a documented concurrent-writer race, or authorize a separate file-ownership /
transactional recovery design and its operational constraints. Refusing every
mutation would avoid this write race but violate the required successful Undo
behavior. Advisory locking alone cannot guarantee cooperation by editors.

## Remaining findings and compatibility

All previously confirmed Undo defects remain: tracked HEAD fallback overwrites
index/worktree edits, edited additions are removed, partial failure IDs are
misreported. Successful reversal now also has a deterministic concurrent-write
loss reproduction. Obsolete-turn completion is still confirmed and unfixed;
history ordering/pruning and resource-retention concerns remain unaudited here.
No claim of full codebase correctness or data-safety guarantees is made.

Public APIs, wire contracts, Redo, persistence formats, Telegram and
authentication are untouched. No live authenticated server or browser was tested.
Performance: focused fixture run was 1.30 s for 18 tests. No production behavior
changed, so no performance improvement is claimed; no heap/latency measurements.

## Verification and commits

- `d6d215e` — `test: reproduce concurrent editor data loss during Undo`.
- This progress report and the historical audit follow-up are a separate
  documentation commit; use Git history for its hash.

Ran in sequence, all passed:

1. `pnpm run typecheck`.
2. `pnpm run build`.
3. `pnpm run test:unit` — 77 files, 1,202 tests, 10.85 s.
4. `pnpm run test:integration:fixture` — built CLI and dev HTTP/WS fixture checks.
5. `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` — built
   CLI and dev checks, after WebSocket completion.

Focused check: `pnpm exec vitest run src/server/threadFileChangeRetirement.test.ts`
— 18 tests passed. `git diff --check` passed. Logs are
`/tmp/9g-concurrent.log`, `/tmp/9g-concurrent-typecheck.log`,
`/tmp/9g-concurrent-build.log`, `/tmp/9g-concurrent-unit.log`,
`/tmp/9g-concurrent-fixture-ws.log`, and
`/tmp/9g-concurrent-fixture-unix.log` (transient local evidence).
These passing characterization tests assert defective current behavior;
they do not establish preservation or real-server correctness.

Next recommended task: resolve the concurrent-writer contract, then implement
G-1 with desired-behavior regression assertions, removal of HEAD restoration,
postimage validation, rename collision protection, scoped command handling and
truthful partial result accounting. Continue G-2 through G-5 after that gate.
