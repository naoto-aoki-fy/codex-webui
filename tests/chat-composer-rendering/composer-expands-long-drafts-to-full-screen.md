### Composer full-screen button and Enter behavior

#### Feature/Change Name
Full-screen editing and Enter behavior in the shared Home and conversation composer.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Use a disposable existing chat and repeat on Home after choosing a folder.
3. Note the current **Settings → General → Require ⌘ + enter to send** and
   appearance settings so you can restore them after testing.

#### Steps
1. In light theme, check that **Expand composer** is visible next to **Minimize
   message input** with an empty draft, a short draft, and a long draft. For the
   long draft, paste a line long enough to wrap and at least six lines of text.
   Check that the placeholder and text clear both buttons, including when the
   textarea scrolls. On Home before choosing a folder, verify the visible expand
   button is disabled.
2. Turn **Require ⌘ + enter to send** off, clear the draft, and click **Expand
   composer**. Check that the button changes to **Exit full screen composer** in
   the same corner and that the textarea receives focus.
3. Type `firstsecond` and place the caret between `first` and `second`. Press Enter
   once. Verify that `second` moves to the next line, the caret is before `second`,
   and no message sends. Check that text still clears the exit button. Exit full
   screen, turn **Require ⌘ + enter to send** on, clear the draft, expand, and repeat.
4. Confirm the composer fills the viewport. The header (title and actions), sidebar,
   conversation history, goal panel, and Home folder/hero content are hidden and
   cannot receive keyboard focus. The textarea uses the remaining writing space.
5. Attach an image and a file. Open the model, thinking, Skills and **+** menus;
   select a skill and a thinking setting. Check slash suggestions and file mentions
   stay inside the viewport. Drag and drop an additional file into the input.
6. Open **+ → Apps / Connectors** and **+ → installed-skill completion**; verify both remain
   accessible. Close them without replacing the draft. During an active response,
   clear the draft and verify Stop is accessible without stopping automatically.
7. Restore the long draft. Click **Exit full screen composer**. Confirm the normal
   layout and sidebar visibility return, with draft, attachments, selected skill,
   model and thinking setting intact. Repeat expansion/exit using keyboard activation.
   Minimize the inline composer and use **Show message input** to restore it.
   Verify that it returns inline with **Expand composer** visible.
8. While expanded, deliver an approval or user-input request. The normal layout
   must return and expose the request panel; the draft remains after answering it.
9. Switch to dark theme and repeat. Repeat at 375×812 and 768×1024, including with
   the mobile keyboard open; controls and exit remain inside the visible viewport
   and clear device safe areas. A disabled editor must still permit full-screen exit.
10. In a disposable chat, send separate drafts while expanded using Ctrl+Enter
    (Command+Enter on Mac) and the Send button. After returning inline, verify
    Enter sends with **Require ⌘ + enter to send** off. With it on, verify Enter
    inserts a line break and the shortcut sends. Hover over the setting and check
    that its tooltip explains the full-screen behavior.
11. While expanded, press Enter with a file or skill suggestion highlighted and
    verify it selects the suggestion. With an IME conversion in progress, press
    Enter and verify it confirms the conversion. For each check, verify that no
    message sends.
12. In light and dark themes, turn **Require ⌘ + enter to send** off and expand
    the composer. Type `See tail`, put the caret directly before `tail`, and type
    `@nonexistent_file`. Wait for the file search to finish with **No matching
    files**. Press plain Enter once. Verify the panel closes, `tail` moves to the
    next line with the caret directly before it, and no message sends. Clear the
    draft and repeat with network throttling enabled in DevTools. Use the Network
    panel to confirm the file search request is still pending when you press Enter
    with no file candidates visible. In the inline composer, repeat after the
    search finishes and verify the first Enter closes the panel, leaves the text
    on one line, and sends nothing.

#### Expected Results
- Empty, short and long drafts show the icon-only expand control when inline.
- **Minimize message input** is a separate inline action; see [collapsible composer](composer-collapse.md).
- Full-screen mode uses the same draft state and submit controls as inline mode.
- Full-screen and inline states are readable in light theme and dark theme.
- Expanding/exiting and inserting a plain line break issue zero API requests.
- The editor stays mounted; layout changes do not reset textarea selection or drafts.

#### Automated Regression
`APPROVED_DIST_ROOT=. node scripts/test-composer-fullscreen.cjs` after building
checks the current production assets with intercepted protocol fixtures at
`http://127.0.0.1:4173`. It verifies button clearance, native line-break insertion,
and zero additional API requests during layout changes and newline insertion.
Reports and screenshots are saved under
`output/playwright/composer-fullscreen-*`. This is not live server validation.

#### Rollback/Cleanup
- Clear test drafts and attachments. Restore the original send and appearance
  settings and network throttling, and remove disposable chats.

---

## Tab-isolated drafts and recovery

Setup: Use two same-origin tabs on the same connection profile and a disposable
conversation. Include text, an image, a file, a Skill and an App where supported.

1. Edit the same conversation differently in each tab; navigate away and back in
   both. Each tab must restore its own complete payload.
2. Clear/submit one tab's draft. Reload the other: its draft must remain intact.
3. Duplicate a tab, edit both copies, reload each. Copies must remain independent.
4. Open different conversations in the two tabs; reload either. Routes and drafts
   must remain independent. The home route must not reopen an old conversation.
5. Close a tab and open the conversation in a fresh tab. In **Settings → General →
   Draft Recovery**, choose the closed tab's draft. The copy does not submit a turn.
6. Seed a `thread-draft.v1.<thread>` payload (in the active profile namespace),
   then reload. Confirm the composer stays empty and the record is available in
   Draft Recovery. Choose it explicitly and verify the original bytes remain.
   A different named profile must exclude the record.
7. Deny storage writes: editing remains possible and a warning asks the user to
   copy the draft before closing. Repeat in light and dark themes.

Cleanup: Remove only disposable test draft entries/session pointers and test
conversations. Do not clear unrelated browser data. Archived drafts are retained
for recovery; no automatic age-based deletion is performed.
