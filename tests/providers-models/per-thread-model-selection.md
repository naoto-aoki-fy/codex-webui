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
  user to start a new thread. Their provider and new-thread preferences stay intact.
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
