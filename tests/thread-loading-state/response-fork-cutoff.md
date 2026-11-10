# Response fork cutoff

Prerequisites: connect to an independently managed Codex app-server. Create a
conversation with at least 15 completed turns, using distinct markers in every
user message and assistant response. Load earlier messages.

1. Fork the first, a middle, and the last assistant response in separate runs.
2. Expect all history through the selected response, inclusively. Later user,
   assistant, tool and reasoning messages must be absent. Load earlier messages
   in each fork and verify all retained history is accessible.
3. Reload each fork, then continue it. Expect excluded messages to stay absent;
   inspect the server history to confirm only retained turns and the new turn
   form its conversation context. The original conversation remains unchanged.
4. Repeat with a second client adding later turns while the first client's
   displayed history is stale. Fork an earlier response from the first client;
   expect none of those additional turns in the fork.
5. Repeat in light and dark themes. Existing Fork controls and history remain
   readable. A failed rollback must show an error without navigating to an
   incomplete fork.

Cleanup: archive test forks and the source conversation. No workspace file
rollback is performed by Fork.

Automated coverage: `src/server/forkThreadCutoff.test.ts` checks authoritative
history counts, inclusive cutoffs, read/resume and continuation against a
stateful fixture, invalid input, and incomplete-fork cleanup. Fixture checks do
not establish live Codex context behavior.

Performance audit: the successful cutoff path uses one fork plus at most one
rollback, calculated from the full server snapshot before response pagination.
Only the final snapshot reaches the browser and its pagination cache. Existing
metadata enrichment remains in place. No extra polling, connections or fanout
are introduced. Live render timing and Codex latency were not measured.
