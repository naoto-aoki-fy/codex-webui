# Precompressed frontend assets

Prerequisites: install dependencies and run `pnpm run build`. Start the production CLI with `node dist-cli/index.js --port 4192 --no-password --no-open`.

1. Request `/` and a JavaScript asset using `curl -sS -D /tmp/asset-headers -o /tmp/asset-body -H 'Accept-Encoding: gzip, deflate, br, zstd' http://127.0.0.1:4192/`.
   Compare the matching `.zst`, `.br`, and `.gz` files with `wc -c`. Expect the smallest sidecar's Content-Encoding and Content-Length, the original MIME type, and `Vary: Accept-Encoding`.
2. Repeat with `zstd`, `br`, and `gzip` individually. Expect the requested encoding. With `gzip;q=1,br;q=0.9,zstd;q=0.5` or `*;q=1,br;q=0,zstd;q=0`, expect gzip.
3. Repeat without an encoding header. Expect original content without Content-Encoding. With `*;q=0`, expect 406 and `Cache-Control: no-store`. With `*;q=0,identity;q=1`, expect original content.
4. Request a SPA route such as `/thread/example`. Expect the negotiated index HTML. Repeat with HEAD: expect identical representation headers and no body.
5. Send the selected ETag in If-None-Match with the same encoding. Expect 304; change encoding and expect 200.
6. In a temporary deployment, remove the preferred sidecar for one asset and request it again with all three encodings. Expect the next acceptable sidecar. Remove the other sidecars and expect identity, or 406 with explicit `identity;q=0`.
7. Run `pnpm exec vitest run src/server/precompressedStatic.test.ts` for round-trip decompression, MIME, fallback and binary exclusion checks. The fallback tests also remove a sidecar during a request and verify the replacement's headers and body.

Cleanup: stop only the test server, remove temporary files/copies, and rebuild if changing dist directly. No source or configuration rollback is needed.

## Long-term HTTP caching for build-generated JavaScript

Setup: run `pnpm run build` and start the production CLI as above. Keep
`dist/.vite/manifest.json` with the matching build; missing/invalid manifests safely
fall back to ordinary revalidation. Vite development serving is unchanged.

1. Read a JavaScript `file` from `dist/.vite/manifest.json`. Request that URL with
   `curl -I -H 'Accept-Encoding: gzip' http://127.0.0.1:4192/assets/<built-name>.js`.
   Expect `Cache-Control: public, max-age=31536000, immutable`, JavaScript MIME,
   gzip encoding and `Vary: Accept-Encoding`. Repeat with zstd, br, and identity;
   expect the same caching policy and the selected encoding (none for identity).
2. Request `/`, `/index.html` and `/thread/example`. Expect `Cache-Control: no-cache`.
   For unversioned public JavaScript, expect
   `public, max-age=0`, without immutable. Non-JavaScript policies remain unchanged.
3. Repeat a hashed request with its ETag in `If-None-Match`; expect 304 and the
   immutable policy. HEAD must have the GET headers with no response body.
4. In a browser with DevTools Disable cache unchecked, reload twice. Fresh hashed
   JavaScript should come from HTTP cache without revalidation; HTML revalidates.
   Change application JavaScript, rebuild and deploy the complete matching build.
   Reload: HTML references a new filename and the updated JavaScript downloads.
5. Exercise API, authentication and local-file routes; expect their existing
   behavior and cache policies. Run `pnpm exec vitest run src/server/precompressedStatic.test.ts`
   for automated policy, encoding, validator and route-isolation coverage.

Deployment: deploy assets and manifest together, revalidate HTML at reverse proxies,
and retain old hashed assets while older tabs may still request lazy chunks. Cache
headers here are emitted by the production CLI; external static hosts/CDNs need
matching configuration. Do not rewrite content at an immutable asset URL.

Performance audit: the manifest is read once when static middleware is created.
Negotiation reuses the original file's metadata and checks only the sidecars in
each quality group until it finds an available representation. It uses file
metadata to compare sizes, and Express reads the selected representation.
Compression runs at build time. Fresh browser cache hits avoid asset requests.

Cleanup: stop the test server and remove temporary response files; restore any
source edits made for the deployment test and rebuild.
