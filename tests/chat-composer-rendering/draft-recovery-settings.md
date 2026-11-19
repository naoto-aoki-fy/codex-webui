# Draft recovery in Settings

## Setup

Use a disposable browser context and conversation. For credential-free production
UI acceptance, build with `pnpm run build`, then run:

```sh
APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=<installed-browser-directory> node scripts/test-draft-recovery-settings.cjs
```

The script serves the current build through intercepted requests at
`http://127.0.0.1:4173/#/thread/approved-fixture`, seeds disposable profile-scoped
v1, fork-recovery and other-writer v2 records, and intercepts native RPCs. It uses
real browser draft storage, not a live Codex server. Results and screenshots are
saved under `output/playwright/draft-recovery-*`.

## Placement, discovery and empty state

1. With saved drafts from another tab and legacy v1 records, open the conversation
   in a fresh tab. Confirm the composer starts empty, then type a new draft. The composer must contain no **Recover saved drafts** entry or recovery
   empty state. Actual persistence-failure warnings must remain visible.
2. Open **Settings**. **General** shows the available draft count. Choose
   **General → Draft Recovery → Recover saved drafts (N)**. The list includes
   legacy v1, legacy fork recovery and other-tab copies for this conversation in
   the active profile; other conversations and profiles are excluded.
3. Open Settings in a fresh context without recovery sources. General contains
   **No other saved drafts for this conversation.** and **Refresh saved drafts**,
   with no recovery count badge or active recovery action. The composer stays quiet.
4. Keep Settings open while another tab changes its draft. Its availability
   updates; **Refresh saved drafts** also rereads the current stored copies.

## Copy semantics and safety

1. Make the current draft nonempty. Recover a legacy copy containing text, an
   image, a file attachment, a Skill and an App. Before replacement, the current
   draft must be archived with all fields. The recovered composer has every source
   field; no turn/start, turn/steer or thread/queue/add request occurs.
2. Keep the recovery list open: the source remains available, and the prior
   current draft is now recoverable. Close Settings with Escape, confirm the
   recovered input, reopen Settings, and recover the archived current draft.
3. In a second tab on the same conversation/profile, enter a distinct draft.
   Recover that draft in the first tab. The second tab's input and owned storage
   record must remain unchanged. Editing either tab must not overwrite the other.
4. Repeat with a second connection profile; no records from the first profile
   may appear. Legacy records must remain unchanged after selecting, recovering,
   closing Settings and reopening it. No source is consumed by recovery.
5. Deny archive writes (unit regression injects quota failure), then try recovery.
   An error must explain that the current draft could not be preserved. The
   current input and saved source must remain unchanged; nothing is submitted.
6. Close Settings without selecting anything. The current draft must remain
   intact. Reopen Settings: the list starts collapsed and rereads availability.

## Layout and accessibility

At 1280×900, 375×812 and 768×1024, repeat in light and dark themes. Inspect the
actual General section and expanded recovery list: no horizontal page/dialog
overflow, long previews wrap, surfaces and text match the theme. Tab to the
recovery action, use Enter to expand and recover a copy, and confirm
`aria-expanded` reflects the list. Shift+Tab from the dialog close button stays
inside Settings; Escape closes it and returns focus to the Settings launcher.

## Performance audit

Recovery enumeration remains the existing synchronous localStorage scan and
payload parser; no schema, storage keys, migrations or IndexedDB code changes.
The Settings child mounts only while Settings is open. It reads once on mount,
on relevant cross-tab storage notifications, and on explicit refresh/recovery.
There is no new request, polling, per-keystroke scan or asynchronous fanout.
Reopening and refreshing reread storage rather than using a stale persisted
cache. Payloads retain the original attachment contents; large-storage scan
latency is not benchmarked. Production build output checks bundle size; browser
acceptance asserts recovery does not submit native RPCs.

## Cleanup

Close disposable browser contexts; their seeded drafts disappear with them.
Do not clear a real user's localStorage or IndexedDB. For manual checks, keep
any genuine recovery sources and restore the original theme. Verification
artifacts under `output/playwright/` are not committed.
