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

Automated coverage: `src/server/forkThreadCutoff.test.ts` checks native
`lastTurnId`, rejects ignored cutoffs, changed turn IDs and history reappearing
on read, and archives incomplete forks. `threadLiveStateRetirement.test.ts`
checks pagination/cache ordering. `src/api/codexGateway.test.ts` rejects missing
cutoff metadata. These are mocked checks, not evidence of server persistence.

Compatibility: the browser calls `thread/fork-at-response`; older backends
reject the unknown operation. Successful results require `forkCutoff` metadata.
An app-server ignoring native `lastTurnId` is rejected by comparing all retained
turn IDs in both the initial response and a fresh durable read.

Performance audit (code path): a successful response fork now uses three serial
RPCs: source read, native fork, fork read. It removes rollback and avoids copying
later turns into the fork response. Reads hydrate full histories, so source read
cost grows with history size. No polling, new connections, unbounded fanout or
new cache is introduced. Existing pagination/cache enrichment runs only after
verification. Render timings and large-history latency were not measured.

## Real-server investigation, 2026-11-10

Source baseline: `62acb2aa52bf38dd01cfb21e1b73c74c1d3269ab`.
Codex endpoint: `ws://127.0.0.1:4500`; initialize reports
`codex-web-local/0.166.0`, Linux x86_64. App version: `0.1.87`.
The existing HTTP endpoint was `http://127.0.0.1:5900`; its served asset
`index-C-ziJuL1.js` contains `forkFromTurnIndex`, and its backend rejects a
negative cutoff with `Invalid fork response cutoff`, proving interception.
Its exact process cwd/revision and any external reverse proxy could not be
established: host listener PIDs were unavailable in the execution namespace.
Thus a stale deployment elsewhere has not been ruled out.

A disposable five-turn source was created through the real backend:
`01a1c3cb-eb71-7162-9309-24d7764119ff`. Selecting the second response uses
turnIndex `1`, turn ID `01a1c3cb-ff82-72d1-9068-90fad3336b1b`.
The old backend forks all five turns, computes rollback numTurns `3`, then
fails because this server rejects `thread/rollback` as an unknown operation.
The backend reports an error and archives the incomplete fork. Silent success
with later history was not reproduced on this endpoint. The confirmed failure
is a protocol mismatch, alongside the independently observable missing browser
verification of cutoff support. Mocked rollback tests concealed the mismatch.

The installed binary's generated `ThreadForkParams` documents inclusive
`lastTurnId`. Verification used the current Vite backend on
`http://127.0.0.1:4173`, connected to the same independent server.
Playwright Chromium was used because Browser Use was unavailable. The actual
second-response Fork button sent:

```json
{"method":"thread/fork-at-response","params":{"threadId":"01a1c3cb-eb71-7162-9309-24d7764119ff","forkFromTurnIndex":1,"persistExtendedHistory":true}}
```

The resulting fork `01a1c3ce-bb66-7692-961e-c313259710f7` retained only:

- `01a1c3cb-eb90-71e3-9362-ef05ad3a7250`
- `01a1c3cb-ff82-72d1-9068-90fad3336b1b`

The initial native fork and durable read both pass the backend ID checks.
Immediate display and page reload show OK1/OK2 and exclude OK5. Separate
real-server read/resume/read checks also retain exactly those two IDs.
After resume, continuation asking for the largest prior OK number answers OK2;
its durable history contains the two retained IDs plus one new turn.
The source still has its original five IDs. No rollback RPC is used by the fix.
These are real-server observations, not fixture simulations. Existing UI styles
were not changed; theme-specific rendering and production deployment of the new
build were not verified in this investigation.

## User-message Revert split button

Prerequisites: an independently managed live app-server and a disposable working
folder. Create a conversation with file edits in at least 15 completed turns,
and save a draft in the original conversation.

1. In light and dark themes, open the arrow beside Revert near the viewport edge.
   Expect Revert and Fork and Revert, readable and within the screen. Opening
   the menu must send no API requests. Check Tab, Enter, Escape and outside click;
   switching conversations must close it.
2. Click the left Revert button. Expect Fork and Revert: the source history and
   draft and local files remain intact, and the fork excludes the selected user turn and all later turns.
   Expect navigation to the fork with the original message in its composer.
3. Choose each menu item separately. Revert must modify only the source history;
   Fork and Revert must modify only the fork. The next left click must always
   Fork and Revert. Repeat for the first turn and an earlier paginated turn.
4. Repeatedly click while pending; expect one fork and one native
   history revert. Both operations must be disabled during a generated response.
5. Navigate away while pending (including away and back). Expect no forced
   navigation and no message inserted into another conversation's composer.
6. Inject failures at source validation, fork, fork validation,
   history undo and refresh. Expect no subsequent stages or automatic retries.
   Created forks remain available; errors identify the stage and any confirmed
   native history revert. Verify local files remain unchanged.

Cleanup: archive disposable threads and remove the disposable working folder.
Files are shared between source and fork; no Git branch or worktree is created.

Performance audit: menu rendering is local state only. The guarded state routine
makes one fork call and one destination revert call, without file restoration. Validation reads only source/destination history, paging only as necessary
to find the target turn. Refresh and history invalidation target the destination;
no full thread-list refresh is requested. Live RPC timings
require a connected independently managed app-server.
