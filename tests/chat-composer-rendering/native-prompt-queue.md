# Native deferred prompt queue

Prerequisites: supported independently managed App Server with native queue
service; use synthetic fixtures for development. No browser-owned execution
queue, paid turn or real conversation mutation is required by automation.

1. Open an existing conversation. Immediate mode remains the default, including
   immediate steering while a turn is active.
2. Switch to Queue mode. The native queue panel opens and reads availability.
   Unsupported/error responses disable queue submission without falling back to
   a chat send. The draft stays editable.
3. Submit a synthetic prompt. Check the native client message/queue IDs and
   acceptance. Native settings apply when the queued prompt executes. Verify
   attachments, Skills and Apps retain their normal structured input forms.
4. Refresh the browser, enable Queue mode and read the persisted native entry.
   The browser has not persisted an executable queue of its own.
5. Delay submission and click twice: one write. Reject or lose the write response:
   outcome is unknown, the draft remains and another queue submission is blocked.
   Inspect queue **and history** (an absent entry may already have run), then
   explicitly acknowledge uncertainty. No write is automatically retried.
   Model a remotely committed enqueue with a lost reply, then reload and reconnect:
   the profile-scoped identity marker must still block a second add. It stores
   only thread/client IDs, before submission; unavailable storage prevents the
   write. Native client IDs are correlation identifiers, not deduplication keys.
   Acknowledging uncertainty permits a deliberate new submission, which can
   duplicate earlier execution. Queue/history inspection is not a non-execution
   proof, and native start/removal is not a documented atomic exactly-once commit.
6. Deliver native queue-changed, reconnect and other-thread events. Stale reads
   must not populate the replacement thread/connection; native changes require
   explicit refresh. Queue notifications must not reload full thread history.
7. Verify both themes at 1280×900, 375×812 and 768×1024, including first use after
   a page refresh. Cleanup: remove only designated fixture pending entries using
   their native lifecycle; normal live resources must not be used as test data.

Automation: `pnpm exec vitest run src/composables/nativeQueue.test.ts src/components/content/ThreadComposer.submission.test.ts src/homeComposer.test.ts src/utils/composerDraftStorage.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-queue.cjs`.
Screenshots: `output/playwright/risk-07-{1280,375,768}-{light,dark}.png`.
Performance audit is recorded in `docs/risk-first-features.md`; native long-running
queue execution has not been measured live.

Management gate: edit the first plain-text input and confirm image/Skill/App
references remain exact. Rich-span/unknown input editing must be disabled. Move
the second pending entry up only after the full list is loaded. Confirm removing
one exact entry; false deletion means already absent, not cancellation of running
work. Confirm starting an entry only while idle and inspect its returned native
turn identity and normal lifecycle. Native rejection disables stale actions;
transport loss remains unknown with no replay. Test selection/disconnect while
mutations are pending. Native concurrent edits have no CAS revision contract;
do not promise conflict-free multi-client editing.

Automation: `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-queue-management.cjs`.
Screenshots: `output/playwright/risk-07-management-{1280,375,768}-{light,dark}.png`.
The integration fixture checks all five queue writes preserve native RPC codes
while unrelated generic errors retain their established body shape.

HTTP browser compatibility: disable `crypto.randomUUID` while retaining native
`getRandomValues`, then submit and reconcile a queued prompt. A UUID v4 correlation
ID is still generated. If both APIs are unavailable, fail before a queue write.
`src/utils/clientMessageId.test.ts` and the queue browser suite cover this path.

Recovery-marker performance audit: one bounded profile-storage read when the
queue owner is created, one pre-submission recovery read, and a bounded
read/write before submission and after acknowledgment. At most 20 thread/client
identity pairs (90,000-character parse bound), no input bytes and no timers,
subscriptions or new RPCs. Markers are removed only after a checked acknowledgment,
native rejection or explicit inspection acknowledgment. Native exactly-once
execution and recovery after browser-data removal are not established.
