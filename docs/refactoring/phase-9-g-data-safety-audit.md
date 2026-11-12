> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

> Historical audit: application-managed file Undo/Redo, filesystem restoration during conversation revert, project creation, GitHub cloning, automatic chat directories, camera/folder attachments, and project aliases/manual ordering have since been removed. Native thread operations, existing workspaces, file/image attachments, and diff inspection remain. Earlier implementation details below describe the pre-removal code. Current verification: [workspace workflows](../../tests/projects-sidebar-new-chat/native-workspace-workflows.md).

# Phase 9-G: Undo data-safety gate

## Scope and invariant

Inspected `AGENTS.md`, clean `main` at `ce207fc`, and origin URL matching
`vast-cow/friuns2-codexapp`. No production changes, branch changes, or pushes.
All destructive reproductions run under `mkdtemp` fixture directories.

Required preservation invariant: Undo must preserve unrelated working-tree and
index edits, including edits on paths mentioned by an earlier turn. A failed
reversal must not be reported as a complete patch reversal.

## Confirmed findings

The existing retirement test reproduced tracked-file overwrite. Four new
parameterized cases exercise the real bridge with unstaged, staged, mixed, and
untracked target content. These are characterization assertions of defects,
not desired-behavior assertions. All 17 tests in the file pass.

- An update whose reverse diff fails (or produces unchanged content without a
  move) falls back to `git checkout HEAD -- path` if `ls-files` marks it tracked.
  The same fallback can follow a read/write exception. Both the index entry and
  working file become HEAD content. HEAD itself stays unchanged. Staged-only,
  unstaged-only and mixed edits are lost without an error.
- The delete and command-modified paths also restore HEAD by inspection. HEAD
  is not a per-turn snapshot; even successful checkout cannot establish that
  the result is the state before the turn.
- Unrelated tracked paths retain both staged and unstaged edits in these tests;
  unrelated untracked files survive. This is path-scoped overwrite, not a
  repository-wide reset.
- An unmatched update to an untracked file reports an error and preserves it.
  An add reversal, however, deletes the current file without checking whether
  the user subsequently edited it. The new tests demonstrate this loss.
- A multi-file patch can delete the edited added file, then fail reversing an
  untracked update. It still returns the patch ID as reverted. No compensation
  restores the deleted content. Existing coverage also demonstrates partial
  redo failure. The production `patchHadError` does not gate reverted IDs.
- Command paths are collected from every selected turn independently of the
  `allowedPatchIds` filter. By code inspection, patch selection therefore does
  not constrain command-path fallback. This broader scope is not yet reproduced.

## Concurrency and recovery limits

No lock or expected-content comparison protects the read-to-write, checkout,
or removal intervals. Later user edits already reproduce loss deterministically;
actual simultaneous editor writes, permission failures, checkout failures,
rename collisions, and process interruption were not injected. A filesystem
snapshot alone cannot make read/check/write atomic against external editors.
No production backup or transaction compensates completed operations. Git may
retain staged blob objects, but that is not reliable user-facing recovery;
unstaged content need not exist in Git at all.

## Minimal correction proposal requiring authorization

Prefer preservation-first refusal: remove implicit HEAD restoration for failed
update reversal, deleted files without a known preimage, and command-only paths
without a known preimage. Return a conflict while retaining current bytes and
index. Check added-file content against its expected postimage before removal;
check rename destinations before mutation. Gate successful patch IDs on complete
success and report partial operations accurately. Preserve the index for every
filesystem-only reversal. No public response shape needs to change.

Before implementation, authorize these behavior decisions:

1. May Undo refuse an unsafe reversal instead of restoring HEAD? Recommended yes.
2. For multi-file/turn operations, may safe paths complete with explicit partial
   failure, or must the entire operation be all-or-nothing? Recommended preflight
   refusal on known conflicts, with truthful partial failure on later I/O errors;
   do not claim atomicity against external editors.
3. Should patch selection exclude command-only paths? Recommended yes unless
   whole-turn restoration is explicitly selected.

A backup/force-restore option would be a separate feature and is not proposed in
this pass. Exact concurrent-write guarantees need a separately agreed ownership
or transactional design. Do not substitute automatic retries or broader Git reset.

## Disposition and compatibility

Stop at this critical data-safety gate under the mission's stop rule. Priorities
2–4 have not been executed in Phase 9-G; their Phase 9-F findings remain open,
not newly verified. In particular obsolete completion remains a confirmed defect,
history ordering/pruning remains suspected, and RPC deadline/cancellation policy
remains undecided. Correctness cleanup cannot be closed.

Only tests and this report changed. No Telegram, authentication, Undo/Redo, Git,
RPC contract, persistence, recovery, dependency, or production API changes.
Performance: no production behavior changed; fixture execution took 1.30 seconds
for 17 tests. No browser, latency, heap, or live authenticated-server measurements.
No performance improvement is claimed.

## Verification

Ran sequentially, all passed:

1. `pnpm run typecheck`
2. `pnpm run build`
3. `pnpm run test:unit` — 77 files, 1,201 tests, 10.99 seconds.
4. `pnpm run test:integration:fixture` — built CLI and dev entry checks.
5. `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` — same
   checks after the WebSocket run completed.

Focused check: `pnpm exec vitest run src/server/threadFileChangeRetirement.test.ts`
— 17 passing tests. `git diff --check` passed. Transient logs are under
`/tmp/9g-{undo,typecheck,build,unit,fixture-ws,fixture-unix}.log`.
No intermittent failure was observed. Fixtures do not verify live authenticated
turns or real editor concurrency. Production changes remain explicitly blocked;
passing characterization tests do not resolve the defects they demonstrate.

## Follow-up: deterministic concurrent editor reproduction

The subsequent G-1 investigation injects an editor write between the successful
reverse-diff source read and destination write. It confirms loss of that edit
without involving HEAD fallback. The earlier concurrency statements above are
historical; this interleaving is now reproduced. See
[Phase 9-G progress](phase-9-g-progress.md) for the safety blocker, remaining
contract decision and verification. No production correction has been made.

## Current disposition after explicit authorization

The user subsequently accepted optimistic validation with the residual external
writer race. Preservation-first Undo, turn completion and history fixes are now
implemented and verified. The earlier gate statements describe the historical
investigation, not the current authorization. See [progress](phase-9-g-progress.md)
and the [final integration audit](phase-9-g-final-audit.md) for commits, checks,
remaining limitations and RPC/resource policy decisions.
