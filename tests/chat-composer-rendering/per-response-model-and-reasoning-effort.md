### Per-response model and reasoning effort

#### Prerequisites/Setup

1. Run the app with a writable `CODEX_HOME` and a disposable thread.
2. Have two usable models and at least two reasoning effort values available.
3. Enable access to light and dark themes. For unsupported-model coverage, use an account/model combination that rejects the selected model.
4. Use a disposable backend-local `CODEX_HOME` with known sidecar records for history coverage. The external server may use a different host/home. See [metadata storage and legacy import](../../docs/turn-generation-metadata.md). Never modify original session logs.

#### Actions and Expected Results

1. Select model A and effort `high`, then send a request long enough to stream. The activity area and assistant response show the submitted settings, marked `(sent setting)` until execution evidence is available.
2. While A is running, select model B and another effort. A's footer retains its original values. Send the next request and check that its response shows B and its finalized effort.
3. Submit a message during generation. Confirm immediate submission and that response metadata reflects the settings sent with the request.
4. Trigger the unsupported-model error. Confirm the selected model stays unchanged, the failed user message remains visible, the error tells you to choose a supported model and retry, and no second turn starts automatically. Select another model and manually submit the retained message once; confirm it appears exactly once as a new attempt with the selected model metadata.
5. Reload during a response, reload after completion, and restart the web backend and reconnect the independently managed external App Server. Metadata remains associated with the same response. Settings are stored under the backend-local `CODEX_HOME/codexapp-turn-metadata/<server-hash>/`; session logs remain unchanged.
6. Open a historical thread and use **Load earlier messages**. Each assistant response uses its own saved turn metadata. Recorded model/effort values take priority over submitted values independently; missing recorded fields can retain known submitted values.
7. Open history without usable turn metadata. It shows `Model unknown` and `reasoning: unknown`, never the current composer settings. An explicitly null effort shows `unspecified`; an explicit `none` remains `none`.
8. Check intermediate assistant messages and the final answer from a single turn. They share metadata. User messages, command rows, and file change rows do not receive generation footers.
9. Repeat the display checks in light and dark themes. Footers remain small, readable, and wrap long model names without horizontal overflow.
10. In a thread with more than 10 turns and different model/effort settings, fork the whole thread. Check the newest messages and use **Load earlier messages**; copied responses retain their original values and source labels after reload and app-server restart.
11. Fork from an earlier response. Confirm that the retained responses show the original values, removed later responses stay absent, and a new response uses its own submitted settings. Repeat by forking the fork.
12. Open an existing fork without sidecar evidence. Missing metadata remains unknown; the app does not read undocumented session parent fields. Forks created through this backend retain copied metadata after reload even if the source later becomes unavailable.
13. Exercise matching with preserved turn IDs, regenerated turn IDs with preserved item IDs, and regenerated IDs with a unique exact text transcript. Duplicate or ambiguous transcripts, non-text inputs without matching IDs, and oversized text must not be guessed.

14. Connect a second browser/client and submit different settings concurrently. Each accepted turn retains its own settings; an unrelated `turn/started` event must not borrow the pending settings of another client.
15. Temporarily block metadata notifications in a test proxy while allowing the successful RPC response. The submitting browser retains the response metadata. Deliver an older submitted notification after execution evidence; it must not downgrade execution fields.
16. Restart with a different external endpoint or reported remote home and identical fixture thread IDs. No metadata crosses namespaces. Restore the original endpoint/home and confirm recovery.
17. In disposable storage, add malformed and incomplete rows; intact rows still recover. Test legacy import only after binding both documented environment variables. Without binding, legacy data stays unknown.
18. Make disposable sidecar storage unwritable, submit once, and inspect the thread. Submission remains successful and runs exactly once; the backend warns that metadata was not saved. Restore permissions before continuing.

#### Rollback/Cleanup

- Delete disposable threads; restore the original model, effort, and appearance.
- Remove the disposable `CODEX_HOME` if one was created. For a shared home, remove only the metadata sidecar belonging to the disposable thread (its filename is the SHA-256 of the thread ID, inside the server namespace).
- Restore proxy settings, storage permissions, endpoint and legacy-import variables. These manual/live checks have not been executed for this change; CI uses protocol and state fixtures.
