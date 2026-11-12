# Native read receipts

## Prerequisites
Use an independently managed Codex 0.167.2 app-server with experimental APIs.
Connect two browser clients to the same server. Use disposable threads; retain
existing browser storage, sessions and databases.

## Actions and expected results
1. In light theme, complete a turn in an inactive durable thread. Its native
   unread marker appears. Repeat in dark theme.
2. Open the thread. Check that `thread/readState/update` sends
   `operation: {type: "read"}` and the observed `expectedRevision`.
3. Confirm the second client receives `thread/readState/changed` and clears
   its marker. Refresh both clients and confirm the server receipt persists.
4. Race a completion with history loading or mark-read. The new unread receipt
   must survive. A conflict displays an error and does not automatically retry.
5. Connect a server omitting receipts, or inspect an ineligible thread. No
   unread marker is invented. Legacy timestamp keys have no effect.
6. Disconnect during mark-read. Confirm no timestamp fallback or optimistic
   clearing; reconnect and inspect the server state before selecting again.

## Cleanup
Close the second client. Do not clear localStorage or delete server data.
Fixture/unit tests do not establish real multi-client server behavior.
