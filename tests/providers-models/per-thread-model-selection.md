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

### Same-provider continuation and fork behavior

Setup: two models A/B from one provider and another configured provider Q.
Send A → B → A on an existing conversation; each request uses the selected model.
Attempt Q on an existing thread and on a Native Fork: selection remains locked to
the confirmed provider. Use Portable Fork's destination picker for a transfer to
another provider. No provider-triggered second fork, first-turn tracker, recovery
sidecar, or automatic archival of intermediate forks is expected. Ordinary drafts
and unknown-send-outcome warnings remain. Check both fork entry points and Fork
and Revert; the latter restores the selected prompt for editing.

Cleanup: archive disposable conversations; restore model/theme preferences.

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
   must reject it and keep its selection. Confirm Portable Fork still offers its destination provider picker.
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

### Historical rollout generation metadata

Prerequisites: connect an independently managed App Server with filesystem RPCs;
use a historical thread containing at least three turns with different recorded
models/efforts (including `none`), no submitted sidecars, and more than ten turns
for pagination. Record the Codex version and remote CODEX_HOME. Use a tunnel to
verify that the backend and App Server have different homes. Keep original rollout
files unchanged; inspect RPC counts with transport instrumentation.

Actions and expected results:
1. Open the thread with a different composer model selected. History appears
   promptly; assistant footers update to each exact turn's recorded values, with
   no `(sent setting)` suffix for execution evidence. Unknown fields stay unknown.
2. Load older messages. Their footers show their own turn context, never the
   latest model. Verify light and dark themes and then reload the browser.
3. Inspect the remote `cache/model-history/v1/` SHA-256 JSON file. It contains
   only version/source path/mtime and per-turn model/effort metadata. Reopen the
   thread, then restart only the web backend and reopen. Cache hits read the
   compact JSON and do not issue `fs/readFile` for the original rollout.
4. Submit a real new turn using Codex so its rollout grows, then reopen history.
   Verify source mtime invalidation, retained older evidence, and the new turn's
   exact metadata. Use **Refresh history** when offered; it bypasses valid cache.
5. Repeat against a server without filesystem methods or with denied cache writes.
   Conversations and submitted metadata remain usable; denied cache writes still
   allow current execution evidence. Switch profiles and confirm evidence cannot
   leak into another server with the same thread ID.
6. Open an existing fork: annotate only turn IDs actually found in its rollout.
   A malformed record or incomplete trailing line must not break thread loading.

Cleanup: archive disposable test threads, restore composer/profile settings, and
optionally remove only the tested remote model-history cache file. Never edit or
delete original rollout files or submitted-setting sidecars. Real cross-host RPC
compatibility and latency require this live check; unit fixtures are insufficient.

### New-thread Model Provider selector

Prerequisites: connect to an independently managed app-server exposing two model
providers, with declared default models and different reasoning capabilities.
Include a shared model ID in both providers. Record the server version. Also
repeat with a single-provider configuration and an older unqualified model list.

Actions:
1. On **Start new thread**, open **Model Provider** immediately before **Model**.
   Verify the discovered provider display names, then switch providers.
2. Verify Model contains only the selected provider's models and selects its
   declared default, even when another model was used more recently. Choose a
   different model; verify Thinking shows only its supported efforts.
3. Navigate to an existing thread and back. Reload the page. Verify the selected
   provider/model pair and its reasoning effort remain selected.
4. Send a message with each provider and inspect `thread/start`: `modelProvider`
   must be the selected provider ID and `model` the bare model ID. Open the
   resulting threads: no provider selector is offered; cross-provider model
   changes remain blocked by state validation.
5. Repeat at 1280x900, 375x812, and 768x1024 in light and dark themes. Open the
   provider menu; check menu colors, clipping, and control overflow.
6. With one discovered provider, its selector and model list remain usable.
   With no provider metadata, the legacy Model selector works without an
   invented provider option.

Expected: defaults, filtering, persistence, and start payloads follow the selected
provider; established-thread restrictions remain intact. No extra discovery
request is sent when opening or switching the provider dropdown.

Automated fixture: `node scripts/test-new-thread-provider.cjs` against the current
checkout on port 4173 mounts the real composer and preference state, checks
navigation/refresh and all six viewport/theme combinations, and saves screenshots
under `output/playwright/new-thread-provider-*.png`. Thread creation payloads are
covered by `useDesktopState.modelPreferences.test.ts`; the browser fixture does
not authenticate or create live server threads.

Cleanup: archive disposable threads and restore the previous draft selection and
connection profile. Retain unrelated server configuration and thread history.
