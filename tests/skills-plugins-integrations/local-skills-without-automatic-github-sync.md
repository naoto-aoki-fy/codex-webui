### Local Skills without GitHub authentication or synchronization

#### Prerequisites
- Build and run the current app with a disposable `CODEX_HOME` and a locally installed sample skill.
- Repeat with no GitHub credentials and with an inert legacy `skills-sync.json` containing test-only credentials. No actual login or repository setup is required.
- Record `AGENTS.md` contents/type/link target, Skills files, Git HEAD/remotes, and remote commit before each run. Test a regular AGENTS file, an existing symlink, and no AGENTS file.

#### Actions and expected results
1. Start/restart the app, open Skills, and refresh. No Skills repository initialization, bootstrap, fetch, pull, commit, push, or AGENTS replacement occurs. Existing symlinks remain as they were; a missing AGENTS file stays missing.
2. Disable then enable the sample skill. Only the normal `skills/config/write` request and local list refresh occur; no `/skills-sync/push` request occurs. Skill selection and use in the composer remain available when enabled.
3. Verify there are no web install/remove controls. Manage disposable skills outside the app and reload the page to rediscover them.
4. Confirm all Skills sync, repository setup, Pull/Push, GitHub login/device login/logout, and Firebase controls are absent. Removed sync endpoints must fall through without touching any stored credential file.
5. Re-check files and Git state: startup/toggles must not change them except intended local settings. Existing skill files and legacy credentials remain untouched.


#### Cleanup
Stop the test server and remove disposable homes/fixtures only. Do not undo existing user symlinks, credentials, or local Skills configuration.
