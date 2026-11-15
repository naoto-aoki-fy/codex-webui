# Memory readiness and selected summary (20, partial)

Open **Conversation tools** in the selected conversation before expanding the feature panel.

Setup: supported loaded thread or `node scripts/test-approved-memory.cjs`.
Expand Memory status, click Read memory status. Expect actual V2 readiness/count
(including zero), and the thread-selected memory summary as collapsed safe text.
Null summary is ambiguous unavailable (disabled/missing/unreadable/blank), not proof
memory is disabled. Contribution mode remains Unknown: no effective-mode getter
exists in supported thread settings. There are no setter/reset/global config calls.
Change thread/connection during delayed reads: discard old results. Exercise errors
and null state. Check both themes/three viewports. Cleanup: close fixture; no writes.

Performance: zero startup calls, no subscription/polling/storage. Exactly two
independent reads on explicit refresh; summary display capped at 8,000 characters.
Server response size is not client-controlled. Live latency/status NOT RUN.
