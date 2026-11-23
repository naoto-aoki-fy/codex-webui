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
   conversation history, and Home folder/hero content are hidden and
   cannot receive keyboard focus. The textarea uses the remaining writing space.
   With a saved Goal, click its chip above the textarea. Close Goal settings and
   verify the chip regains focus and editing remains full screen.
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
10. In both light and dark themes, try each action from full screen with a unique
    draft. Alternate between clicking the send control and pressing Ctrl+Enter
    (Command+Enter on Mac). Use DevTools network throttling or the fixture below
    to keep each request pending long enough to inspect the layout.

    - **First message from Home.** Choose a folder and send. The Home layout
      returns with the draft still visible while submission is pending. After
      acceptance, the new conversation opens inline. Return to Home and confirm
      that the sent draft has cleared.
    - **Existing conversation.** Click **Send** or use the shortcut. The header
      and history return while the draft is still visible. With a request pending,
      press the shortcut again and verify there is only one submission. After
      acceptance, the unchanged draft clears.
    - **Active response.** Wait for a response to begin and send new instructions
      using **Steer** or the shortcut. Verify the conversation becomes visible
      while the submission is pending and one set of instructions is accepted.
    - **Queue.** With the native queue available, enable **+ → Queue mode**, expand
      the composer, and use **Queue prompt** or the shortcut. The conversation
      becomes visible immediately, and the queue contains one new entry after
      acknowledgment.
    - **Failed submission.** Attach an image and a file, then simulate a rejected
      send. Verify the inline composer retains the text and attachments after the
      error and after reload. For Home, reject the first turn after thread
      creation and verify the Home draft remains available.
    - **Interaction while pending.** Send, then append text or start attaching a
      file before the result arrives. Verify the newer draft survives success.
      For an unchanged draft, manually expand again before acknowledgment and
      verify it clears while the composer stays full screen. Switch to another
      conversation while expanded and verify its own draft opens inline.
      For a pending first message, switch away from Home and return to the same
      folder URL. Edit and expand the restored draft. The send shortcut must
      issue no additional request while the original send is pending. When the
      original send is accepted, verify Home remains open with the edited draft
      still expanded.

    Back inline, verify Enter sends with **Require ⌘ + enter to send** off. With
    it on, verify Enter inserts a line break and the shortcut sends. Check that
    the setting tooltip explains the full-screen behavior.
11. While expanded, press Enter with a file or skill suggestion highlighted and
    verify it selects the suggestion. With an IME conversion in progress, press
    Enter and verify it confirms the conversion. Clear the draft and try the
    send shortcut with the send button disabled. For each check, verify that
    the composer stays expanded and no message sends.
12. In light and dark themes, turn **Require ⌘ + enter to send** off and expand
    the composer. Open the **Network** panel in DevTools and filter for
    `composer-file-search`. For each check, clear the Network log and the draft,
    type `See tail`, put the caret directly before `tail`, and paste
    `@nonexistent_file`. Find the `POST /codex-api/composer-file-search` request
    whose **Payload** has `query` set to `"nonexistent_file"`. The composer can
    show **No matching files** while the request is pending, so use the Network
    panel to confirm the search state. Press Enter in the composer for each check.

    - **Completed search in full screen.** Confirm the matching request returns
      HTTP 200 and `{"data":[]}` in **Response**, then press plain Enter once.
    - **Pending search in full screen.** Enable network throttling before repeating
      the draft setup. Press plain Enter once while the matching request shows
      **Pending** in the Network panel and no file candidates are visible.

    In both full-screen checks, verify that the panel closes, a line break moves
    `tail` to the next line, the caret is at the start of that line, and no message
    sends.

    - **Completed search in normal view.** Disable throttling, exit full screen, and
      repeat the draft setup. In the Network panel, confirm the matching request
      returns HTTP 200 and `{"data":[]}` in **Response**, then press plain Enter once.
      Verify that the panel closes, the draft stays on one line, and no message sends.

#### Expected Results
- Empty, short and long drafts show the icon-only expand control when inline.
- **Minimize message input** is a separate inline action; see [collapsible composer](composer-collapse.md).
- Each valid submission restores the normal layout before the result arrives.
  Acknowledgment clears only the matching draft. Manual expansion during
  submission and newer edits survive settlement.
- Full-screen and inline states are readable in light theme and dark theme.
- Expanding/exiting and inserting a plain line break issue zero API requests.
- The editor stays mounted; layout changes do not reset textarea selection or drafts.

#### Automated Regression
`APPROVED_DIST_ROOT=. node scripts/test-composer-fullscreen.cjs` after building
checks the current production assets with intercepted protocol fixtures at
`http://127.0.0.1:4173`. It verifies button clearance, native line-break insertion,
zero additional API requests during layout changes and newline insertion, and
immediate return to the normal layout for held send responses in both themes.
It also holds the new conversation's history refresh to verify that Home
navigation proceeds after the send acknowledgment.
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
