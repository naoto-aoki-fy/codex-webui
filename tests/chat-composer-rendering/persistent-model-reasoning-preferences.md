### Persistent last-used model and per-model reasoning effort

#### Prerequisites/Setup

- Use a disposable browser profile with localStorage enabled and two models A/B offering multiple reasoning levels. Note each model's capability default.
- For provider isolation, configure two providers with an identical model ID and reasoning capabilities.
- Back up `codex-web-local.selected-model-by-context.v1` and `codex-web-local.reasoning-by-provider-model.v1` before editing browser storage.

#### Actions and Expected Results

1. On Home, select A and `high`; select B and `medium`. Switch repeatedly between A and B. The effort dropdown immediately restores the value saved for each model.
2. Submit a turn using B/`medium` and wait for acceptance. Reload the page and restart the WebUI backend. Home displays B/`medium`; switching to A restores `high`. A selector-only change must not replace the last accepted default on reload.
3. Select A/`high` in an existing thread. Open Home and select B/`medium`, then revisit the existing thread. Its model remains A and its effort is `high`; Home retains B/`medium`, including after reload.
4. While a different thread remains selected in the sidebar, change Home's model and effort. Home's options/value match the model shown in Home, and the first message sent uses those settings.
5. Select an identical model ID under each provider with different efforts. Switch providers and reload. Each provider restores its own model and effort without adopting the other provider's preference.
6. Remove the reasoning preference key, then reload and switch models. Each model uses its capability default. Repeat with malformed JSON and unsupported saved effort values. The UI remains usable and resolves a supported default; metadata refresh does not overwrite stored values.
7. Temporarily remove a saved model from the available catalog. Refresh model metadata: a usable fallback appears, but saved model/effort preferences stay intact. Restore the catalog and refresh: the saved model/effort return.
8. Navigate unrelated threads and refresh model metadata. A catalog display fallback may appear while a saved unavailable choice remains preserved. On an unsupported-model turn error, the selected model and saved per-model effort remain unchanged until explicitly selected in the UI.
9. Repeat dropdown checks in light and dark themes. Existing custom menus remain readable and the selected effort matches the displayed model.

#### Rollback/Cleanup

- Delete disposable threads and restore the original provider/model/appearance.
- Restore the backed-up storage entries, or remove only the two keys above in the disposable profile.
- For backend preference cleanup, stop the disposable backend and restore its profile-scoped `codexapp-model-preferences.json` backup. Never delete real profile data to repeat migration tests.

### Backend model preferences, accepted usage and browser migration

#### Prerequisites/Setup

- Use a disposable `CODEX_HOME` and Connection Profile with an independently managed external app-server and two available models. Back up its `codexapp-model-preferences.json` if present.
- Open two separate browser profiles/devices against the same backend. Keep credentials out of screenshots and fixtures.
- For migration, start with no backend preference file and seed the first browser's legacy global model/effort entries. Give the second browser a different stale model. Keep an existing thread with its own model/mode.

#### Actions and Expected Results

1. Load the first browser. Its legacy preference migrates. Load the second browser: it adopts the backend preference and never replaces it with its stale local value. Per-thread choices survive.
2. Select another model without submitting. Inspect `modelUsage` in `model-preferences/read`: counts/timestamps are unchanged. Before any accepted turn, the explicit preferred choice is shared; after an accepted turn, reload defaults to the last accepted settings.
3. Submit a turn with a chosen provider/model, effort and Plan mode. After acknowledgment, both browsers receive the changed usage metadata. The tuple key includes provider and model, the timestamp is UTC, and the count increments exactly once. Repeat once and confirm another increment.
4. Reject a turn (for example with a fixture error). No usage increment occurs. Changing selectors alone never increments usage.
5. Reload each browser and restart the WebUI backend. Open Home: last accepted provider/model, effort and mode return. Create a new conversation and confirm its first turn uses those settings. Existing threads keep their own model/mode, even while Home is open.
6. Change reasoning for different provider/model pairs concurrently in both browsers, and accept turns concurrently. Read the file/API: independent changes and every acknowledged turn count survive.
7. Disconnect one browser, accept a turn from the other, and reconnect the first. It reads the backend snapshot without polling. An actively edited unsent Home draft is retained; a fresh Home default uses shared last-used settings.
8. Remove the saved model/provider from the fixture catalog. Home shows an available fallback and a notice; saved settings remain intact. Restore the catalog and refresh: the saved choice returns. Existing cross-provider thread changes still require Portable Fork.
9. Start a different named Connection Profile. It has independent preferences/counts and does not import another profile's unscoped legacy reasoning. Switch back and verify original data.
10. With a disposable backend stopped, remove the preference file, then repeat with malformed JSON. Start/load: safe defaults appear and the next accepted turn can persist valid state. A future schema version produces a visible error and leaves bytes intact.
11. Simulate failed preference reads/writes. The composer remains usable with its current/fallback state, a synchronization error and Retry appear, and reconnect recovers authoritative state. If a turn was accepted before a disk failure, the UI must not resubmit it.
12. Repeat the actual composer/model menus, loading/error/fallback notices and post-refresh checks in light and dark themes. Confirm saved preferences never modify historical response metadata (CAP-003) and provider guards preserve Portable Fork (CAP-002).

#### Rollback/Cleanup

- Remove only disposable threads/profile directories. Restore backed-up browser keys, backend preference files and appearance; restore fixture catalog/error behavior.
- See [backend model preferences](../../docs/model-preferences.md) for storage, API, migration, failure semantics and the performance audit.

## Concurrent context preferences and stale cache retirement

Setup: Two same-origin tabs and two disposable threads; preserve existing legacy
browser preferences. Use a profile with two valid models in the same provider.

1. Select a different model and collaboration mode in each tab/thread at the same
   time. Reload both. Both choices must survive. Repeat with two tabs editing the
   same context: the last stored choice wins; draft text never changes.
2. Change a thread preference in the other tab; verify storage events update the
   shared selection without navigating either tab.
3. Seed a legacy global explicit-context array. Legacy profile choices must still
   survive server default hydration; a named profile must not inherit the array.
4. Seed old selected-thread, model-order and token-usage entries. Home must stay
   home, usage ordering must follow backend accepted usage, and stale token counts
   must not appear after reload. Counts are unavailable until server observation.
5. Reload with corrupt or unavailable browser storage: preferences use defaults or
   backend migration; the app must still boot. No unknown keys may be removed.

Cleanup: Remove only disposable context records and threads, restoring legacy
fixtures if modified. No backend accepted-usage data needs to be fabricated.
