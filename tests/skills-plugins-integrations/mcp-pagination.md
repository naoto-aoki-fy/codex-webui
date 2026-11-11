# MCP status pagination

## Repeated cursor termination

- Setup: use an isolated app-server fixture returning `mcpServerStatus/list` pages with distinct server names and cursors `a`, `b`, `a`. Do not alter real MCP configuration.
- Actions: open the MCP status list; capture RPC requests. Repeat with `next`, `next`, then a normal two-page response ending without a cursor.
- Expected: cycle case makes three requests (`{}`, `a`, `b`); repeated case makes two; normal case includes both pages. Server rows retain page order. Transport failures retain the existing error path. Light/dark list styling is unchanged.
- Cleanup: stop the fixture and restore its response script. No persisted state is created by these read requests.
- Automated equivalent: `pnpm exec vitest run src/api/codexGateway.mcpPagination.test.ts`.
