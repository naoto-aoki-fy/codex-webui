# Account usage history (24)

Setup: credential-free `account/usage/read` fixture with nullable summary fields
and `dailyUsageBuckets` (`startDate`, `tokens`). No account mutation is permitted.

1. Open Settings → Account → Account usage history. No RPC occurs until **Refresh
   account usage**. Refresh once: exactly one account-wide read with null params.
2. Verify lifetime/peak token counts, longest turn seconds and streak days use their
   actual units. Daily dates stay as returned; timezone is explicitly unknown.
3. Return `{summary:{},dailyUsageBuckets:null}`: unavailable metrics/history, never
   fabricated zero. Return an empty bucket list: “No daily usage records returned.”
4. Return RPC -32601: unsupported. Return permission/transport errors: failure text.
   Null result: account usage unavailable. Refresh remains available.
5. Double-click, wait idle, close/reopen: no duplicate in-flight calls or polling.
6. Disconnect/reconnect during a read: stale results are discarded. No thread token
   sums, cost estimates, billing/credit-consumption or mutation calls occur.
7. Inspect actual metrics in light/dark at desktop, 375×812 and 768×1024.

Cleanup: reset the fixture. No local account history is written.
Performance: one RPC per explicit refresh; first 30 daily rows rendered, more only
on click. Summary uses five fields. No background requests or listeners. Remote
payload size is server-owned; live usage availability/latency needs validation.
