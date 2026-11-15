### Thread menu copy chat action

#### Feature/Change Name
The thread overflow menu includes a `Copy chat` item that copies the selected chat as Markdown instead of downloading an export file.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. Open any existing thread with at least one visible message
3. Browser clipboard access is available
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, hover the selected thread row in the sidebar and open its overflow menu
2. Verify `Copy chat` appears after `Copy path`
3. Click `Copy chat`
4. Paste the clipboard contents into a text field or clipboard inspector
5. Open a different, non-selected thread row menu and verify `Copy chat` is disabled
6. Reopen the selected thread menu in dark theme and verify the item remains readable and in the same position

#### Expected Results
- The menu closes after clicking `Copy chat`
- No Markdown file is downloaded
- Clipboard contents start with the thread title as a Markdown heading and include `Thread ID:`
- The copied body includes the visible chat messages in Markdown
- `Copy chat` is disabled for non-selected threads so clipboard writes keep the original click activation
- Light theme and dark theme both keep the menu item readable

#### Rollback/Cleanup
- Restore any previous clipboard contents manually if needed

---

## Complete conversation Markdown download (11, CAP-002/003)

Setup: fixture with >10 native turns, a persisted Portable Fork prefix, historical
model/effort/timestamps, Markdown/code, attachments, and controllable page errors.

1. Open the selected thread's sidebar menu → **Export conversation as Markdown**.
2. Verify older pages are requested serially only now; the downloaded `.md` has all
   completed turns chronologically and imported history exactly once before them.
3. Inspect roles, Markdown/code blocks, attachment references and reliable historical
   metadata. Change composer model/effort: exported history must not change.
4. With missing metadata, verify no model/time/effort is invented. Raw internal
   payloads are omitted. Local image URLs remain references, not embedded files.
5. During generation export: the turn active in the initial read, including its
   user input, is excluded and the file/status explicitly says so.
6. Double-click export: one job/download. Deny an older page or disconnect: clear
   failure, no partial download. A looping cursor fails instead of hanging.
7. Confirm **Copy chat** still copies the loaded view. Check the actual export
   menu and status in both themes at desktop, 375×812 and 768×1024.

Cleanup: delete downloaded fixture files. Export does not mutate native history.
Performance: no eager history reads; one initial normal detail read and one bounded
10-turn page per iteration. A 1,000-page / 33,554,432-code-unit text safety ceiling fails rather
than truncates. No new event listeners. Live large-history latency was not measured.
