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
