# Native Project and pin upgrade boundary

Setup: disposable profile/home and a server satisfying
[the capability contract](../../docs/native-project-migration.md). Never test
migration or deletion against real user data.

1. Seed legacy roots/pins in the disposable profile. Follow the pre-upgrade guide
   using the old release. Confirm completion receipt and native pins after reload.
2. Upgrade. Create empty projects and two projects sharing names/roots; explicitly
   assign different conversations. Rename/reorder, reload and reconnect. Expect
   identities, order, empty projects, membership and native pins to persist.
3. Change cwd without changing projectId. Expect membership unchanged. Delete a
   project; its conversations must remain visible as unassigned.
4. In a separate disposable home, leave an interrupted migration. Expect an
   actionable pre-upgrade error and byte-for-byte unchanged legacy state.
5. Deny project/history calls or disconnect. Expect the original errors; return
   method-not-found for required APIs and expect an upgrade error. Test initial
   and older native pages and fork at an older absolute index: expect no duplicate
   turns and the original cutoff. Never fetch full history as a fallback.

Cleanup: remove only disposable profiles/homes and restore test connectivity.
Existing native data and legacy files must not be automatically removed.

## Independent acceptance matrix

Run `pnpm exec vitest run src/server/nativeUpgradeAcceptance.test.ts
src/server/projectHistory.test.ts src/server/threadPresentationStore.test.ts
src/components/sidebar/SidebarThreadTree.test.ts src/api/codexGateway.test.ts`.
The six disposable fixtures cover no legacy data, unmigrated Projects,
interrupted migration, completed migration, completed Projects with remaining
pins, and pins without Projects. Expect byte-identical state files in every case.
Project receipts must never suppress pin warnings. Native thread list/direct read
remain usable after both guards fail; pin UI changes are blocked until recovery.
Use the exact source/environment/completion checks in the migration guide for a
live acceptance run. Restore connectivity and remove only disposable fixture homes.
