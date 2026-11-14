# RiVault catalog and tool compatibility

## Prerequisites

Use an independently managed test app-server with the intended CODEX_HOME,
provider credentials, and separately managed catalog adapter. Record CLI and
app-server versions. Back up test provider configuration and saved UI selections.
Use disposable threads/workspaces; do not reconfigure production defaults.
Read the [diagnosis and adapter requirements](../../docs/rivault-model-compatibility.md).

## Actions and expected results

1. Run `codex debug models -c 'model_provider="rivault"'` on the test server host.
   Verify the exact `Qwen/Qwen3.6-35B-A3B` slug, direct tool mode, null patch type,
   and configured shell type. Verify reasoning efforts against provider support.
2. Inspect a redacted outbound Responses request on a fresh RiVault thread.
   Record tool names/types/format types only, with credentials and content omitted.
   Confirm no unsupported grammar declarations, including nested namespaces.
   Ask it to create a uniquely named temporary file through a shell tool and read
   it back. Require a real tool call/result and independently check file contents.
   Send a second turn; text-only success does not pass tool execution acceptance.
3. In isolated test catalogs, vary only patch type (null versus freeform), then
   only direct versus code mode; hold model, features and provider constant.
   Capture inventories and terminal errors for each case. This isolates which
   setting removes the offending declaration; do not assume either flag suffices
   for all versions or extra tools. Restore the known working catalog afterward.
4. Select OpenAI, create a thread and send a turn. Select RiVault and create a
   separate thread, then return to the original OpenAI thread and send another
   turn. Verify raw model/provider identities, unchanged original history and
   reasoning capabilities. Reload and confirm selections persist. Check menus in
   light and dark themes. Use the existing Native Fork/Portable Transfer matrix
   separately; do not change their semantics to suppress this error.
5. Make only the test catalog unavailable, then return malformed JSON and a raw
   OpenAI `data` list in separate checks. Refresh discovery. Verify failure is
   visible, saved selections remain intact, and no unrelated OpenAI models are
   attributed to RiVault. Distinguish adapter failures from Codex cache reuse;
   record whether stale data was used and its age. No failed turn is auto-retried.
6. Confirm catalog requests never invoke a CLI that requests the same catalog.
   Verify a per-model override cannot silently reintroduce grammar tools under
   the adapter's declared no-grammar policy. Exercise these checks in the adapter's
   own test suite when its source is available.

## Cleanup

Restore backed-up configuration/selections, remove temporary files, archive test
threads, and stop only test adapter/server processes started for this matrix.
Never retain unredacted inference requests. Record actual results separately
from simulated tests; the repository investigation did not run this live matrix.
