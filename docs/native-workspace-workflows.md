# Native workspace workflows

New conversations require an explicitly selected existing directory. Missing or nonexistent directories are rejected before forwarding thread/start; no fallback workspace is created. Existing folder browsing, registration, switching, CLI open-project, and managed Git worktrees remain available.

Conversation revert and fork/revert use Codex thread operations. The application never reverses patches, restores preimages, or resets files as part of these operations. Diff summaries and the diff viewer remain available.

The composer accepts ordinary files and images using the standard file input, clipboard, and file drag/drop paths. Camera capture and directory selection/upload are removed.

Legacy browser project aliases and manual ordering controls, their mutation APIs, timers, drag handlers, and browser persistence have been removed. Native Project rename/move operations remain supported. Inactive legacy browser project-order and project-display-name keys are left intact without changing selected threads, drafts, registrations, files or history. They are not another writable project registry. Projects now use native IDs, names and positions; sidebar membership follows native thread associations. See [native Project migration](native-project-migration.md). Legacy global-state root arrays, labels, remote records and unknown fields remain intact. The current runtime checks relevant legacy roots/remote records and connection completion receipts only to reject incomplete migration. Unsupported `project/list` produces an upgrade error; no legacy display fallback remains.

Retired directory-creation, GitHub clone, automatic chat-directory creation, and file rollback endpoints return JSON 404 for every method. Native Project operations remain available and do not create workspace directories. Older tabs must reload. Existing directories under Documents/Codex remain accessible as historical conversations or through normal folder selection. Codex's own Git tools are unaffected.

## Native ownership and retained adapters

Thread titles use native `thread.name`, `thread/name/set` and
`thread/name/updated`. Old global-state title fields remain untouched but are
not a title source. Projects use native IDs, names, roots, positions and explicit
thread associations; legacy folder records are read-only migration input.
Pins use native sections. The current runtime performs neither Project nor pin
migration; follow the [upgrade prerequisites](native-project-migration.md) before
upgrading a legacy installation.

History pagination, attachment intent and pending-send recovery are described in
the [history guide](persistent-thread-index.md). Inline media sanitization,
Portable Fork receipts and imported transcripts remain. Historical model/reasoning
values come from native rollouts and the persistent rollout-derived cache; see
[generation metadata](turn-generation-metadata.md). Retired metadata stores remain
untouched.

Browser transport, attachments, authentication, approvals, search, native read
receipts, model/reasoning settings, Plan mode, Goals, Skills and MCP adapters
remain supported. See [read receipts](native-codex-cleanup.md).

## Performance and verification boundaries

New conversation validation performs one directory stat. Project sorting is
O(n log n), without legacy rename timers, mutation requests or drag frames.
Retired file rollback endpoints return a fixed 404 without RPC or file operations.
This consolidation changes documentation only; historical measurements do not
establish performance of the current checkout.

Use [manual workspace checks](../tests/projects-sidebar-new-chat/native-workspace-workflows.md),
[development checks](development.md), and the
[external-server procedure](../tests/website-docs-misc/external-app-server.md).
Credential-free fixtures verify protocol/entry points, not authenticated turns,
approvals or durable cross-client pins. Generated schemas establish shapes, not
deployment capability. See [open items](maintenance/open-items.md).
