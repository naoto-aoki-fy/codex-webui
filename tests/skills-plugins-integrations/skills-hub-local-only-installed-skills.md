### Feature: Installed skills only

Prerequisites: run the current app with an externally installed valid skill visible to the configured Codex app-server; record its SKILL.md contents.

1. Open `#/skills` in light and dark themes. Verify installed cards and the external installation/reload guidance are readable.
2. Verify there is no external catalog search, directory link, install or uninstall control.
3. Open the installed skill. Inspect local SKILL.md, Browse files, disable/enable, then Try it. Confirm the composer selects the skill and sending a conversation includes it.
4. Reload and select the same skill from the composer Skills picker. Verify it remains usable.
5. With an empty skill directory and no RPC skills, verify guidance says to install outside the web app and reload.
6. Request the retired search (GET), install (POST), and uninstall (POST) URLs. Verify they fall through as unhandled routes, never run commands, and preserve local files.
7. Expand MCP status, inspect tools, refresh, and authenticate if configured; behavior is unchanged.
8. Compare the recorded local skill contents after verification; they must be unchanged.

Expected: local discovery, selection and conversation use work with no catalog or installer requests. Existing user data is intact.

Cleanup: restore enabled state and remove only disposable fixtures using external tools.

### Local Skills UI simplification

Setup: use the installed skill above and open `#/skills` at 1280x900.

1. In light and dark themes, open the actual installed card and detail modal. Verify no owner, avatar, installed badge, or GitHub link appears; name, description, local contents, and Browse files remain readable.
2. Disable the skill, close details, and inspect the composer Skills picker. Verify its enabled state refreshes without a page reload. Enable it again and use Try it to select its local path.
3. Inspect network requests: opening Skills sends one hub listing request, opening details sends one local readme request, and each successful toggle writes configuration then refreshes the hub and composer skills. No remote catalog/install requests occur.
4. Request `/codex-api/skills-hub` directly: legacy owner, displayName, publishedAt, avatarUrl, url and installed fields remain present. Local readme requests retain owner/name/installed/path parameters.

Expected: local controls and composer integration remain functional with the reduced UI model and existing HTTP contract.

Cleanup: restore the original enabled state and close the modal.
