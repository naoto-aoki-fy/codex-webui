### Feature: Portable conversation discoverability before and after cleanup

Setup: an independently managed POSIX Codex App Server with credentials and a
working default provider, locked dependencies, built current checkout and a
Chromium browser. The live test creates one source, two Portable destinations,
three real ordinary turns and one disposable native Project. Never use existing
user conversations as test sources.

Prepare the baseline without changing the current branch:

```sh
portable_before_root=$(mktemp -d /tmp/codexapp-portable-before-XXXXXX)
git archive de7fde9 | tar -x -C "$portable_before_root"
ln -s "$PWD/node_modules" "$portable_before_root/node_modules"
(cd "$portable_before_root" && pnpm run build)
```

Actions:
1. Inspect listeners and cwd for 4173 and 4194. Stop only stale verification
   processes you own. Do not stop the persistent 5173 or external Codex server.
2. Run:

   ```sh
   PORTABLE_DISCOVERY_LIVE=1 \
   PORTABLE_BEFORE_ROOT="$portable_before_root" \
   PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright \
   node scripts/test-portable-discoverability.cjs
   ```

3. Inspect `output/playwright/portable-discoverability.json`. Both versions use
   the same native server, provider, model, cwd, unarchived/all-provider listing
   filters and native Project membership. The old destination is explicitly bound
   to that same Project because pre-cleanup Portable creation did not pass projectId.
4. Check native global/project/cwd/database/title-filtered lists, native content
   search and each application's actual thread/list response. Exhaust cursors;
   keep the ordinary source as a positive listing control.
5. The harness restarts each application using its durable isolated home and opens
   a new browser context at the home route, never a saved destination URL. Check
   sidebar, title search and imported-content search at 1440x1000 in both themes.
6. Submit the first ordinary turn through each real application. Record the
   initial post-acceptance observations separately: native indexing can change
   between probes. After completion, restart each app/context again and reopen
   through a sidebar row; verify the original imported text remains visible.

Expected: classify based on the recorded comparison, not a URL-only content
check. Stable native/application lists must agree. The injected-only baseline and
current cases should have equal behavior; the ordinary-turn cases must retain the
same destination IDs and imported text, with no duplicate conversation creation.
A native indexing transition immediately after turn/start is not evidence that
application grouping removed a row.

Cleanup: only test-owned threads are interrupted if necessary and archived; only
the test Project is deleted. The two comparison application processes are stopped.
Original rollouts and existing user conversations/projects are never edited or
deleted. Temporary app homes, baseline build and test directories remain for
inspection. Restart the current checkout's disposable 4173 dev server afterward.
This is opt-in live acceptance; it is not a credential-free CI test.
