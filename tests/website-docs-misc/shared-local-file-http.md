# Shared local file HTTP operations

Prerequisites: install dependencies and create a temporary directory with a text file,
an image, a hidden file, and a subdirectory. Run the development server and, after
`pnpm run build`, the production CLI. Apply the checks below to both server URLs.
Authenticate first if the production server requires a password.

1. GET `/codex-local-directories?path=<encoded absolute directory>` and repeat with
   `showHidden=true`. Expect JSON `{data}` containing directories, with hidden entries
   controlled by the flag. A file path returns 400; a missing directory returns 404.
2. GET `/codex-local-browse<absolute path>` for the directory, text file, and hidden
   file. Expect directory HTML or file contents. HEAD returns no body; a file request
   with `Range: bytes=0-5` returns 206 and the first six bytes.
3. GET `/codex-local-image?path=<encoded absolute image path>`. Expect the image MIME
   type and `private, max-age=300`. Unsupported extensions return 415; missing images
   return 404.
4. GET, HEAD, and PUT `/codex-local-edit<absolute text path>`. Expect no editor
   or save response and unchanged disk contents. GET/HEAD may reach the normal SPA
   fallback; PUT returns the normal unknown-route response (404, or 503 when frontend assets are missing). Directory listings contain no edit links.
5. Send relative image paths, NUL-containing paths, malformed browse percent encoding,
   and browse paths containing encoded `..` plus an encoded slash. Expect JSON 400.
6. Follow file links and download their contents; open the image and select a directory.
   Expect existing viewing, transfer, and folder selection behavior.

Cleanup: remove the temporary fixtures and stop only servers started for these checks.

## Implementation boundaries and performance

`src/server/localFileHttp.ts` owns read-only endpoint selection, shared path
validation, errors and filesystem orchestration. Vite and Express each mount it
once. `localBrowseUi.ts` renders directory listings and folder selection controls.
Express static transfer retains MIME types, ranges, conditional requests and HEAD.

The browser editor, its body buffering and its filesystem writes are removed.
Directory listings still stat entries for sorting but no longer open/read files to
probe text eligibility. Existing per-entry stat fanout is unchanged; no additional
requests, blocking work, large payloads, or cache invalidation are introduced.
Transfers remain streamed with backpressure and existing cache headers. Browser
startup timing is not measured by the HTTP contract tests.
