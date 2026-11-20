### Plan Mode question panel in light and dark themes

#### Prerequisites and setup

Start the frontend with `pnpm run dev --host 127.0.0.1 --port 4173`. With Playwright Chromium installed, run the following from the repository root to open an isolated browser with the development fixture and inject a pending Plan Mode question.

```bash
node <<'NODE'
const { chromium } = require('playwright')
const { setup } = require('./scripts/approved-fixture.cjs')

async function main() {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const { emit } = await setup(page, (body, _page, url) => {
      if (!url.pathname.endsWith('/server-requests/respond')) return
      console.log('Question reply', JSON.stringify(body))
      return { json: { ok: true } }
    }, false)

    await page.getByRole('button', { name: 'Add attachments and settings' }).click()
    await page.getByRole('switch', { name: 'Enable plan mode' }).click()
    await page.keyboard.press('Escape')
    emit('server/request', {
      id: 200,
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'approved-fixture',
        turnId: 'live',
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

1. Open **Settings → General** and cycle **Appearance** to **Light**, then close Settings. Check that the panel and question card have light surfaces and the main prompt, labels, and option description have readable dark text. Check the **Other answer** placeholder and the **Send** label.
2. Use **Tab** to reach the choice field and **Enter** to open it. Check the light menu surface, option labels, selected row, and focus outline as you tab through the options. Press **Enter** on **Full review** and verify that its description appears.
3. Tab to **Other answer** and then **Send**. Both controls show a visible focus outline. Return to **Other answer** and type `Keep the existing sections` without submitting.
4. In **Settings → General**, cycle **Appearance** to **Dark** and close Settings. The same question, selected **Full review** option, option description, and partial response are still present. Reopen the menu and check the dark surfaces, light text, selected row, and keyboard focus. Check the focus outline on the free-text field and **Send**.
5. Switch back to **Light** and verify that both answers are still present. Press **Enter** once with focus on **Send**. The panel closes and the fixture terminal prints exactly one `Question reply` for request `200` containing both `Full review` and `Keep the existing sections`.

#### Cleanup

Close the fixture browser. Its theme preference and response are isolated from your regular browser session.
