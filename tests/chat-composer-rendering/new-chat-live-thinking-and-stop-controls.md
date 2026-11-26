### New chat live thinking and stop controls

#### Feature/Change Name
Projectless new chats show live thinking state and interrupt controls while a turn is active.

#### Prerequisites/Setup
1. Use an isolated `CODEX_HOME` with valid Codex auth.
2. Start local Vite: `CODEX_HOME=<temp-home> pnpm run dev --host 127.0.0.1 --port 4173`.

#### Steps
1. In light theme, open `http://127.0.0.1:4173/#/`.
2. In the projectless `Chats` composer, send `create todo list app`.
3. Within a few seconds after send, confirm the conversation shows a live `Thinking` overlay even if no detailed activity event has arrived yet.
4. Confirm the composer shows a stop button while the turn is active.
5. Wait for the assistant output and confirm the stop button is replaced by the normal send button after completion.
6. Repeat in dark theme and confirm the live overlay and stop button remain readable.

#### Expected Results
- Active thread status from `thread/read`, including `{ status: { type: "active" } }`, keeps the selected thread marked in progress.
- The live overlay renders default `Thinking` for any active selected thread, even before reasoning/activity text arrives.
- The stop button is visible while the turn is active and disappears after completion.

#### Rollback/Cleanup
- Stop the temporary Vite server if it was only used for this check.
- Remove temporary projectless chat folders under `~/Documents/Codex/<today>/` if they are no longer needed.

### Live reasoning Markdown

#### Feature/Change Name
Live reasoning preserves streamed Markdown and starts a new paragraph at a summary part or reasoning item boundary.

#### Prerequisites/Setup
Use a disposable chat with an app-server that emits reasoning deltas, or use the browser notification fixture in `scripts/approved-fixture.cjs` to supply the deltas below. Keep the turn in progress during the check.

#### Steps
1. In light theme, open the chat and start a turn. Before the first reasoning delta, verify the Thinking label appears and the reasoning section is absent.
2. With the fixture, emit `item/reasoning/summaryTextDelta` for the active thread and turn, using the same reasoning `itemId` for each entry. Send each JSON string below as a separate `delta` and inspect the overlay after each update. With a live app-server, use a turn whose reasoning includes equivalent Markdown.

   ```json
   ["## Inspect\n\n**Check", "**\n\n- Compare `a < b", "`\n- <b>literal HTML</b>", "\n\n```\n  first\n    second\n```"]
   ```

3. Start a fresh turn and emit a whitespace-only delta, then stream `Checking install size estimates` in one item. Emit `item/reasoning/summaryPartAdded` for that item, followed by `Setting up release fixtures` in a second delta for the same item. Repeat on fresh turns with the second delta using a different `itemId`, once without a summary-part event and once with a summary-part event for the new item.
4. Stream at least ten more items, each with its own `itemId`, and check the time between each notification and its visible update. Scroll within the reasoning section to the last entry, then back to the first.
5. Switch to dark theme and repeat the streaming and scrolling checks on a fresh turn.
6. Emit a summary-part event and complete the turn before sending another delta. Start another turn and verify its first reasoning delta appears at the top of the frame.
7. In each theme, compare the active `Thinking` label and a regular assistant reply with the reasoning overlay while it shows a plain paragraph, a heading, and a list. Use text below the top-edge fade for the visual comparison.

#### Expected Results
- `**Check` appears as text until the closing `**` arrives. The word then becomes bold. The list displays bullets, `a < b` renders as inline code when its backtick arrives, and `<b>literal HTML</b>` is visible as text.
- The heading and list keep compact spacing and small type. The code block keeps both lines and their relative indentation.
- Whitespace-only reasoning stays hidden. The two reasoning titles appear in separate paragraphs with the same spacing in all three boundary cases. Completing a turn clears the reasoning section and any pending paragraph break.
- In both themes, the reasoning section is readable, stays within five lines of height, keeps its top-edge fade, and scrolls to the last entry without expanding the conversation layout.
- Reasoning paragraphs, headings, and lists share the same subdued text color in both themes. The activity label has stronger contrast, and the regular assistant reply stays readable at its usual contrast.

#### Rollback/Cleanup
Stop any active test turn and close the disposable chat.

---
