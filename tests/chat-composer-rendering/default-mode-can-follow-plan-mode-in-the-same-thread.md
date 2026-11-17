### Default mode can follow plan mode in the same thread

#### Feature/Change Name
Plan mode resets to Default after the server accepts a message; the submitted turn retains Plan mode. Subsequent turns send `default` explicitly.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A Codex account/session with both Default and Plan collaboration modes available
3. A project folder selected for a new or existing thread

#### Steps
1. Select Plan mode in the composer
2. Send a prompt asking Codex to create a plan
3. Immediately after acceptance, verify the composer automatically switches to Default; keep model, reasoning effort and Fast mode selections unchanged
4. Send a follow-up prompt asking Codex to implement the plan in the same thread
5. Refresh the page and send another Default follow-up in the same thread
6. Start a new conversation and verify Plan has not been restored from last-used settings
7. Enable Plan again, reject/fail the submission, and verify Plan remains selected
8. Repeat successful and rejected submissions for a new thread and while a turn is active
9. Repeat in light and dark themes

#### Expected Results
- The implementation prompts run in Default mode instead of staying in Plan mode
- The thread remains usable without opening a new chat
- The accepted planning turn uses Plan; the composer and subsequent turns use Default
- Failed/rejected submissions retain Plan; model, reasoning effort and Fast mode persist throughout

#### Rollback/Cleanup
- Archive the test thread if it was created only for verification

---
