# About settings build information

## Prerequisites

- Run the current checkout with `pnpm run dev --host 127.0.0.1 --port 4173`, or serve a production build from `pnpm run build`.
- Record `git rev-parse HEAD` and the current appearance preference. No GitHub API access is needed.
- Use an isolated browser context for clipboard permission/failure checks.

## Actions and expected results

1. Open Settings and select About. Expect `Codex WebUI`, Git commit SHA, and Build timestamp. The SHA shows exactly the first 12 characters of the build's full SHA.
2. Click Copy and inspect the clipboard. Expect the entire SHA and a success message. Deny clipboard access (including the selection fallback) in an isolated context and retry; expect a readable failure message and a usable Copy button.
3. Inspect the commit link. Expect `https://github.com/naoto-aoki-fy/codex-webui/commit/<FULL_SHA>` in a new tab. Following the link requires GitHub access; displaying metadata and copying do not.
4. Verify the timestamp is readable UTC with an ISO `datetime` value. Reopen Settings and reload the page; it must stay fixed for that build/dev-server session.
5. In General, switch between Light and Dark, returning to About each time. Expect readable text, link, Copy button, borders, hover and keyboard focus states. Repeat at 1440x900, 375x812 and 768x1024; expect no clipped values or horizontal overflow.
6. Switch between General, Codex account, Apps / Connectors, and About. Expect the existing controls and navigation to retain their behavior. About itself sends no API requests.
7. Build with `GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 pnpm run build:frontend`. Serve that build and expect `0123456789ab`, the full supplied SHA in Copy/link, and the timestamp from that build. Inspect `dist/assets/*.js` for the full SHA and timestamp.
8. Unset `GITHUB_SHA`, rebuild, and expect the repository HEAD. In a disposable source archive without `.git` (outside any Git parent directory), repeat with the variable unset: expect `Unknown`, a build timestamp, and no copy/link controls. Repeat in an environment without Git on `PATH`; builds and About must still work.

## Cleanup

- Restore the original appearance and environment. Remove disposable archives and browser contexts.
- Rebuild without the test SHA before normal use. Do not remove or rename the working repository's `.git` directory to test fallback behavior.
