# Permanent deletion inspection (10, partial; mutation blocked)

Prerequisites: use the credential-free intercepted App Server fixture. No live
resource or deletion attempt is needed.

1. Open Conversation tools → Permanent native conversation deletion.
2. Expect an explicit unavailable notice explaining that native deletion cannot
   atomically exclude descendants. No typed-ID, confirmation or submit control
   is offered.
3. Inspect an idle native fixture with empty child inventories. Native identity,
   cwd, Fork origin and inspection time remain visible. Only metadata/list reads
   occur. Imported, active and ambiguous/child inventories still reject preview.
4. Invoke the feature controller's `run` directly, before/after inspection and
   after reconnect: it must send no deletion request, regardless of typed ID or
   confirmation. No override or writable capability flag exists.
5. Verify light/dark at desktop, 375×812 and 768×1024; reconnect and confirm no
   deletion request. Archive/restore remain their existing separate workflows.

Automation: `pnpm exec vitest run src/composables/threadDeletion.test.ts` and
`APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-deletion.cjs`.
Screenshots: `output/playwright/risk-10-{1280,375,768}-{light,dark}.png`.
Cleanup: close fixture browser contexts; no real resources were changed.

The verified 0.169.0 native request accepts only threadId and deletes a subtree.
A new operation with an authoritative atomic leaf-only condition would require
separate implementation/evidence. Do not use a warning, repeated child list or
confirmation as authorization to restore the old mutation path.
