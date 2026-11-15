# Manual native compaction (02)

Open **Conversation tools** in the selected conversation before expanding the feature panel.

Setup: disposable idle loaded thread on supported server, or intercepted browser
fixture `node scripts/test-approved-compaction.cjs`.
Expand Conversation actions, click Compact conversation. Expect one request,
pending status after empty acknowledgment, disabled duplicate/send action. Emit
matching contextCompaction started/completed items: only then expect completion
and normal native history refresh; usage remains based on server notifications.
Active turn/import-incomplete/disconnected states must prevent submission.
Exercise unsupported (-32601), rejected and disconnected responses: no replay,
no early success or client-history truncation. Changing connection invalidates
pending acknowledgments and reports unknown outcome. No automatic compaction.
Cleanup: fixture closes without remote changes; native compaction cannot be
undone by the UI, so use only designated disposable data for live validation.

Performance: no new RPCs before explicit action or new subscription. Exactly one
mutation and one normal history refresh on matching completion; no polling or
per-token work. Existing usage events/pager preserve metadata/imported history.
Live token reduction, latency and persistence NOT RUN; no reduction is promised.
