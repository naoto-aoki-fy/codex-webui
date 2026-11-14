# App Server protocol

The application imports the generated Codex CLI **0.167.2** protocol slice under
[`src/server/protocol/0.167.2/`](../src/server/protocol/0.167.2/).
[`appServerDtos.ts`](../src/api/appServerDtos.ts) re-exports frontend DTOs from that
same source. The unversioned JSON and TypeScript snapshots have been removed.

See [provenance and regeneration](app-server-schemas/README.md),
[external-server setup](../docs/external-app-server.md), and
[filesystem capabilities](../docs/project-file-access.md).
