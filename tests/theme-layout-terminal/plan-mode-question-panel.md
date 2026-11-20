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
    emit('server/request', {
      id: 200,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'approved-fixture',
        turnId: 'question-turn',
        questions: [{
          id: 'scope',
          header: 'Documentation scope',
          question: 'Which scope should the plan use?',
          isOther: true,
          options: [
            { label: 'Quick update', description: 'Update the setup notes.' },
            { label: 'Full review', description: 'Review the whole guide.' },
          ],
        }],
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

#### Automated fixture

Run `node scripts/test-plan-mode-question-panel.cjs` against the same development server. It checks placement when the turn has no visible rows, draft retention as a streamed row moves the card, the default expanded state after reopening, both keyboard toggles, API request counts, and approval and MCP input in the footer. It saves expanded and minimized screenshots for each theme and viewport under `output/playwright/`.

#### Cleanup

Close the fixture browser. Its theme preference and response are isolated from your regular browser session.
