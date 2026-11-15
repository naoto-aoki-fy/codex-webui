# Version-checked MCP configuration switches (16, partial)

Setup: native config/read layers and config/value/write, existing simple-name base
user MCP definition; fixture `node scripts/test-approved-mcp.cjs`.
Open Skills → MCP configuration switches. Read configuration, select Save disabled
(or enabled) for one server. Confirm exact name, remote path and boolean. Expect
only mcp_servers.<name>.enabled, target path and expected version in the write.
Other MCP settings/config/secrets must never be sent or shown. Save acknowledgment
is distinct from effective runtime: no automatic reload; existing explicit MCP
Refresh/OAuth/status/tools workflows remain. Conflict/rejection/ambiguous ack
clears writable snapshot, requiring a fresh read before another action. Check
unknown/overridden, absent/multiple/profile/managed layers and complex server names
(no edits offered), delayed replies across connection replacement. Both themes/all
sizes. Cleanup: fixture only. For designated live tests explicitly restore the
original boolean/unspecified value externally; no real config writes in automation.

Performance: zero config management startup calls. One lazy layered read, projected
to max 100 names/booleans/version/path; one scalar version-checked write per confirm.
No reload/polling/new listeners, whole-definition serialization or secret roundtrip.
Native layered response size is not controlled by this UI. Live latency NOT RUN.
