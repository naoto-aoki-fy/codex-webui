# Native background processes (08)

Setup: supported loaded disposable thread or `node scripts/test-approved-processes.cjs`.
Expand Background processes and Refresh. Expect native process/item identity,
command/cwd, snapshot time, and bounded recent command output only if the matching
item exists in loaded history. Missing output is explicitly unavailable. Page
through results; empty list is distinct from errors. Select Terminate process,
then confirm its exact ID. True acknowledgment removes that row; false means
already exited/no longer manageable. Rejections/unknown outcomes require refresh
before retrying. Model turn interruption must not be invoked. Change thread or
connection during delayed list/terminate replies: stale results must be discarded.
Check all three viewports and both themes. Cleanup: fixture-only processes have
no host counterpart. Never terminate real user processes for testing.

Performance: no startup calls/listeners or polling. One 50-row page per explicit
read, max 200 retained rows, 6,000 output characters per expanded row. One exact
termination per confirmation; no automatic retry or bulk operation. Native list
has no output field: no extra output read is fabricated. Live latency NOT RUN.
