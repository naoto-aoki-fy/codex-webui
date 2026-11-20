### Completed plan cards expose implement action

#### Feature/Change Name
Completed plan cards show an `Implement plan` button that turns plan mode off and sends an implementation prompt built from the plan content.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. An existing thread contains a completed persisted plan card
3. The thread composer is available for follow-up messages

#### Steps
1. Open a thread containing a completed plan card
2. Verify the plan card shows `Implement plan` at the bottom
3. Click `Implement plan`
4. Confirm the composer thread switches back to default mode
5. Inspect the next `turn/start` request or the resulting assistant behavior

#### Expected Results
- Completed plan cards render the `Implement plan` action even when the plan body is structured as headings/lists instead of checkbox steps
- Clicking the button sends a simple implementation follow-up message instead of copying the whole plan body into chat
- The next turn runs in default mode rather than plan mode

#### Rollback/Cleanup
- Archive or delete any test thread created only for this check

---

### Copy completed plan cards

#### Feature/Change Name
Copy the contents of an individual completed plan card as Markdown.

#### Prerequisites/Setup
1. Run the app and open a thread with multiple completed plan cards, including a Markdown plan and a structured plan with pending, in-progress, and completed steps. Include a completed card without a turn ID if available.
2. Have an updating plan card and an empty plan card available, and allow clipboard access. Use browser developer tools to simulate clipboard failures for the fallback check.

#### Steps
1. In light theme, copy each completed card and paste into a text editor. Repeat in dark theme.
2. Confirm the clicked button says `Copied`, then returns to `Copy` after about 1.8 seconds. Copy a different card before the timer expires.
3. Check the updating and empty cards. Use the existing response copy button and the `Implement plan` action on a suitable card.
4. Make `navigator.clipboard.writeText` fail and copy a plan; paste the result. Then also make the selection-based copy fail and try again.
5. Copy a plan and navigate away before the success timer expires.

#### Expected Results
- Each paste contains only the selected card's content, without the `Plan` title or button label. Structured steps use `- [ ]`, `- [~]`, and `- [x]`; Markdown-only content is preserved. A turn ID is not required.
- Only the most recently copied card shows `Copied`, for about 1.8 seconds. Both themes remain readable.
- Updating and empty cards have no copy button. Response copy and `Implement plan` continue to work independently.
- Clipboard API failure falls back to selection-based copy. When both methods fail, no success message appears. Navigating away causes no timer errors.

#### Rollback/Cleanup
- Restore any overridden clipboard functions and permissions, clear pasted test content, and archive or delete test threads if needed.

---

### Shared Plan interpretation during streaming

#### Feature/Change Name
Plan cards reuse normalized interpretation for explanation, steps, and copy content.

#### Prerequisites/Setup
- Use a test thread with a streaming Plan, a completed structured Plan, and a text-only checkbox Plan. Include pending, active, and completed steps.

#### Steps
1. Observe updates to the same streaming Plan card as its explanation and steps change.
2. Complete the turn, then copy the Plan and compare the pasted explanation and ordered steps with the card.
3. Repeat for a structured Plan whose raw text differs, and a plain Markdown Plan without checkbox steps.
4. Check an empty Plan and a completed Plan without a turn ID. Repeat in light and dark themes.
5. Click Implement on a completed assistant Plan with a turn ID.

#### Expected Results
- Streaming edits appear immediately without stale explanation or statuses; updating cards hide Copy and Implement.
- Nonempty structured steps take precedence over text parsing. Empty structured steps permit text fallback.
- Copy retains explanation and step order, with pending `[ ]`, active `[~]`, and completed `[x]` markers. Plain Markdown falls back to trimmed raw text.
- Empty cards hide Copy. Implement remains available for completed assistant Plans with a turn ID regardless of body content; clicking starts the existing implementation flow.
- Theme appearance is unchanged.

#### Rollback/Cleanup
- Remove test threads and clear copied test content.

---

### Minimize and expand Plan cards

#### Prerequisites/Setup
- Open a test thread with two completed Plan cards and a streaming Plan card. Use a completed card with a turn ID and a second thread for navigation.

#### Steps
1. In Light appearance, click the Plan heading on the first completed card to minimize it.
2. Use Copy on the minimized card and paste into a text editor. Check the second card and any response metadata below the first card.
3. Focus the minimized heading and press Enter or Space to expand the Plan.
4. Switch to Dark appearance and repeat steps 1–3.
5. Minimize the streaming Plan. After another update to that card, expand it and inspect the latest content.
6. Minimize a card, navigate to another thread, and return.

#### Expected Results
- The minimized card shows its Plan heading and available Copy action or Updating badge. Its body and Implement action are hidden, and other cards and response metadata remain visible.
- The heading reflects the expanded state and keeps keyboard focus when toggled with the keyboard. Expanding restores the body and existing actions in both themes.
- Copy still copies the minimized Plan. Updates to the same streaming card leave it minimized, and expanding displays its latest content.
- When returning to the thread, its cards start expanded.

#### Rollback/Cleanup
- Restore the previous appearance, clear pasted test content, and remove any temporary test threads.
