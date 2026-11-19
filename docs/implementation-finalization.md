# Implementation pass closure

Feature 10 is **PARTIAL for read-only inspection; the deletion mutation is
BLOCKED and unavailable**. This supersedes historical descriptions of a callable
confirmed deletion workflow. The verified 0.169.0 contract has only threadId and
selects its current subtree; no atomic leaf-only condition was established in the
[completed evidence review](high-impact-evidence-review.md). No capability probe
or invented response is used.

`src/composables/threadDeletion.ts::run` has no RPC call or mutation path. It
always reports unavailability, including direct controller invocation before or
after preview and reconnect. `PermanentDeletion.vue` offers inspection and an
unavailable notice, without typed-ID, confirmation or submit controls. Preview
remains read-only; archive/restore and generic RPC behavior are unchanged. The
controller regression `never submits native deletion without an execution-time
leaf-only guarantee, including direct controller calls` verifies zero delete
requests. Old tests for a formerly callable mutation were replaced with current
inspection/restriction coverage; native deletion-event handling for externally
observed deletions remains intact.

The [native account guide](native-codex-account.md) describes how the App Server
handles authentication and how Settings starts sign-in, cancels it and logs out.
The explicit sign-in activity check uses live conversation metadata.

Queue receipts survive ordinary reload/reconnect and no uncertain enqueue is
automatically replayed. Native client IDs are correlation identifiers, not
idempotency keys. An absent entry does not prove failure: it may already have
run. Explicit acknowledgment allows a deliberate new submission that can
duplicate previously registered or executed work. This is not guaranteed
exactly-once execution and is not a browser-owned execution queue.

## Validation

On final product source, the following passed:

- `pnpm run typecheck`: frontend and server type checks passed.
- `pnpm run test:unit`: **1,488 passed, 2 skipped; 137 files passed, 2 skipped**.
  This full suite was run once, including protected Fork/Revert, Portable history,
  metadata, archive/restore and unrelated RPC regressions. The expected disposable
  Git branch-conflict fixture prints a fatal message while its assertion passes;
  it is not a suite failure or a branch change in the working repository.
- `pnpm run build`: production frontend and public CLI passed.
- `pnpm run test:integration:fixture`: built CLI and dev entry points passed,
  including metadata failure handling, native error contracts and shared transport.
- `node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"`: passed.
- `APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-deletion.cjs`: passed. Intercepted production assets at
  `http://127.0.0.1:4173/#/thread/approved-fixture`; actual inspection, unavailable
  mutation, missing submit/confirmation fields, lazy ownership and reconnect,
  with **zero native deletion requests**. Light/dark at 1280×900, 375×812 and
  768×1024. Playwright interception supplies credential-free runtime responses.
- `git diff --check`: passed.

Screenshots (absolute directory
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`):
`risk-10-{1280,375,768}-{light,dark}.png`.

![Desktop light inspection](../output/playwright/risk-10-1280-light.png)
![Mobile dark inspection](../output/playwright/risk-10-375-dark.png)

Performance audit: removal of the mutation eliminates its three preflight reads
and native write; controller `run` now performs only a bounded status assignment.
Existing explicit inspection still makes at most three metadata/list reads. No
startup request, subscription, polling, retained history or persistence is added.
No new latency benchmark or live performance claim is made.

All new live acceptance remains **NOT RUN**. Prior 09/11 acceptance limitations
are preserved. No destructive live tests, real account/resource changes, paid
calls, pushes, merges, rebases or repository branch switches occurred. Port 4173
had no listener at the ownership check; intercepted assets needed no server.
Port 5173 was untouched. The implementation pass is closed with native contract
limitations explicitly retained and no blocked feature scope reopened.
