### Feature: Per-thread model selection

#### Prerequisites
- App is running from this repository against a Codex app-server that supports thread-scoped model persistence.
- At least two selectable models are available in the composer model picker.
- At least one existing thread is available, or you can create one during the test.

#### Steps
1. On the new-thread screen, choose model `A` in the composer.
2. Send a message to create a new thread.
3. In that thread, switch the composer model to model `B`.
4. Send another message in the same thread so the thread persists model `B`.
5. Create or open a different thread and set its model to model `A`.
6. Switch back and forth between the two threads.
7. Refresh the browser while one of the threads is selected.
8. Re-open both threads again after the refresh.
9. While thread `A` is selected, use the sidebar thread menu to fork thread `B`.
10. Open the forked thread and confirm the composer model matches thread `B`, not the currently selected thread.
11. Restart the app-server or otherwise force a model-list refresh that does not include one thread’s persisted model, then switch back to that thread.
12. Delete one of the test threads you changed, refresh the thread list, and continue switching between the remaining thread and the new-thread screen.

#### Expected Results
- Each thread restores its own last selected model when you switch threads.
- The new-thread screen keeps its own draft model selection instead of inheriting the last opened thread.
- After browser refresh, reopening a thread restores the model persisted for that thread.
- Forked or newly created threads keep the resolved model returned by Codex, including fallback to the supported default model when needed.
- Forking a nonselected thread from the sidebar uses that source thread’s persisted model.
- If the selected thread’s persisted model is not returned in the latest model list, the composer still shows that model as the active selection instead of falling back to the placeholder label.
- Removing a thread prunes its saved per-thread model state, and model selection continues to update normally for the remaining threads without runtime errors.

#### Rollback/Cleanup
- Reset each tested thread back to its original model selection if you changed an existing conversation for the test.

### Provider-aware discovery and selection

Prerequisites: connect to an independently managed App Server configured with at least
one cloud provider and one local/custom provider. Configure these on that server,
including when the web application connects remotely. Prefer a shared model ID in
both catalogs to test identity collisions. No direct local-provider endpoint is used
by the web application.

Actions:
1. Open a new thread with a selected workspace. Open the model dropdown in light
   and dark themes. Search for each provider's display name and model name.
2. Select a cloud model, send a message, and inspect the `thread/start` RPC.
   Repeat from the new-thread screen with a local model.
3. Select different supported reasoning efforts for each provider/model pair.
   Switch between them on the new-thread screen, then reload the page.
4. Open each created thread and inspect its effective server metadata. Change
   its model within the same provider, then try a different provider's model.
5. Return to the new-thread screen. Confirm existing-thread changes did not
   replace its saved provider/model selection.
6. Temporarily stop a local provider or simulate its catalog request failing.
   Refresh discovery, reload, and then restore the provider and refresh again.
7. With a paginated catalog, inspect subsequent `model/list` requests. Repeat
   against an older server that rejects provider listing or provider parameters.
8. Repeat using legacy bare model and `reasoning-by-provider-model.v1` storage
   preferences. Verify they are interpreted against the server's configured
   provider without destroying saved preferences during failures.

Expected results:
- Options show `Provider display name — Model display name`; identical model IDs
  under different providers remain separate options and reasoning preferences.
- Creation sends both `modelProvider` and the raw `model`; turns send the raw
  model and provider-specific supported effort. The effective thread pair comes
  from the server's response and remains restored after reload.
- Existing threads reject cross-provider changes with a message directing the
  user to fork the conversation. Their provider and new-thread preferences stay intact.
- Unavailable pairs remain saved and selected rather than silently switching to
  another provider. Working provider catalogs remain visible after partial failure.
- Pagination retains the provider parameter. Repeated cursors terminate. Older
  servers fall back to the single-provider catalog. No direct Ollama/LM Studio
  requests or configuration-file scanning occur.

Cleanup: delete test threads, restore provider availability, original browser
preferences, reasoning choices, and theme. Do not remove unrelated saved settings.

Verification and performance audit:
- Automated gateway/state tests cover pair identity, creation, restoration,
  reasoning, partial failures, pagination, coalescing, and legacy fallback.
- The controlled browser check at `http://127.0.0.1:4173/#/?cwd=/workspace`
  (1440×1000) verified the real dropdown in both themes and local-pair persistence
  after reload. Artifacts: `output/playwright/provider-selector-light.png`,
  `provider-selector-dark.png`, and `provider-check.json`.
- Measured discovery traffic: one provider-list plus two provider-model requests
  per page load for two single-page providers; no duplicates within a load.
  Provider pagination is serial (maximum one outstanding discovery RPC in the
  regression test). Overlapping callers share an in-flight catalog request;
  completed catalogs are not indefinitely cached. Version/lifecycle guards reject
  stale state publications. Discovery runs asynchronously and introduces no
  filesystem work or thread-load requests. Payload size grows with catalog size;
  catalogs remain in memory and the selector uses its existing search component.
- Live provider latency, authentication, and actual local inference were not
  measured by the credential-free fixture or browser stubs. Serial discovery can
  wait for a slow provider RPC before publishing the combined catalog.

### Same-provider continuation and fresh-fork provider selection

Prerequisites/setup: install dependencies and configure providers P (models A/B)
and Q (models C/D) on an independently managed app-server. Keep the source
conversation idle. Use a server that supports provider-specific fork execution
for the successful Q continuation checks; see the limitation below for 0.167.2.

Actions:
1. Send three messages in one conversation, selecting P/A, P/B, then P/A.
   Inspect each `turn/start.model` and the provider endpoint receiving inference.
2. Delay `thread/resume`, select P/B before its response arrives, release the
   response containing P/A, then send. Repeat while `thread/read` is delayed.
3. Repeat with a legacy bare model ID and omitted provider metadata, with a
   catalog that unambiguously associates A/B with P.
4. Attempt to choose Q/C in the original conversation. Expect a visible message:
   "Fork this conversation to use a different model provider."
5. Fork from an earlier response and repeat with a full-history sidebar fork.
   Confirm inherited P/A defaults and history, select Q/C, and send.
6. Confirm `thread/fork` sends `modelProvider: Q` and `model: C` against the
   fresh fork's ID. The confirmed configured fork receives the new message;
   its history contains exactly the inherited prefix plus the continuation.
7. Reopen the original: provider, model selection, and history must be unchanged.
   Reload the continued fork: Q/C restores. Select Q/D and send; selecting P/A
   now requires another fork. Reload an unsent fork and verify it stays editable.
8. Return an unconfirmed provider/model or a provider-mismatch error from the
   backend. Expect an error, no successful continuation, and the original draft
   retained. A definitively rejected first turn leaves the fork editable.
9. Check the picker and error text in both light and dark themes.

Cleanup/rollback: archive only the conversations created for these checks;
restore the original theme and any test-only backend configuration.

Backend limitation (verified with Codex 0.167.2): `thread/fork` accepts overrides
and confirms Q/C, but `turn/start` rejects the loaded Q fork while the app-server
uses P as its configured default. The exact JSON-RPC error is `-32600`, with
`data: {type: "modelProviderMismatch", modelProvider: "Q",
currentModelProvider: "P"}`. No Q inference request occurs. `turn/start` exposes
`model` but no `modelProvider` override. The UI reports this failure; it does not
change global server configuration or replay a rejected message through P.
Reopening under the same incompatible server remains subject to its provider
check. A confirmed fork response alone does not prove successful continuation.

Smallest required backend change: execute a loaded fork using the configured
provider retained by its accepted `thread/fork.modelProvider` override, rather
than requiring equality with the process default. Resume must likewise restore
that saved provider when it is configured and allowed. Preserve policy checks
and reject incompatible history explicitly. No new frontend protocol field is
needed; both provider selection and model overrides already exist on fork.
A backend that lacks those fork overrides must add them and return the effective
provider/model. Starting provider-specific server processes is outside this
application's external-server lifecycle contract.

Validation/performance audit: state and gateway regressions cover pending reads,
A/B/A submissions, legacy catalog identity, both fork entry points, confirmation,
source isolation, reopening, and provider locking. An isolated real 0.167.2
app-server with temporary CODEX_HOME and local mock Responses endpoints received
exactly three inference requests: P/A, P/B, P/A. Forking at the first response
preserved one turn, confirmed Q/C, then rejected its first new turn before any Q
request. Reading the source afterward confirmed all three source turns unchanged.
These mock inference endpoints test protocol routing, not real provider auth or
model quality.

Code-path performance audit: ordinary sends add no RPCs; explicit choices use a
per-state Set and legacy provider resolution scans the in-memory catalog. History
refresh keeps its existing request count and coalescing. Changing a fresh fork's
provider adds one `thread/fork` before sending and, only after acceptance, one
best-effort archive of the intermediate draft. Backend fork metadata inheritance
also reads one source snapshot, rather than one request per message. Full fork
responses/history scale with conversation length; no new per-turn fanout or
unbounded request loop is introduced. Failed or ambiguous turns are never
replayed automatically. Real provider latency and large-history payload sizes
were not measured.

Controlled UI verification: `http://127.0.0.1:4173/#/thread/model-source`,
1440x1000, using Playwright RPC interception for deterministic provider catalogs
and inherited history. The changed composer notice was checked in both themes:
ordinary Q selection retained P/A and displayed the fork requirement; a fresh
fork with inherited messages allowed Q/C and displayed its first-message rule.
Screenshots: `output/playwright/model-provider-blocked-light.png`,
`model-provider-blocked-dark.png`, `model-provider-fresh-fork-light.png`, and
`model-provider-fresh-fork-dark.png`. Request evidence is in
`output/playwright/model-provider-check.json`. This UI fixture does not establish
live cross-provider continuation; the real-server limitation above still applies.

### Existing conversation switching with legacy metadata and delayed restoration

Prerequisites: two models A/B from one provider; a second provider for rejection
checks. Also test an older server without `modelProvider/list` support. Start a
conversation and complete its first turn. Record its original model.

Actions:
1. Switch A → B → A, sending a message after each selection. Inspect each
   `turn/start`: `model` must be the raw selected ID and effort must be supported
   by that model. Repeat with the legacy catalog and effective `openai` thread.
2. Delay `thread/read` or `thread/resume`, select B while the request is pending,
   then let the response return the old model A. Send another message.
3. Switch to another thread and back, then reload and send again, including when
   server restoration still reports A. B must remain selected and submitted.
4. Try another provider, including an identical raw model ID. The existing thread
   must reject it and keep its selection. Confirm a fresh fork can still choose
   a different provider before its first turn.
5. Temporarily make discovery unavailable. Qualified saved choices must survive.
   An ambiguous bare ID or a thread with no confirmed provider must be blocked
   with an unresolved-provider error, rather than silently switching providers.

Expected: only confirmed same-provider changes succeed in an existing thread;
legacy single-provider catalog IDs inherit the configured provider, or effective
thread identity when older configuration metadata omits the provider. No extra
model discovery or thread RPC is issued by selecting a model. Restoration cannot
overwrite an explicit choice, even after reload. Server-side provider rejection
still surfaces when the external server cannot run that thread's provider.

Cleanup: restore original models, remove test forks, restore discovery/network
conditions. To reset explicit local choices, clear the application's site storage
(this also removes other local preferences).
