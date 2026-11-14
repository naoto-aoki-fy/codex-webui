# Protocol baseline and regeneration

The build-time protocol baseline is Codex CLI **0.167.2**, pinned exactly in
`package.json` and the lockfile. No runtime Codex dependency is installed by the
application. Remote servers must support the methods used by an operation;
experimental availability is observed on the connection, not inferred from this
catalog or the server version.

Run `pnpm run generate:project-file-protocol` after installing the locked dev
dependencies. The script checks `codex --version`, runs `codex app-server
generate-ts --experimental --out <temporary-directory>`, copies the filesystem,
command, search, native Project request and frontend DTO dependency closures into
`src/server/protocol/0.167.2/`, and extracts sorted method and notification names
from `ClientRequest.ts` and `ServerNotification.ts` into
`src/server/appServerMethods.json`. Run it twice and compare diffs to verify
reproducibility, then run typecheck, unit tests and build.

`src/api/appServerDtos.ts` contains re-exports, not independent DTO definitions.
The previous unversioned snapshots and duplicated JSON schemas had unknown
provenance and no remaining source consumers after the DTO migration. They are
available in Git history. No arbitrary latest-version regeneration is involved.

The previous manual `ModelListParams.modelProvider` extension is now supplied by
the pinned generated type itself. All 18 previous DTO exports remain available.
The 0.169.0 live acceptance exercises native Projects, thread metadata updates,
pagination, fork/revert, inject-items and rollout filesystem operations. Generated
0.167.2 types remain the build-time baseline; runtime availability and response
semantics are checked per operation rather than inferred from the catalog.
