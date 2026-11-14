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
