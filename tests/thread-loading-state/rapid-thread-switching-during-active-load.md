### Feature: Rapid thread switching during active load

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Ensure there are at least 3 existing threads with enough history so opening each thread triggers a visible loading state.

#### Steps
1. Open thread A from the sidebar.
2. While thread A is still loading, quickly click thread B and then thread C.
3. Repeat fast switching across multiple threads (for example A -> B -> C -> A) before each load settles.
4. Observe selected row highlight, URL route (`/thread/:threadId`), and conversation content after loading settles.

#### Expected Results
- The final clicked thread is always the selected thread.
- Sidebar highlight, route thread id, and rendered conversation stay in sync.
- No stale intermediate selection remains after rapid clicks.

#### Rollback/Cleanup
- No cleanup required.

### Obsolete turn completion ownership

Setup: use a fixture notification stream with Turn A followed by active Turn B
on the same thread. Give B live command/agent output and a pending approval.

1. Deliver A completion after B starts, then deliver the same completion again.
2. Verify B remains active with its live output, activity, approval and interrupt
   target intact; A's error or duration must not replace B's state.
3. Navigate away and repeat, then return to the thread; B must remain active.
4. Deliver B completion. Its normal completion cleanup and history sync must run.
5. Stop/restart polling and deliver a completion through the old subscription;
   it must not affect the new lifecycle.

Automated check: `pnpm exec vitest run src/composables/useDesktopState.messages.test.ts`.
Cleanup: dispose the fixture state; do not send synthetic events to real threads.
