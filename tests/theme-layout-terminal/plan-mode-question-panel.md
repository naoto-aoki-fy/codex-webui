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
    const { emit } = await setup(page, (body, _page, url) => {
      if (url.pathname.endsWith('/server-requests/respond')) {
        console.log('Request reply', JSON.stringify(body))
        if (body.id === 200) {
          setTimeout(() => emit('server/request', {
            id: 201,
            method: 'item/commandExecution/requestApproval',
            params: { threadId: thread.id, turnId: 'latest', command: 'echo approved' },
          }), 500)
        }
        return { json: { ok: true } }
      }
      if (body.method === 'thread/resume' || body.method === 'thread/read') {
        const turns = [
          history('earlier', 'Earlier message'),
          {
            id: 'question-turn', status: 'completed',
            items: [
              { type: 'userMessage', id: 'prompt', content: [{ type: 'text', text: 'Prepare a documentation plan.' }] },
              { type: 'agentMessage', id: 'before-question', text: 'The plan depends on the documentation scope.' },
            ],
          },
          history('later', 'Later message'),
          { id: 'latest', status: 'completed', items: [{ type: 'agentMessage', id: 'answer', text: 'Fixture answer' }] },
        ]
        return { json: { result: { thread: { ...thread, turns }, model: 'fixture-model', modelProvider: 'fixture' } } }
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

#### Automated fixture

Run `node scripts/test-plan-mode-question-panel.cjs` against the same development server. It checks question placement, draft retention, keyboard toggles, reopening, approval and MCP input in the footer, and the jump flows above. The keyboard jump also lands inside the history pagination threshold and verifies zero API requests. It saves screenshots of the two jump controls and of the expanded and minimized card for each theme and viewport under `output/playwright/`.

#### Cleanup

Close the fixture browser. Its theme preference and response are isolated from your regular browser session.
