### Feature: Skills dropdown closes after selection in composer

#### Prerequisites
- App is running from this repository.
- At least one thread exists and can be selected.
- At least one installed skill is available.

#### Steps
1. Open an existing thread so the message composer is enabled.
2. Open `+` and enable `Skills`, then click the `Skills` dropdown in the composer footer.
3. Click any skill option in the dropdown list.
4. Re-open the `Skills` dropdown and click the same skill again to unselect it.

#### Expected Results
- The skills dropdown closes immediately after each selection click.
- Selected skill appears as a chip above the composer input when checked.
- Skill chip is removed when the skill is unchecked on the next selection.

#### Rollback/Cleanup
- Remove the selected skill chip(s) before leaving the thread, if needed.

### Feature: Skills selector is hidden by default and toggled from the + menu

#### Prerequisites
- App is running from this checkout with an enabled composer and two installed skills.
- Repeat in light and dark themes at desktop, 375x812, and 768x1024 sizes.
- Automated isolated UI regression: start `pnpm run dev --host 127.0.0.1 --port 4173`, then run `node scripts/test-composer-skills-visibility.cjs`.

#### Steps
1. Open a fresh composer. Confirm Model and Thinking remain visible and the Skills selector is absent.
2. Open `+`, then enable the `Skills` switch. Confirm the menu closes and the selector appears.
3. Open the selector, search by skill name or description, and select a skill. Confirm the dropdown closes and a chip appears.
4. Open `+` and disable `Skills`. Confirm the selector disappears while the selected chip remains visible. Submit a message with that chip selected and confirm the skill is included.
5. With the selector hidden, type `/` followed by a skill name and choose its suggestion. Confirm the chip appears and can be removed with its remove button.
6. Show the selector, select a skill, reopen the dropdown, and deselect that skill. Confirm the chip disappears.
7. Select a skill again, hide the selector, and remove its chip. Show the selector and confirm that skill is no longer checked.

#### Expected Results
- The switch accurately reflects visibility; toggling never changes active selections or draft text.
- Skill search, selection/deselection, slash suggestions, chips, and submitted skill metadata continue to work.
- Controls and the + menu fit each viewport and use the existing light/dark theme styles.
- Visibility is local to the mounted composer; a fresh composer starts hidden.

#### Rollback/Cleanup
- Clear draft text and selected skill chips. Hide the selector if still visible.
- The isolated browser check saves screenshots under `output/playwright/` and uses fresh browser storage; it does not submit real turns.
