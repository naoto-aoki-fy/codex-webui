# Dedicated native review (01)

Setup: an idle disposable loaded thread on a capable runtime, or intercepted
`node scripts/test-approved-review.cjs`. Expand Conversation actions, choose
Uncommitted changes, Base branch, Commit, or Custom instructions; provide the
single corresponding value. Click Start native review: expect review/start with
inline delivery, no normal chat prompt. Duplicate/active/import-incomplete/offline
submissions must be blocked. Results appear as native review conversation rows.
Interrupt review turn uses the ordinary native turn interrupt; wait for its
completion event before claiming it stopped. Reopen: recorded review items remain.
Exercise unsupported/error/disconnect: no automatic retries or false success.
Check both themes and three viewports. Cleanup: close fixtures; use only designated
disposable workspaces for live model calls. No workspace rollback is promised.

Performance: zero review requests at startup; one explicit mutation; same desktop
notification subscription and normal debounced completion history refresh. Native
review text bounded to 12,000 characters and collapsed; no inferred execution
metadata. No new history store/cache or polling. Live review latency NOT RUN.
