### Composer expands long drafts to full screen

#### Feature/Change Name
Thread composer full-screen expand control for multi-line drafts.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Any existing thread is open and send controls are enabled; also repeat on Home after choosing a folder
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, type or paste at least six lines into the composer.
2. Confirm the expand button appears in the composer input area.
3. Click the expand button.
4. Confirm the composer fills the viewport. The header (title and actions), sidebar,
   conversation history, goal panel, and Home folder/hero content are hidden and
   cannot receive keyboard focus. The textarea uses the remaining writing space.
5. Attach an image and a file. Open the model, thinking, Skills and **+** menus;
   select a skill and a thinking setting. Check slash suggestions and file mentions
   stay inside the viewport. Drag and drop an additional file into the input.
6. Open **+ → Apps / Connectors** and **+ → Prompts & commands**; verify both remain
   accessible. Close them without replacing the draft. During an active response,
   clear the draft and verify Stop is accessible without stopping automatically.
7. Restore the long draft. Click **Exit full screen composer**. Confirm the normal
   layout and sidebar visibility return, with draft, attachments, selected skill,
   model and thinking setting intact. Repeat expansion/exit using keyboard activation.
8. While expanded, deliver an approval or user-input request. The normal layout
   must return and expose the request panel; the draft remains after answering it.
9. Switch to dark theme and repeat. Repeat at 375×812 and 768×1024, including with
   the mobile keyboard open; controls and exit remain inside the visible viewport
   and clear device safe areas. A disabled editor must still permit full-screen exit.

#### Expected Results
- Short drafts do not show the expand control.
- Long or overflowing drafts show an icon-only expand control.
- **Minimize message input** is a separate inline action; see [collapsible composer](composer-collapse.md).
- Full-screen mode uses the same draft state and submit controls as inline mode.
- Full-screen and inline states are readable in light theme and dark theme.
- Expanding/exiting does not send messages, interrupt turns or issue API requests.
- The editor stays mounted; layout changes do not reset textarea selection or drafts.

#### Automated Regression
`APPROVED_DIST_ROOT=. node scripts/test-composer-fullscreen.cjs` after building
checks the current production assets with intercepted protocol fixtures at
`http://127.0.0.1:4173`. Reports and screenshots are saved under
`output/playwright/composer-fullscreen-*`. This is not live server validation.

#### Rollback/Cleanup
- Clear the draft from the composer.

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
5. Close a tab and open the conversation in a fresh tab. Click **Recover saved
   drafts** and choose the closed tab's draft: it is copied without submission.
6. Seed a `thread-draft.v1.<thread>` payload (in the active profile namespace),
   reload, edit it. Verify the legacy entry remains and the new writer owns a
   distinct v2 entry. Named profiles must not load unprefixed legacy drafts.
7. Deny storage writes: editing remains possible and a warning asks the user to
   copy the draft before closing. Repeat in light and dark themes.

Cleanup: Remove only disposable test draft entries/session pointers and test
conversations. Do not clear unrelated browser data. Archived drafts are retained
for recovery; no automatic age-based deletion is performed.
