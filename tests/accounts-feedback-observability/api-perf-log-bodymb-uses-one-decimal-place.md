### API perf log bodyMB uses one decimal place

#### Feature/Change Name
`[codex-api-perf]` log entries format `bodyMB` with one decimal place instead of four.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A request large enough to trigger `[codex-api-perf]` logging

#### Steps
1. Trigger a `/codex-api/` request that exceeds the perf logging threshold
2. Inspect the server log line that includes `bodyMB=...`

#### Expected Results
- `bodyMB` is formatted with one decimal place, such as `bodyMB=3.4`
- The log does not print extra precision such as `bodyMB=3.4489`

#### Rollback/Cleanup
- None

---

### RPC payload sizes with HTTP compression

Setup. Start the dev server with `CODEXUI_API_PERF_LOGGING=true`,
`CODEXUI_API_PERF_MS_THRESHOLD=60000`, and `CODEXUI_API_PERF_BODY_MB_THRESHOLD=1`.
Use a conversation whose latest history page contains more than 1 MiB of
compressible JSON.

1. Copy the `POST /codex-api/rpc` `thread/read` request for that conversation
   from DevTools as cURL. Send it with `Accept-Encoding: identity`, then send
   the same request with `Accept-Encoding: br`. Add `-D - -o /dev/null` to
   each command to capture the headers and discard the response body.
2. Expect one performance log entry for each request and the same one-decimal
   `bodyMB` in both entries. The Brotli response has `Content-Encoding: br`
   and its log includes `encodedResponseBytes` equal to its `Content-Length`.
   The identity entry omits the encoded-byte field.
3. Run `pnpm exec vitest run src/server/codexAppServerBridge.rpcResponse.test.ts`
   to verify that `bodyMB` includes the original request JSON bytes, including
   formatting whitespace, with both fixed-length and chunked requests.
   The aborted-upload cases send 1.5 MiB, close the socket, and expect a single
   `aborted` log entry with `bodyMB=1.5` for either framing mode.
   The rejected-upload cases expect `406` before sending the body, then a
   single `406` log entry with the bytes drained after completion or disconnect.

Cleanup. Stop the test server and restore any temporary environment overrides.
