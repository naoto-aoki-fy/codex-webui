### User message Revert action

#### Feature/Change Name
Eligible user messages show a `Revert` action under each eligible user message, while keeping the existing behavior that appends the original text into the composer and rolls the thread back from that turn.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. An existing thread with at least one completed user/assistant turn

#### Steps
1. Open a thread with multiple completed turns
2. Hover a completed user message
3. In both light and dark themes, confirm `Revert` appears under that user message with the back arrow icon. Hover and keyboard-focus it; confirm its tooltip and accessibility name are also `Revert`.
4. Confirm assistant responses no longer show the old `Rollback` button
5. Click `Revert` on an earlier user message with recognizable text
6. Observe the composer draft after the click
7. Confirm the thread rolls back from the selected turn

#### Expected Results
- The action under eligible user messages is labeled `Revert`
- Assistant responses no longer render the old rollback action
- Clicking `Revert` appends the original user text into the composer
- The existing rollback behavior still truncates the selected turn and later turns

#### Rollback/Cleanup
- Re-send the edited message if you want to recreate the conversation path

---
