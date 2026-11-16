### Feature: Conversation Context dialog preserves usage indicators

#### Prerequisites
- Start the app with `pnpm run dev` and an authenticated Codex runtime.
- Open an existing thread. Context uses existing token-usage events; no new request is made on opening.

#### Steps
1. In light and dark themes, open **conversation header … → Context** and inspect usage; open **Settings → General** for account quota indicators before and after a turn completes.
2. Read the Context summary and visible detailed token counts. Check pending data, unavailable model window, low remaining context and live token updates. Verify the dialog names the selected conversation, and Settings no longer contains a Context row.
3. Select a model and reasoning effort, compose a message, and submit it. Verify the selected settings are used and the reply arrives.
4. Open the new-thread screen, select a model, and submit another message.

#### Expected Results
- Context values and account quota indicators reflect the same existing runtime data and warning thresholds.
- Context closes on conversation change. Opening/closing it preserves the draft, send mode, nonzero conversation scroll and streaming, with focus restored to the header menu.
- Check Escape, Tab/Shift+Tab containment, and light/dark at 1280×900, 768×1024, 375×812 and 320×900, with no horizontal overflow.
- Composer layout and controls remain unchanged on existing-thread and new-thread screens.
- Model selection, message drafts, and submission work normally.

#### Automated verification
- Build first, then run `APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=<installed-browser-directory> node scripts/test-context-dialog.cjs` for credential-free production-asset fixtures.
- Screenshots: `output/playwright/context-{1280,320,375,768}-{light,dark}.png`; request and continuity assertions: `output/playwright/context-results.json`. Live server authentication and native turns require separate acceptance.

#### Rollback/Cleanup
- Restore the original theme and model selection; archive any test thread if desired.
