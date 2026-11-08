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
4. GET `/codex-local-edit<absolute text path>`, then PUT UTF-8 text to the same URL.
   Expect editor HTML, then `{ok:true}` and changed disk contents. Directories return
   400; binary files return 415 on PUT; missing files return 404.
5. Send relative image paths, NUL-containing paths, malformed browse percent encoding,
   and browse paths containing encoded `..` plus an encoded slash. Expect JSON 400.
6. PUT more than 10 MiB, both with Content-Length and chunked transfer. Expect JSON
   413 and unchanged contents. Exactly 10 MiB is permitted. Compressed request bodies
   return JSON 415; clients must send uncompressed UTF-8.

Cleanup: remove the temporary fixtures and stop only servers started for these checks.

## Implementation boundaries and resolved differences

`src/server/localFileHttp.ts` owns endpoint selection, path validation, bounded body
reading, errors and filesystem orchestration. Vite and Express each mount it with
one middleware call. `localBrowseUi.ts` retains listing/editor rendering and text
eligibility. Existing Express static transfer code provides MIME types, ranges,
conditional requests and HEAD handling in both environments. WebSockets are unchanged.

Both environments retain absolute filesystem browsing, dotfile and symlink access,
and text-only editing. No workspace-root restriction is introduced. Decoding now
occurs once, malformed browse encoding/NUL/traversal is rejected, and missing edit
files return 404 before text eligibility checks. Vite uploads now have the production
10 MiB limit, including chunked bodies; errors are JSON in both environments.
Compressed uploads previously supported by Express's body parser are explicitly
rejected consistently. Vite file reads now have production MIME/range/conditional
transfer behavior. Duplicate query parameters consistently use the first value.

Performance audit: file transfers remain streamed with backpressure; HEAD does not
read file contents. Static transfer middleware is allocated once per server, not per
request. Edit body buffering is bounded at 10 MiB plus the current transport chunk;
concatenation adds at most another 10 MiB. Requests perform a stat before serving or
editing, with the static sender doing its own metadata lookup as before in production.
No network fanout, persistent cache or invalidation mechanism was added. The contract
test exercises both real mounts; browser startup/render timing was not measured
because UI rendering and startup requests are unchanged.
