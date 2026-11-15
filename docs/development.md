# Local development

First start `codex app-server --listen ws://127.0.0.1:4500` independently on the host that owns
the repositories and Codex login. The web backend can use a separate host and SSH tunnel. See [connection details](external-app-server.md).
Development honors `CODEXUI_APP_SERVER_URL` and preserves `CODEX_HOME`.

Use Node.js 22 for development/CI (the runtime minimum in package.json is separate).
Enable Corepack (`corepack enable`), then use the exact pnpm version in
`package.json`. Install dependencies with `pnpm install --frozen-lockfile`.
Commit `pnpm-lock.yaml` alongside intentional dependency changes; use
`pnpm install --lockfile-only` to update it and review the diff. Do not mix npm
lockfiles into this pnpm workspace. The dev wrapper only installs when Vite or
vue-tsc is missing; it does not verify an existing dependency tree.

Normal HTTP development needs no TLS
credentials:

```sh
pnpm run dev --host 127.0.0.1 --port 4173
```

Production builds use `pnpm run build` and do not read development certificates.

## File search

Composer file search runs on the external App Server through `fuzzyFileSearch`.
The web backend no longer resolves or launches a local ripgrep executable.

## Optional HTTPS

Generate a fresh key and certificate on each developer machine. Previously
published private keys, including the old `.cert/localhost-key.pem`, are
compromised and must never be reused. This cleanup does not remove them from Git
history. Remove old local copies before generating replacements.

With OpenSSL installed, run from the repository root in a POSIX shell:

```sh
mkdir -p .cert
chmod 700 .cert
(umask 077; openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 \
  -keyout .cert/localhost-key.pem -out .cert/localhost-cert.pem \
  -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1')
pnpm run dev --config vite.config.https.ts --port 4173
```

Open `https://127.0.0.1:4173`. This self-signed certificate is not automatically
trusted by browsers. For trusted local HTTPS, use your existing local CA tool
(such as mkcert) to generate the same two files. Protect private keys with
owner-only permissions (or equivalent Windows ACLs); never share them or commit
them. No certificate tool is required at application runtime.

Alternatively, point to an existing local certificate and matching private key
outside the repository. Set **both** environment variables in the shell before
starting Vite (these are server-only variables, without a `VITE_` prefix):

```sh
DEV_HTTPS_KEY_PATH=/absolute/path/local-key.pem \
DEV_HTTPS_CERT_PATH=/absolute/path/local-cert.pem \
  pnpm run dev --config vite.config.https.ts --port 4173
```

PowerShell users can set `$env:DEV_HTTPS_KEY_PATH` and
`$env:DEV_HTTPS_CERT_PATH` before running the same dev command. Relative paths
resolve from the working directory. Missing or unreadable credentials fail with
setup instructions; HTTPS never silently falls back to HTTP. Restart Vite after
rotating certificates. HTTPS binds to loopback by default; remote development
requires an explicit `--host` and a certificate covering that hostname.

`.cert/` and common certificate/key file extensions are ignored by Git. Keep
custom credentials outside the repository even when using another extension;
never force-add ignored credentials. Delete `.cert/` when local HTTPS is no
longer needed, and unset the two environment variables after testing.

## Verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:unit
pnpm run build
pnpm run test:integration:fixture
```

Typecheck covers Vue/frontend and server/CLI TypeScript. Build includes frontend
checking, Vite/precompression and tsup; tsup alone does not check server types.
Unit tests use local mocks/protocol fixtures. The integration command is a CJS
harness launching the public ESM CLI and Vite against a local WebSocket fixture;
it requires free ports 4198/4199 and a POSIX process-group environment. No public
CJS exports exist. It verifies HTTP RPC, metadata, browser socket readiness,
endpoint precedence, single initialization and fixture survival after shutdown.
CI runs these commands on Linux without Codex, credentials or external services.
No browser installation is required for this fixture.

Real-server tests are separate and manual: follow
[external server verification](../tests/website-docs-misc/external-app-server.md).
Record Codex version, endpoint, shared home/path setup and results. Fixture success
does not validate authentication, real turns, approvals or real process survival.
Browser profilers require a working UI and server; they are optional diagnostics,
not isolated CI checks. There is currently no separate lint command.

Use command output for current test totals and failures. Results quoted in older
migration/refactoring records describe those revisions, not the current branch.

Protocol snapshot provenance and generation boundaries are documented in the
[schema inventory](../documentation/app-server-schemas/README.md).

The one-off `output/playwright/verify-bug-032-approval-panel.mjs` was removed:
it depended on the retired `.composer-with-queue` layout and stale API mocks.
Use the [maintained approval checklist](../tests/chat-composer-rendering/sandbox-approval-requests-recognize-newer-codex-payloads.md)
and external-server acceptance instead. Existing screenshots remain historical evidence.

## Profiling a selected thread

Choose a thread ID from the current server:

```sh
PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_THREAD_ID='<thread-id>' PROFILE_WAIT_MS=7000 pnpm run profile:thread
```

Inspect `duplicateCounts`, `warnings`, `totalApiKB`, `topApiSummary` and
`slowestApiRows` under `output/playwright/`. Error pages and failed boots do not
provide valid performance evidence. The thread command fails before launching a browser when neither PROFILE_THREAD_ID nor PROFILE_ROUTE is supplied. The mutating TestChat profiler requires TESTCHAT_ROOT pointing to a disposable native Project root: `node scripts/profile-testchat-realtime.cjs`.

## Maintenance acceptance

Use the [disposable live maintenance checklist](../tests/website-docs-misc/maintenance-live-acceptance.md)
for native Projects, fork/revert, Portable import display and a fresh-process
rollout-cache check. The live test is opt-in and does not run in credential-free
CI. Its browser checks use only test-created IDs; fixture coverage is reported
separately from live provider execution. See the [historical acceptance](maintenance-cleanup.md).


## Optional Docker feature checks

The reusable fast runner remains an optional source-mounted deployment check.
It does not install or launch Codex. First manage a compatible App Server outside
the WebUI container, using the [current capability contract](native-project-migration.md).
Its endpoint must be reachable **from inside the container**. A host service
bound only to host loopback is not reachable via the Docker bridge; supply an
explicitly managed test tunnel or a reachable test-service address. The runner
adds the Linux `host.docker.internal:host-gateway` alias but does not rebind services.

Rebuild the base image after changes to its Dockerfile:

```sh
docker build -t codexapp-fast-test-base:latest -f scripts/docker-fast-test-base.Dockerfile .
CODEXUI_APP_SERVER_URL=ws://host.docker.internal:4500 scripts/run-docker-fast-test.sh
```

The example URL assumes a test listener reachable at that address. Do not expose
an unauthenticated App Server publicly. Use a disposable test identity/home for
authenticated checks; credentials remain with the independently managed server.
No credentials are included in the image.

The runner builds the current checkout, mounts it read-only, publishes WebUI only
on `127.0.0.1:${PORT:-4191}`, and checks both the page and an `account/read` RPC.
Readiness establishes connection, not full native-capability or authenticated-turn
acceptance. Failures print container logs and remove only the container created
by that invocation. An existing container name causes an error instead of deletion.

On success the container remains available for manual testing. Stop it afterwards:

```sh
docker rm -f codexapp-fast-test
```

Override `CODEXAPP_DOCKER_FAST_CONTAINER`, `CODEXAPP_DOCKER_FAST_IMAGE`,
`CODEXAPP_DOCKER_FAST_HOME` and `PORT` for isolated runs. The named application
state volume is preserved even on failure; use a new volume for clean tests.
Remove a volume only when deliberately discarding test state.

Credential-free protocol checks remain `pnpm run test:integration:fixture`.
That harness manages its own synthetic WebSocket server and tests both CLI and
development entry points; it does not establish Docker execution or live Codex
authentication. See the [Docker acceptance checklist](../tests/auth-docker-runtime/fast-external-server.md).

## Standalone verification scripts

With a current development server on 4173, run `node scripts/test-maintenance-ui.cjs`.
Install Playwright Chromium first. API responses and notifications are intercepted;
this verifies rendering, not live Codex. Screenshots/assertions land under
`output/playwright/`. Override MAINTENANCE_BROWSER_BASE_URL when necessary.

Other `test-*.cjs` scripts remain opt-in diagnostics. Composer paste/Skills,
folder-picker, provider, sidebar-menu, toolbar and fork scripts exercise UI flows.
Password, connection-profile, connectivity and recovery scripts check deployment
boundaries. Inspect their environment inputs and matching manual procedures before
using real state. Maintenance/native-upgrade, rollout-cache-restart and Portable
discoverability are live harnesses referenced under `tests/website-docs-misc/`.
The external-server fixture is the credential-free CI entry-point check; Docker
remains optional. Absence from package scripts is not evidence of disuse.
