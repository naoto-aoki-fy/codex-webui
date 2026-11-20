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

Run `node scripts/test-plan-mode-question-panel.cjs` against the same development server. It checks question placement, draft retention, keyboard toggles, reopening, approval and MCP input in the footer, and the jump flows above. The keyboard jump and history restoration both land inside the history pagination threshold and verify zero additional API requests. The fixture also checks that native closure changes the heading to **Awaiting confirmation…**, makes the fields read-only, clears the pending sidebar indicator, and restores **Stop**. Click **Stop** to send one interrupt for that turn. Send an ordinary prompt while the closed draft is visible and verify that it starts a new turn. Dismiss the retained draft. The fixture saves screenshots for each theme and viewport under `output/playwright/`.

With a fresh pending question in the fixture, change the choice and type into **Other answer**. Return the choice to its default and clear the text. Simulate native closure or reconnect with an empty pending list. The card disappears. Repeat with edited text still present and check that **Unsent draft** appears. Collapse the card and select **Dismiss draft**. The card disappears without an API request. Finally, submit a reply and dismiss the collapsed card after native closure, while **Awaiting confirmation…** is visible. A successful reply through the original HTTP request still shows one redacted history entry. A failed reply leaves the card gone. Close the fixture browser to clear its drafts.

#### Cleanup

Close the fixture browser. Its theme preference and response are isolated from your regular browser session.

#### Answer history

1. With a Codex App Server connected, open a persisted thread and prompt in Plan mode for multiple questions with choices, free text and a private field. Tab through the question, enter a choice, visible free text and private text. Submit once while clicking Send twice. Confirm a single WebSocket reply to Codex and one user-style bubble after the item preceding the question. Check each heading, answer order, **Answer hidden**, Sent time and **Copy answers**. Paste the copied content into a scratch editor and search for the private value. The bubble has no Fork or Revert controls. Repeat in light and dark at desktop and mobile widths.
2. Reload, open a fresh browser on the same WebUI profile and restart the WebUI backend while keeping Codex running. Check the same ID, placement, time and redacted content. Load an older page containing a saved answer. Disconnect its browser stream, submit a different old-turn response in another browser, then reconnect. Inspect the ordinary history response for records from the current page and the retained older turns only. Compare native page counts with an empty history response.
3. Stop the App Server connection just after Send, or fixture a native closure followed by turn completion with no matching tool result. The draft remains available with an error and no automatic retry. Simulate WebUI data-directory write failure after a matching native tool result. The bubble appears with the same redaction and the submitting browser warns that history saving failed.
4. Archive and reopen the thread, then compare the same thread ID on another profile. The archive keeps the saved bubble, and the other profile has its own records. Native and Portable Fork retain eligible prompt and assistant behavior, with saved answers displayed only in the source. Revert through an answered turn and confirm its bubble disappears. Use the protocol fixture to observe confirmed native permanent deletion and check that the stored answers disappear.
5. Close fixture browsers, remove temporary fixture profile data, and unarchive any live thread used for the check if needed.

#### Delivery confirmation and in-session drafts

1. Run the question panel browser fixture in light and dark at 1280×900,
   768×1024 and 375×812. Choose **Full review** and enter text in the private
   field. Submit, let an approval replace the panel, switch threads and release
   the failed reply. Return and resolve the approval. The original choice and
   masked text return. The error reports unconfirmed delivery, no answer bubble
   appears, and the browser sends one reply.
2. Simulate App Server disconnect and reconnect in the same tab. Verify the
   unconfirmed form still has both values. Inspect local and session storage for
   the test value. Dismiss the draft and confirm the panel disappears. Reloading
   the page starts a new in-memory draft.
3. Build the app and run the TCP and Unix external App Server protocol fixtures.
   With raw result events, expect an empty history after native closure and a
   saved answer as soon as the exact result arrives. On the default stream,
   expect confirmation only after successful turn completion and one fresh
   rollout transfer. The fixture waits past the original send deadline and
   fills the metadata queue before completing the turn. Expect one native
   reply, one rollout transfer ahead of waiting metadata reads and one
   redacted answer even if completion repeats. Mismatches, cancellation,
   connection loss and a missing closure before the send deadline save
   nothing. Check that browser events, caches and backend output contain no
   private value.
4. When the bridge certifies that the socket did not send the frame and the
   request remains pending, use **Retry** once and look for confirmation before a
   bubble appears. Repeat with a fresh request and choose **Dismiss draft**.
   Expect the default choice, empty text and no error. Refresh pending requests
   and verify the same question remains open. Submit the fresh form and confirm
   the discarded text was never sent again. Dismiss a closed draft and verify the
   panel disappears. Simulate a confirmed reply with a failed history write and
   check the visible redacted bubble and save warning.
5. With the bridge fixture, submit an answer and emit native request closure.
   Before turn completion, unsubscribe or archive the thread, or emit native
   thread closure. Expect the reply to settle as unconfirmed with one native
   send and no saved answer. Repeat after a successful terminal event while
   verification is in progress. Expect verification to keep its deadline.
6. With the rollout fixture, append a follow-up turn during the first file read.
   Expect a single retry and a redacted answer after a stable match. Append
   again during the retry to verify that the reply remains unconfirmed. Check
   the RPC trace for one extra file read and stat, with no extra history page.
7. Close the fixture browser and stop only the temporary App Server fixture.

For live acceptance, connect to an independently managed and signed-in Codex
0.170.0 App Server. Start a disposable thread in WebUI and send a Plan prompt
that asks Codex to use `request_user_input`. Answer the question and wait for
successful turn completion. Verify one saved answer, masked private values,
and one native reply with the default event settings. Reload the thread to
resume it, check the saved bubble, and answer a second Plan question. Interrupt
a third turn with **Stop** after Codex closes the question and while the card
shows **Awaiting confirmation…**. Verify the interrupted turn has no saved
answer, then dismiss its closed draft.
Archive the disposable thread and preserve the independent App Server process.
