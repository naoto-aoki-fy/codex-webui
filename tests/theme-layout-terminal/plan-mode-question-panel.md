### Collapsible Plan Mode question in the conversation

#### Prerequisites and setup

Start the frontend with `pnpm run dev --host 127.0.0.1 --port 4173`. With Playwright Chromium installed, run the following from the repository root to open an isolated browser with the development fixture and inject a pending Plan Mode question.

```bash
node <<'NODE'
const { chromium } = require('playwright')
const { setup, thread } = require('./scripts/approved-fixture.cjs')

async function main() {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const history = (id, text) => ({
      id,
      status: 'completed',
      items: Array.from({ length: 12 }, (_, index) => ({
        type: 'agentMessage',
        id: id + index,
        text: text + ' ' + (index + 1) + '. ' + 'Read this conversation history. '.repeat(10),
      })),
    })
    const historyDelay = Number(process.env.HISTORY_DELAY_MS ?? 0)
    const questionTurn = {
      id: 'question-turn', status: 'completed',
      items: [
        { type: 'userMessage', id: 'prompt', content: [{ type: 'text', text: 'Prepare a documentation plan.' }] },
        { type: 'agentMessage', id: 'before-question', text: 'The plan depends on the documentation scope.' },
      ],
    }
    const { emit } = await setup(page, async (body, _page, url) => {
      if (url.pathname.endsWith('/server-requests/respond')) {
        console.log('Request reply', JSON.stringify(body))
        if (body.id === 200) {
          setTimeout(() => emit('server/request', {
            id: 201,
            method: 'item/commandExecution/requestApproval',
            params: { threadId: thread.id, turnId: 'latest', command: 'echo approved' },
          }), 500)
        }
        if (body.id === 200) {
          const response = { id: 'saved-scope', threadId: thread.id, turnId: 'question-turn',
            anchorItemId: 'before-question', submittedAt: new Date().toISOString(),
            questions: [{ id: 'scope', heading: 'Documentation scope', answers: body.result.answers.scope.answers }] }
          return { json: { ok: true, response, saved: true } }
        }
        return { json: { ok: true } }
      }
      if (body.method === 'thread/resume' || body.method === 'thread/read') {
        const turns = [
          history('earlier', 'Earlier message'),
          ...(historyDelay ? [] : [questionTurn]),
          history('later', 'Later message'),
          { id: 'latest', status: 'completed', items: [{ type: 'agentMessage', id: 'answer', text: 'Fixture answer' }] },
        ]
        return { json: { result: { thread: { ...thread, turns }, model: 'fixture-model', modelProvider: 'fixture', olderCursor: historyDelay ? 'older-fixture' : null } } }
      }
      if (body.method === 'thread/turns/list' && historyDelay) {
        console.log(`Returning the question turn in ${historyDelay} ms`)
        await new Promise(resolve => setTimeout(resolve, historyDelay))
        return { json: { result: { data: [questionTurn], nextCursor: null } } }
      }
    }, false)

    await page.getByRole('button', { name: 'Add attachments and settings' }).click()
    await page.getByRole('switch', { name: 'Enable plan mode' }).click()
    await page.keyboard.press('Escape')
    await page.locator('.conversation-list').evaluate(element => { element.scrollTop = element.scrollHeight })
    const scope = {
      id: 'scope',
      header: 'Documentation scope',
      question: 'Which scope should the plan use?',
      isOther: true,
      options: [
        { label: 'Quick update', description: 'Update the setup notes.' },
        { label: 'Full review', description: 'Review the whole guide.' },
      ],
    }
    const extraQuestions = process.env.LONG_QUESTION === '1' ? Array.from({ length: 12 }, (_, index) => ({
      ...scope,
      id: `section-${index}`,
      header: `Review section ${index + 1}`,
      isOther: false,
    })) : []
    emit('server/request', {
      id: 200,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'approved-fixture',
        turnId: 'question-turn',
        questions: [scope, ...extraQuestions],
      },
    })
    await page.waitForEvent('close', { timeout: 0 })
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
NODE
```

#### Steps and expected results

1. Open **Settings → General** and cycle **Appearance** to **Light**, then close Settings. Scroll up through **Later message** to the question. Verify that the expanded **Awaiting response** card sits directly below “The plan depends on the documentation scope.” and above **Later message 1**. Confirm there is no regular message input. Check that the panel and question card have light surfaces and the prompt, labels, and option description have readable dark text.
2. Use **Tab** to reach the choice field and **Enter** to open it. Check the light menu surface, option labels, selected row, and focus outline as you tab through the options. Press **Enter** on **Full review** and verify that its description appears.
3. Tab to **Other answer** and then **Send**. Both controls show a visible focus outline. Return to **Other answer** and type `Keep the existing sections` without submitting.
4. Scroll so the text immediately above the card and the heading are both visible. Focus **Awaiting response** and press **Enter**. Only the heading and its chevron remain visible, focus stays on the heading, and the message directly above the card stays in place. The regular input remains hidden. Press **Space** to expand and verify that focus, the preceding message, **Full review**, and `Keep the existing sections` are preserved. The Network panel should show no new `/codex-api/` requests from either toggle.
5. In **Settings → General**, cycle **Appearance** to **Dark** and close Settings. Verify the same draft, dark surfaces, readable light text, and visible focus indicators on the heading, choice control, free-text field, and **Send**. Repeat the toggle checks at **768 × 1024** and **375 × 812** in both themes.
6. Press **Enter** once with focus on **Send**. The card closes and the terminal prints one reply for request `200` containing both answers. The fixture then shows an approval for `echo approved` in the footer. Select **Yes for Session** and **Send**. Verify that the regular composer returns and the terminal prints one `acceptForSession` reply for request `201`.

#### Jump to question

1. Open a fresh fixture. Verify that **Fixture answer** stays at the bottom of the conversation and **Jump to question** appears while **Awaiting response** is above the viewport. Open the Network panel and filter for `/codex-api/`.
2. Scroll into the later history while keeping **Awaiting response** offscreen. Verify that **Jump to question** and the down-arrow **Jump to latest** appear side by side. Click **Jump to question**. The conversation pane scrolls to **Awaiting response**, the heading gets focus, the card stays expanded, and the question jump button disappears. The Network panel should show zero new API requests. Scroll the heading offscreen again, focus the question jump button with **Tab**, and repeat with **Enter**.
3. Repeat with `LONG_QUESTION=1 node` in the fixture command. Jump to the question, type a draft in **Other answer**, then scroll until **Send** is visible and the heading is above the viewport. Verify that **Jump to question** is available. Activate it, minimize the card via **Enter** on the focused heading, and use **Jump to latest** to move away. Jump back and verify that the card is still minimized. Reopen it and check the draft. None of the jumps should make API requests.
4. Scroll until **Send** is visible and the heading is offscreen again. Submit the response. Verify the card and **Jump to question** disappear and the Network panel shows one response submission. Close the fixture to clear its state. Repeat at **1280 × 900**, **768 × 1024**, and **375 × 812** in both light and dark themes. Check that the jump controls fit side by side and their text, icon, and keyboard focus indicators are visible.

#### Jump to question while earlier history loads

1. Start a fresh fixture by replacing `node` in the setup command with `HISTORY_DELAY_MS=30000 node`. Open the Network panel and filter for `/codex-api/`. Verify **Awaiting response** initially sits below **Fixture answer**. Optionally enter a draft in **Other answer** and minimize the card.
2. Scroll to the top to start loading earlier messages. The terminal prints when the delayed response is scheduled. While **Loading…** is shown, activate **Jump to question** and verify that **Awaiting response** immediately becomes visible and focused.
3. Wait for the history response. Verify that the card moves directly after “The plan depends on the documentation scope.” and before **Earlier message 1**. The entire heading remains visible and has keyboard focus. Check that its expanded or minimized state is preserved, and reopen it to verify any draft. The Network panel should show one history request for the original scroll and zero from the jump or restoration.
4. Start a fresh delayed fixture for each variation. After the initial jump, use **Jump to latest**, use **Tab** to focus a different control, or scroll away without moving focus. When history arrives, the card still moves after its turn. The conversation stays at the latest output or the new reading position, and any newly focused control retains focus if it remains present. Close each fixture after verifying the result.

#### Automated fixture

Run `node scripts/test-plan-mode-question-panel.cjs` against the same development server. It checks question placement, draft retention, keyboard toggles, reopening, approval and MCP input in the footer, and the jump flows above. The keyboard jump and history restoration both land inside the history pagination threshold and verify zero additional API requests. It saves screenshots of the jump controls, expanded and minimized cards, and the restored heading for each theme and viewport under `output/playwright/`.

#### Cleanup

Close the fixture browser. Its theme preference and response are isolated from your regular browser session.

#### Answer history

1. With a Codex App Server connected, open a persisted thread and prompt in Plan mode for multiple questions with choices, free text and a private field. Tab through the question, enter a choice, visible free text and private text. Submit once while clicking Send twice. Confirm a single WebSocket reply to Codex and one user-style bubble after the item preceding the question. Check each heading, answer order, **Answer hidden**, Sent time and **Copy answers**. Paste the copied content into a scratch editor and search for the private value. The bubble has no Fork or Revert controls. Repeat in light and dark at desktop and mobile widths.
2. Reload, open a fresh browser on the same WebUI profile and restart the WebUI backend while keeping Codex running. Check the same ID, placement, time and redacted content. Load an older page containing a saved answer. Disconnect its browser stream, submit a different old-turn response in another browser, then reconnect. Inspect the ordinary history response for records from the current page and the retained older turns only. Compare native page counts with an empty history response.
3. Stop the App Server connection just after Send, or fixture a missing native resolution. The pending draft remains available with an error and no automatic retry. Simulate WebUI data-directory write failure after a valid native closure. The bubble appears with the same redaction and the submitting browser warns that history saving failed.
4. Archive and reopen the thread, then compare the same thread ID on another profile. The archive keeps the saved bubble, and the other profile has its own records. Native and Portable Fork retain eligible prompt and assistant behavior, with saved answers displayed only in the source. Revert through an answered turn and confirm its bubble disappears. Use the protocol fixture to observe confirmed native permanent deletion and check that the stored answers disappear.
5. Close fixture browsers, remove temporary fixture profile data, and unarchive any live thread used for the check if needed.
