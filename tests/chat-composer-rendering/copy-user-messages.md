### Copy individual user messages

#### Prerequisites/Setup
Open a thread with multiple user messages, including an editable message, a message without a turn ID, multiline Markdown with a code block, and a message with file and image attachments. Allow clipboard access.

#### Steps
1. In light and dark themes, copy each message and paste into a plain-text editor. Check desktop and touch/mobile layouts.
2. Check that `Copied` appears only on the clicked message and returns to `Copy` after about 1.8 seconds. Copy another message before the timer expires.
3. Use `Revert` on an eligible message, then separately copy an assistant response.
4. Open an ordinary HTTP LAN origin (not localhost/loopback) where the Clipboard API is unavailable and copy both a user message and an assistant response. Repeat with a rejected native write and a working selection fallback. Then make the fallback fail too and retry; count fallback attempts in the isolated context.
5. Focus the toolbar with the keyboard and navigate away after a successful copy.

#### Expected Results
- Every user message has a visible or discoverable Copy action, including messages that cannot be edited. Keyboard focus and touch expose the toolbar in both themes.
- The pasted text contains only the selected message's original text, including whitespace, Markdown and code blocks. File and image paths follow the existing `Files:` and `Images:` formatting.
- Successful copies show temporary feedback only after the shared helper succeeds; failed copies do not retry the fallback or schedule success feedback. Revert and assistant copy continue to work independently, and navigating away causes no timer errors.

#### Rollback/Cleanup
Restore clipboard permissions and any overridden browser functions; discard pasted content and delete any test thread created for this check.

#### Automated Coverage and Performance
`src/components/content/conversationActions.test.ts` checks exact assistant text,
feedback after helper resolution, failure without a second fallback attempt, empty
content and stale-thread feedback. `src/utils/clipboard.test.ts` checks the actual
native/fallback paths. Code-path audit: the response action removes a redundant
second selection attempt after helper failure; serialization and success timers
remain unchanged. No API requests, blocking preparation, listeners, fanout, payload
or cache changes are introduced. Live browser timing was not measured.
