# Thread search freshness

Setup: connect to an external app-server with several active threads, including
one with a unique title and one with unique message text.

1. Search for the unique title twice; expect the same IDs and index count.
2. Create, rename, archive, then unarchive a thread, searching after each action.
   Expect the new title/ID, removal while archived, and restoration when unarchived.
3. Send a message containing a new unique phrase; search after completion.
   Expect that thread to match the phrase.
4. Repeat changes through another client. With notifications delivered to this
   connection, expect the next search to rebuild. Without notifications, search
   again after five minutes; expect fresh results.
5. Clear the search, remove test threads, and restore any renamed titles.

Implementation and limits: each middleware owns its lazy index and build promise;
shared runtime ownership and browser subscriptions are unchanged. Successful
thread start/fork/name/archive/unarchive/rollback/compact and turn start/steer RPCs
invalidate it, as do thread lifecycle/name/update, turn start/completion, item
start/completion, searchable text/output deltas and disconnect notifications.
Explicit reconnect also invalidates it. Local title-cache writes are not indexing
inputs: search continues using upstream list names/previews and history text.
Client subscriptions handle rename and completed-turn UI updates, but search
invalidation has its own subscription and does not require a browser subscriber.

A five-minute TTL checked only on search bounds otherwise unobservable changes
(other connections, unsubscribed threads, or disk edits). No timer or polling is
added. This trades up to five minutes of staleness for avoiding frequent history
scans. Read failures still fall back to title/preview until invalidation or expiry;
list failures remain errors and are retryable. Existing awaiting requests may
finish using their pre-invalidation snapshot, but that snapshot cannot replace
or clear the newer cached/in-flight build. Disposal of in-flight builds remains
outside this change (9-C-19).

Performance audit: deterministic RPC assertions show two concurrent initial
searches plus a repeated search use one list and one history read for one thread.
Repeated invalidations before a search coalesce into one rebuild, adding one list
and one history read for the one-thread fixture. A two-page/six-thread fixture
uses two list and six history RPCs with a maximum of four simultaneous history
reads. Pagination, ordering, payloads, the first-100 history cap, and phrase
matching are unchanged. Invalidation itself performs no RPC; stale and newer
builds may overlap, each retaining the four-read batch limit. Continuous changes
can cause rebuilds on subsequent searches, but no automatic retry loop or
background fanout exists. Live latency and browser profiling were not measured.
