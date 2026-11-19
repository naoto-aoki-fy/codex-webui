# Shared local file HTTP operations

Prerequisites: install dependencies and create a temporary directory with a text file,
an image, a hidden file, and a subdirectory. Run the development server and, after
`pnpm run build`, the production CLI. Apply the checks below to both server URLs.
Authenticate first if the production server requires a password.

1. GET `/codex-local-directories?path=<encoded absolute directory>` and repeat with
   `showHidden=true`. Expect JSON `{data}` containing directories, with hidden entries
   controlled by the flag. A file path returns 400; a missing directory returns 404.
2. GET `/codex-local-browse<absolute path>` for the directory, text file, and hidden
   file. Expect JSON 404 for directories (including trailing slashes and symlinks), and unchanged file contents for files. No parent/child navigation or folder action is rendered. HEAD returns no body; a file request
   with `Range: bytes=0-5` returns 206 and the first six bytes.
3. GET `/codex-local-image?path=<encoded absolute image path>`. Expect the image MIME
   type and `private, max-age=300`. Unsupported extensions return 415; missing images
   return 404.
4. GET, HEAD, and PUT `/codex-local-edit<absolute text path>`. Expect no editor
   or save response and unchanged disk contents. GET/HEAD may reach the normal SPA
   fallback; PUT returns the normal unknown-route response (404, or 503 when frontend assets are missing). No directory listing is served.
5. Send relative image paths, NUL-containing paths, malformed browse percent encoding,
   and browse paths containing encoded `..` plus an encoded slash. Expect JSON 400.
6. Follow file links and download their contents; open the image and select a directory.
   Expect existing viewing, transfer, and folder selection behavior.

Cleanup: remove the temporary fixtures and stop only servers started for these checks.

## Implementation boundaries and performance

`src/server/localFileHttp.ts` owns read-only endpoint selection, shared path
validation, errors and filesystem orchestration. Vite and Express each mount it
once. `localBrowseUi.ts` supplies directory-only metadata for the existing workspace folder picker. It does not render HTML or enumerate files.
Express static transfer retains MIME types, ranges, conditional requests and HEAD.

The browser editor, its body buffering and its filesystem writes are removed.
Browse requests stat only the requested path; directories return 404 without readdir or per-entry stat fanout. Folder picker enumeration remains unchanged; no additional
requests, blocking work, large payloads, or cache invalidation are introduced.
Transfers remain streamed with backpressure and existing cache headers. Browser
startup timing is not measured by the HTTP contract tests.

## Chat and UI regression checks

In light and dark themes, open project/thread menus and installed skill cards/details.
Expect no Browse files action. Open the existing workspace folder picker, navigate
and select a fixture folder; expect it to become the working directory.
In TestChat, send a unique marker and a reference to the fixture text file with an
existing supported line suffix plus an image reference. Inspect the rendered row:
assert hrefOk, titleOk and textOk against the original path/label, follow the link,
and confirm file contents. Confirm the image renders. Attach a text file and image,
send a message, and confirm both attachments are available. Refresh and recheck.
Cleanup: delete the test conversation and temporary uploaded fixtures when done.

## Preserved integration boundaries

`ThreadConversation.vue` renders chat file anchors using `conversationLinks.ts`;
that utility retains path resolution, line suffix parsing and image URL conversion.
`ThreadComposer.vue` still opens referenced SKILL.md files directly.
`codexGateway.ts` uploads attachments to `/codex-api/upload-file`, handled separately
by `codexAppServerBridge.ts`; that route and its multipart handling are unchanged.
`useFolderPicker.ts` consumes `/codex-local-directories` for workspace selection.
Authentication middleware, path validation and Express file transfer remain intact.

## App-server file reads (Codex 0.167.2)

This section supersedes the local-filesystem and streaming implementation notes
above. Setup: independently run a compatible Codex 0.167.2 app server and configure
`CODEXUI_APP_SERVER_URL`. Create a directory with a text file, image, hidden
subdirectory, and Unicode filename **only on the app-server host**. Run both Vite
and production backends on a host without that directory. Authenticate as needed.

1. Repeat checks 1–5 above using the remote absolute paths. Expect the same
   success/status semantics. HEAD and Range transfer complete files upstream.
2. Open a SKILL.md file link and image link pointing at the remote fixtures.
   Expect their actual contents. Request a known Web-host-only project path;
   expect failure, never local bytes.
3. Send an inline image payload and open its generated `/codex-app-asset?id=...`
   URL. Expect the Web-owned image. Supply an invalid asset ID or path traversal;
   expect 400. Project images continue to use `/codex-local-image`.
4. Stop only the test app server and request a project file. Expect 502, not 404
   or local fallback. Restart it and retry; expect success and fresh connection
   initialization metadata. With an unsupported server, expect explicit RPC
   errors; with denied files, expect 403. Failed directory reads must not appear
   as an empty successful listing.
5. Request the text twice with If-None-Match from the first response; expect 304.
   Request an out-of-bounds range; expect 416 and Content-Range `bytes */<size>`.
   Modify the file remotely and repeat an ordinary GET; expect fresh bytes/ETag.

Cleanup: delete remote fixtures and the test conversation; stop only the servers
started for these checks and restore the previous app-server URL. Upload behavior
is deferred and is not evidence of remote file-access compatibility.

See [the architecture and verification limits](../../docs/project-file-access.md).

## Remote Windows directory roots and nested skills

- Setup: use a disposable remote fixture exposing `//server/share`, `\\server\share`, `C:/remote`, and `C:\remote`; A may run Linux. Include `skills/sample/SKILL.md`, a nested skill, and `skills/sample-other/SKILL.md`.
- Actions: browse each share/drive root with and without a trailing separator, enter a child, navigate to its parent, then open installed Skills.
- Expected: UNC paths retain server and share; drive roots remain absolute; sample's nested skill groups under sample while sample-other remains separate. POSIX browsing/grouping remains unchanged.
- Cleanup: remove only disposable fixture data; no production uploads or remote files are modified by these read-only checks.

## File transfer reuse and native history pagination

- Setup: use the credential-free fixtures (`pnpm exec vitest run src/server/appServerFileSystem.test.ts src/server/httpServer.localFiles.test.ts src/server/threadLiveStateRetirement.test.ts`) or disposable remote files and a long thread on an authenticated server. Record fixture/live evidence separately.
- Actions: concurrently fetch one file; repeat with HEAD, If-None-Match, If-Modified-Since and valid/invalid ranges. Edit the file, repeat, then reconnect. Open the long thread and load three older pages. Repeat with a fixture returning method-not-found and one returning permission failure for thread/turns/list.
- Expected: simultaneous reads coalesce; warm HEAD/validator/Range requests avoid another Base64 payload; edits and reconnect invalidate. Headers, 206/304/416 and content lengths stay correct. Ordinary history transfers item bodies only for the requested pages, using native opaque cursors. Method-not-found calls for a server upgrade. Permission and transport errors remain visible. Run the documented benchmark in `docs/remote-transfer-performance.md` for exact request/byte/cache measurements.
- Cleanup: remove only disposable fixtures and restore any test environment variables; no existing uploads are touched. For live tests, delete only the explicitly created disposable project files using the operator's normal remote tools.
