# Browser reconnect recovery without reloading

## Status and change

This is an **unexecuted acceptance checklist**, not evidence of live browser or
authenticated Codex verification. Record the environment, actual results and
any blocked cases when it is run. Unit tests and the credential-free integration
fixture do not establish recovery against a real external Codex app-server.

The change reconnects browser notification delivery after network/page lifecycle
recovery and refreshes the selected thread and thread list after the replacement
stream is ready. Existing message caches must not hide updates missed while the
browser was disconnected. Browser recovery must not replay a task submission or
reset the shared backend connection to the external app-server.

## Prerequisites and setup

- Follow [External app-server connection](../website-docs-misc/external-app-server.md).
  Start an independently managed real Codex app-server and this checkout's web
  backend with matching user, `CODEX_HOME` and paths. Record the output of
  `codex --version`, the tested commit, browser/version, operating system, app URL,
  and whether the development or built production entry point is being tested.
- Use disposable threads A and B. Give each task a unique marker such as
  `reconnect-A-<timestamp>` and ask for a harmless response long enough to interrupt
  notification delivery. Keep production work out of the test threads.
- Open browser Network tools with preserved request history. Track
  `/codex-api/ws`, `/codex-api/events`, `/codex-api/rpc` request methods and
  `/codex-api/server-requests/pending`. Record the selected thread and accepted
  turn IDs before interrupting connectivity.
- Keep the backend and external app-server online while interrupting only the
  tested browser's connection. Use a browser-scoped network control or test proxy;
  verify that it actually prevents notification delivery. Some network controls
  leave existing WebSockets usable, which would invalidate the missing-event test.
- Have a separate, connected client or server-side observation available to
  confirm when the accepted task finishes. Do not refresh the tested page to make
  the test pass. Record light and dark theme results for the visible conversation,
  running/completed indicator and approval panel.

## 1. Task completes while the browser is offline

1. Open thread A and wait until its existing messages have loaded. Submit a new
   marked task and confirm that the server accepted it and the UI shows it running.
2. Disconnect only the tested browser. Confirm new WS/SSE frames stop arriving.
3. Wait until the independent observer confirms that the same turn completed.
4. Restore the tested browser's connection. Do not reload, select another thread,
   or send another message. Wait for the replacement notification stream's `ready`.
5. Inspect the refreshed conversation, running indicator and sidebar. Repeat with
   a shorter interruption so that the task is still running at reconnection.

Expected: after readiness and successful recovery reads, the missing answer and
completion state appear automatically even when no further task notification is
sent. Recovery fetches current selected-thread history despite an already-loaded
cache. If the turn is still active, subsequent deltas continue updating it without
duplicated rows or a second task. Existing earlier-history pages remain usable.

## 2. Hidden tab, suspended browser and restored page

1. Start a marked task in A, switch to another tab/application, and let it finish
   while the tested page is hidden. Return to the tested page without reloading.
2. Repeat while the browser/device is genuinely suspended or frozen long enough
   for the old connection to become unusable, then resume it. Record the suspension
   mechanism; a hidden tab alone does not establish that suspension was tested.
3. In a browser capable of back/forward cache restoration, start another task,
   navigate away, wait for completion, then use Back. Confirm that the restored
   page received `pageshow` with `persisted === true` using browser diagnostics or
   a temporary event logger. If it was a new page load, mark the BFCache case as
   not exercised and record the browser's eligibility reason.

Expected: visible/resume restoration replaces an unusable old browser connection
even if its previous `readyState` still appeared open, and refreshes missed state.
BFCache restoration has the same result without depending on a new document load.
Recovery does not submit another turn or call `/codex-api/reconnect`.

## 3. SSE fallback

1. Configure a test proxy to reject or stall only the `/codex-api/ws` upgrade while
   allowing ordinary HTTP and `/codex-api/events` requests. Load the test page and
   verify that notification delivery actually falls back to SSE.
2. Repeat case 1 with SSE: disconnect the browser after an accepted turn, wait for
   completion elsewhere, and reconnect without reloading.
3. Repeat a hidden/suspended return with SSE. Keep the WS restriction active so a
   successful WebSocket cannot accidentally stand in for the fallback test.

Expected: a ready SSE stream triggers the same current-history recovery. Missed
completion/answer content becomes visible and new notifications continue. There
is one current notification subscription per page after recovery settles, not
both a persistent WS subscription and an SSE subscription.

## 4. Repeated recovery and stale transport callbacks

1. During an accepted task, go offline and return online while also switching
   away from and back to the tab. Repeat several times. Capture the notification
   connections and RPC methods throughout the sequence.
2. After connectivity stabilizes, inspect the active notification connection,
   selected history and number of submitted turns bearing the task marker.
3. For deterministic callback ordering, use the notification unit-test harness
   in `src/api/codexRpcClient.notifications.test.ts`: retain callbacks belonging
   to an old connection, replace/dispose that connection, then deliver its late
   `message`, `ready`, `open`, `error` and `close` callbacks. Include callbacks
   after the subscription disposer has run and the SSE fallback equivalents.
   Run `pnpm exec vitest run src/api/codexRpcClient.notifications.test.ts` and
   record its actual result separately from the live checks.

Expected: overlapping recovery signals coalesce and stable connectivity leaves
one current browser notification transport. Retired callbacks cannot publish old
messages, mark the replacement ready, schedule another reconnect or cancel the
replacement's recovery. Disposal removes lifecycle listeners/timers and prevents
later recovery signals from opening another connection. There is exactly one
accepted task submission for the marker; retries only concern delivery/read state.

## 5. Selection changes and pending approvals during recovery

1. In A, miss a task completion as in case 1. Delay the recovery history response
   using a test proxy, restore connectivity, then select B before A's read returns.
2. Release the delayed response and inspect B. Return to A and inspect its answer.
   Repeat while B itself receives live notifications.
3. In a disposable thread with an appropriate existing approval policy, trigger a
   harmless request that requires user approval. Disconnect the tested browser
   before the approval notification arrives, then reconnect. If no applicable
   approval flow is available, record this case as blocked rather than passed.
4. In a separate run, leave a visible request pending, disconnect, resolve it from
   another authorized client, then reconnect the tested browser.

Expected: A's response does not replace B's messages, loading state or live turn.
Returning to A displays its recovered result. An unresolved server request appears
in the existing approval UI; a request resolved elsewhere is removed. Recovery
does not automatically approve, deny, replay or duplicate a server request.

## 6. Startup and submission handoff boundaries

1. With a marked task already accepted, load a test page while its network is
   unavailable, then restore connectivity. Wait for successful notification
   readiness and the normal initial thread/history load.
2. Start loading the page online, interrupt connectivity before its first stream
   has become ready, and restore it. Repeat with the task completing during this
   gap. Initial caches or partial startup work must not suppress the later read.
3. Separately, interrupt connectivity while `turn/start` is still in flight, before
   the browser receives its response. Restore connectivity and inspect the known
   thread from the recovered UI or independent observer before taking any new
   submission action. Record whether the server accepted the original turn.

Expected: failed initial connection attempts do not prevent eventual recovery.
A successful response lost during submission handoff is not interpreted as
permission to send the task again. The browser never automatically replays
`turn/start`; if acceptance remains unknown, report that uncertainty explicitly.
This checklist concerns browser delivery recovery, not restarting the external
app-server or proving that tasks survive an app-server shutdown.

## 7. Subscription recovery notification auto-dismissal

Prerequisites: use the setup above with a disposable thread and observe actual
subscription recovery events (or inject them through the unit-test notification
harness). Run the visible checks in both light and dark themes.

1. Deliver `recovering` for the selected thread and wait longer than three seconds.
   Expect the existing subscription status to remain visible.
2. Deliver `recovered`. Expect the status to remain for the first 2999 ms and
   disappear at 3000 ms, with no subscription retry, reconnect or history request
   caused by dismissal. Other connection warnings must remain visible.
3. Deliver `recovered`, then within three seconds deliver `recovering` or `failed`
   for the same thread. Wait past the old deadline. Expect the newer status to
   remain; for `failed`, use the existing retry button and confirm it still retries.
4. Deliver `recovered` twice one second apart. Expect dismissal three seconds
   after the second event. Switch between two threads with separate recovery
   events and confirm each deadline is independent of selection.
5. Disconnect the app-server connection and wait longer than three seconds.
   Expect the disconnected warning to remain until reconnection. Unmount/close
   the test app with a pending dismissal and confirm no timer remains active.

Deterministic coverage: run
`pnpm exec vitest run src/composables/useDesktopState.messages.test.ts`.
Cleanup: restore connectivity and theme, close the disposable test page and
remove any temporary notification injection. Do not reset the real subscription
or shared server merely to clear a UI notification.

## 8. Independent connection warnings and temporary success notices

Prerequisites: for deterministic UI checks, run this checkout on
`http://127.0.0.1:4173` and install the Playwright Chromium browser. The fixture
intercepts API requests and substitutes browser WS/SSE transports; no credentials
or live App Server are required. Run:

```sh
node scripts/test-connection-status.cjs
node scripts/test-recovery-status.cjs
```

For live acceptance, use the real-server setup above and interrupt each layer
separately. Repeat the following in light and dark themes:

1. Load a healthy thread. Expect no persistent Connected status or initial
   Reconnected confirmation. Enter an unsent draft and record existing history.
2. Disconnect only browser notification delivery. Expect **WebUI Backend:
   Disconnected** immediately on WS close/SSE error/offline. Wait over three
   seconds and start a retry; the warning must remain until the replacement
   stream sends `ready`. Transport open alone is insufficient.
3. Restore browser delivery. Expect **WebUI Backend: Reconnected** for about three
   seconds, followed by no browser status. Confirm history and draft are retained.
4. Disconnect only the backend's App Server transport. Expect **Codex App Server:
   Disconnected** to remain during all retries. Deliver thread `recovering`,
   `failed`, then `recovered`; expect separate **Thread subscription** labels and
   the existing manual retry action on failure. The thread success disappears
   after three seconds while the App Server warning remains.
5. Fail both layers together. Restore only the browser, then only the App Server.
   Expect each warning to clear only after its own recovery, with a temporary
   success for that layer. Browser reconnection must reconcile the latest App
   Server status even when its disconnect/reconnect event was missed offline.
6. With both warnings visible, switch away from the tab and then return while
   both layers are still down. Expect neither connection banner while the tab
   is hidden or during the first 499 ms after returning. At 500 ms, expect a
   warning for each layer still down. Switch away again before the delay ends
   and return. Measure the full 500 ms from the latest return. Thread
   subscription, expired approval, and unknown outcome feedback are visible
   throughout the delay when applicable.
7. Recover, disconnect again before three seconds, and wait beyond the previous
   deadline. Expect the new warning to remain. Repeat recovery cycles and duplicate
   success events; duplicates must not create additional rows. Browser and App
   Server duplicate successes do not restart dismissal or reappear after dismissal.
8. Recover one layer while the tab is hidden or within 500 ms of returning.
   Expect no success banner for that recovery. Switch away while a success is
   showing, then return and verify it does not reappear. For a staggered
   recovery, keep both layers down through 500 ms and restore them at different
   times after that point. For example, restore browser delivery at 700 ms.
   Expect its warning at 500 ms and its success at 700 ms. Expect each success
   to disappear three seconds after its own recovery. Use the fixture for exact
   499, 500, and 501 ms timing.
9. Repeat offline/online and hidden/visible transitions. Deliver an old stream's
   late `ready` after replacement. Expect one current transport per browser
   subscription and one warning per connection layer. The stale event cannot
   mark the replacement connected. In DevTools Network, verify that revealing
   warnings or dismissing successes adds no connections or API requests beyond
   the existing transport recovery and state reads. Confirm no automatic
   `turn/start`, `turn/steer`, approval response, or backend `/reconnect` call.

The deterministic script exercises both transports and themes, captures warning, success
and healthy screenshots, and records recovery request counts in
`output/playwright/connection-status-{ws,sse}-{light,dark}.json`. It uses a virtual
clock for the 499/500/501 ms and 2999/3000 ms boundaries, repeated tab switches,
staggered recovery, and prolonged failures. It counts both transport attempts
and API requests while showing warnings and dismissing successes. Unit tests
also invoke retained timeout callbacks directly to check stale-timer protection.
These fixtures do not establish real network/suspension or authenticated Codex
recovery; record live results separately using the earlier checklists.

Automated verification on 2026-11-20 passed 1560 unit tests, with 2 live tests
skipped. Type checking, the production build, and the credential-free integration
fixture passed. Both browser scripts passed at `127.0.0.1:4173`, 1440×1000, in
both themes. The connection-status script covered both WS and SSE. The public
ESM CLI smoke command `node dist-cli/index.js --help` passed.

Performance audit for the tab delay: WS and SSE reused two subscriptions
(desktop and sidebar) in each theme. Showing warnings at 500 ms and dismissing
successes made zero API requests and opened zero transports. The measured
recovery burst made one request each for `thread/list`, `project/list`,
`model-preferences/read`, `thread/resume` for the selected thread, and pending
approvals. The banner code adds one shared visibility listener and one shared
delay timer. It updates only local display state and leaves request payloads,
history reads, and cache invalidation to the existing recovery path. Live
network latency, CPU/memory, and authenticated App Server recovery were outside
the fixture checks.

Cleanup: close fixture tabs and restore network restrictions/theme after live
checks. Leave shared App Server processes and the existing development server
running. Screenshots/reports are disposable ignored artifacts under `output/`.

## Request and performance evidence to record

For one successful recovery burst, record notification connection attempts,
`thread/list`, selected-thread `thread/read`, pending-request reads, transferred
bytes and time from readiness to visible current state. Distinguish normal
existing list pagination from duplicate requests. Check that cached, unselected
thread histories are not all fetched, and that failed reconnects do not accumulate
timers, subscriptions or pending recovery work. Confirm that no turn is replayed
and no backend `/codex-api/reconnect` request is made. These measurements have not
been performed by writing this checklist; do not claim a latency or memory result
without capturing it.

## Rollback and cleanup

Restore normal connectivity, remove proxy/network restrictions and temporary
event logging, and restore the previous theme. Close only test tabs/sockets and
stop only processes started for this verification. Keep independently managed
production Codex/backend processes running. Remove disposable test threads only
when their contents are no longer needed as evidence. Do not delete sessions,
reset shared credentials or change approval policy to clean up this test.
