# Risk-first feature implementation

This assessment starts from clean `main` at `42a9790`. It supersedes neither
the protected requirements nor the acceptance limitations in
[the previous feature report](approved-features.md). In particular, live acceptance
of 09 and 11 remains incomplete and is not resumed here.

## Evidence and baseline

The supported runtime floor remains Codex App Server 0.169.0. The development
dependency (0.167.2) and generated types alone are not runtime evidence. Contracts
below are checked against the official `rust-v0.169.0` release, commit
[`d32063f96c2dff1dc96af839b3952abb6acfeda4`](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4/codex-rs).
Request processors and upstream tests, rather than method names alone, establish
semantics. An unsupported operation remains an explicit error; no write is used
to probe availability. All development writes use fixtures or disposable data.

Baseline, same installed dependencies: `pnpm run test:unit` passed 1,394 tests
(two skipped); `pnpm run build` passed. The built baseline is copied outside the
repository at `/tmp/risk-first-baseline`. Startup and 2,000-turn export fixtures
are recorded in `output/playwright/risk-first-baseline/performance-comparison.json`.
These timings describe fixtures, not live App Server performance.

## Implementation matrix

Tuples are **P/I/R/T**, each 1–5; score = P + 2I + R + T. Full-feature estimates
include withheld portions. Limited-scope estimates precede safeguards; residual
estimates are recorded with delivered results. These are engineering judgments.

| ID | Previous score | Full feature reassessment | First useful scope and initial risk | State affected / verification boundary |
|---|---:|---|---|---|
| 05 | 21 | 3/3/2/3 = 14 | Native direct children, metadata and navigation; 2/2/1/2 = 9 | Transient selected-thread reads; no orchestration, recursion or history subscriptions. Native parent filter and pagination fixtures. |
| 21 | 22 | 4/5/4/5 = 23 | Native Hook definitions, origin, trust and enabled status; 2/2/1/2 = 9 | Remote scoped inspection only initially; trust mutation needs an independently verified contract. |
| 23 | 24 | 4/5/5/5 = 24 | Project effective configuration, layers and restrictions, secret-free projection; 2/2/1/2 = 9 | No raw configuration rendering. Targeted writes require versions and preservation tests; no excluded feature workarounds. |
| 30 | 24 | 4/5/5/5 = 24 | Establish an official remotely usable Cloud contract before UI | Cloud CLI existence does not establish an App Server Cloud API; no private endpoint/credential proxy. |
| 28 | 24 | 4/5/5/5 = 24 | Native external-agent migration discovery and manifest preview; 2/2/1/3 = 10 | Explicit remote cwd/source, no imported execution; destinations/conflicts unknown unless supplied. Imports need conflict-safety evidence. |
| 34 | 21 | 4/4/4/5 = 21 | Establish native editor/buffer identity before context UI | On-disk file reads cannot substitute for unsaved editor buffers; no new local bridge/listener. |
| 03 | 23 | 5/5/4/4 = 23 | Observe actual resumed/native-updated thread permissions; 2/2/1/2 = 9 | Existing event ownership only. No extra resume to inspect; configuration defaults are not effective thread state. |
| 04 | 21 | 4/5/3/4 = 21 | Observe native denied-review identities and retry eligibility; 2/2/1/3 = 10 | Bounded transient events; display text cannot reconstruct a native retry event. |
| 29 | 24 | 4/5/5/5 = 24 | Actual account state and supported methods; 2/2/1/2 = 9 | Server owns tokens. Login requires completion/cancellation semantics and account-cache isolation. |
| 27 | 18 | 4/4/3/3 = 18 | Verify transcription-only/native realtime isolation first | No third-party transcription; microphone lifecycle, synthetic media and no billable live session. |
| 07 | 20 | 4/4/4/4 = 20 | Explicit native queue add/list, preserving structured inputs; 3/3/2/3 = 14 | Native persistence only; immediate steering remains default, no uncertain write replay. |
| 13 | 22 | 4/5/4/4 = 22 | One explicit remote worktree creation; 3/4/3/4 = 18 | Existing remote fixed-argv Git, no force/reset/cleanup; disposable repository and reconciliation fixtures. |
| 14 | 23 | 5/5/4/4 = 23 | Verify thread settings persistence and historical cwd identity | Native future-cwd update alone does not preserve historical relative file references or project membership. |
| 26 | 24 | 5/5/5/4 = 24 | Deliberate bounded native user-shell request after lifecycle verification | Native shell can be unsandboxed; never execute on WebUI host, never imply thread sandbox guarantees. |
| 10 | 21 | 5/5/5/5 = 25 | Exact native deletion impact and confirmation, last | Native subtree deletion, imported history, active work and event-confirmed completion must be accounted for. |
| 33 | Unassessed | 3/4/3/4 = 18 | Native Daybreak preference/status inspection; 2/2/1/2 = 9 | Release includes daybreakEnabled and access-program tests. Preference is not account entitlement or a security scan service. |

## Gates

Phase 1 follows 05 → 21 → 23 → 30 → 28 → 34 → 03 → 04 → 29.
Each delivered scope gets focused tests, a manual test entry, a performance audit,
and a separate commit. All observation panels remain lazy, bounded and scoped to
the current connection generation. Unsupported/error/empty states stay distinct.

Phase 2 follows 27 → 07 → 13 after the observation gate. Phase 3 follows
04 → 14 → 21 → 03 → 23 → 28 → 34 → 29 → 30 → 26 → 10. Each mutation requires
verified native semantics, duplicate and stale-response guards, rejection/unknown
outcomes, and independent failure-injection verification. Missing contracts block
that individual portion and do not block independent work.

No change is authorized to withheld extensions of 15/16/17/19/20/22/31. No
real-world resource mutation, paid operation, account change or installation is
performed for acceptance. Final statuses and actual verification follow below.

### 05 — IMPLEMENTED (observation only, as approved)

Direct native children (active/archived), bounded pagination, native parent links,
status/role, on-demand preview and normal navigation are delivered. Native
`thread/list.parentThreadId` filtering is exercised upstream in
`app-server/tests/suite/v2/thread_list.rs::thread_list_relation_filters_read_spawn_graph_from_state_db`;
`thread/read` supplies metadata without turns. The UI rejects ignored filters.
No new orchestration or subscriptions. Residual 1/2/1/2 = **8**.

Three focused unit tests, frontend/server type checks and the six-view browser
matrix passed (lazy reads, details, navigation, empty/unsupported, duplicate and
delayed navigation). Performance and exact manual steps are in
[the observation tests](../tests/thread-loading-state/risk-first-observation.md).
Live acceptance: **NOT RUN**, no designated native subagent test threads.
