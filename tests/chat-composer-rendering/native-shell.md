# Explicit standalone native commands (26)

Use credential-free interception only unless disposable live resources are
explicitly designated. No live resource is designated for this implementation.

1. Open Conversation tools → Standalone native command (read-only). Confirm no
   native command runs while opening or inspecting. Inspect an idle native thread
   whose returned environment is exactly `local` with the same cwd. Display native
   shell path, cwd, target and read-only/no-network policy. Unknown, mixed, remote,
   non-POSIX and mismatched contexts must reject without executing a fallback.
2. Enter text and omit confirmation: Execute remains disabled. Confirm the exact
   command/context and execute once. Revalidate before native `command/exec` with
   caller-owned process ID, explicit readonly sandbox, 30-second native timeout
   and 64 KiB per-stream capture. Immediate steering, chat drafts, model state,
   history and imported prefixes must remain untouched. Duplicate execution and
   conflicting chat/history/deletion/account actions stay blocked while pending.
3. Keep the final RPC response delayed: show Requested, never infer acceptance or
   completion. Terminate explicitly using the exact process ID; this must never
   call `turn/interrupt` or thread background-process termination. Await the final
   native exit response even after termination acknowledgment or rejection.
4. Return exit 0/nonzero, empty streams, oversized output, HTML-like text and
   credential-shaped text. Show native exit code, bounded/redacted plain text,
   empty-vs-bounded distinction; no markup executes. Results stay in memory only.
5. Inject managed rejection, unsupported method, internal error and disconnect.
   Unknown writes/terminations never replay. Clear process identity/output on
   connection changes. Do not expose old-connection thread links/actions in the
   replacement profile. No status getter is fabricated for uncertain outcomes.
6. Navigate during lazy loading/preflight: do not execute for the replacement
   thread. Navigation after actual submission does not terminate the original
   command; its outcome remains associated with the original thread/connection.
7. Check light/dark at 1280×900, 375×812 and 768×1024. Run the CJS suite with
   `APPROVED_DIST_ROOT=. node scripts/test-risk-shell.cjs` and the documented
   Playwright browser path after a build. Capture screenshots in output/playwright.

Cleanup: close fixture contexts and discard simulated process responses. No
actual command, login, paid turn or resource mutation is required. Native commands
are standalone processes, not a terminal/PTY or a persisted conversation turn.

Full-access extension: only a fresh known managed-policy allowance offers the
custom Full access option. Select it, review irreversible filesystem/network
consequences and type the exact native cwd. A wrong cwd or unchecked confirmation
must prevent submission. Recheck policy before execution; changed/unknown managed
constraints must withhold Full access. The request changes only this process's
sandbox policy, never global/thread defaults. After exit, Inspect defaults back
to read-only. Verify both Full and read-only views in both themes/three sizes.
Use harmless fixture commands such as `printf full-fixture`; do not run real
full-access commands for acceptance. A native nonzero exit may follow partial
side effects; exit, timeout and termination do not imply rollback.

While a standalone process is pending, simulate a model turn arriving from another
client with an existing chat draft. The model Stop control must remain available
without enabling sending/steering or clearing the draft. Native process termination
must still use `command/exec/terminate` and must not interrupt that model turn.
