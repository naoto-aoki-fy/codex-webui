# New-thread composer requires a folder

## Setup

Start the app with an external app-server available. Have a registered folder and
an existing thread. Open the home route without a `cwd` query parameter.

## Actions and expected results

1. Confirm the composer remains visible and dimmed. Its textarea, Send,
   attachments, model menus, and other controls must not accept focus or input.
   Try Tab, Enter, paste, and dropping a file: no message or attachment is added.
   The container exposes `aria-disabled="true"` and is inert.
2. Open the folder picker and cancel. Repeat with a failed folder open (an invalid
   path). The composer stays disabled; folder controls remain usable.
3. Choose a registered folder from the dropdown. The composer immediately enables.
   Type a draft and inspect attachment/configuration controls.
4. Return to home without a folder, then select a valid folder through the picker.
   The composer immediately enables after successful selection.
5. Refresh with `?cwd=<encoded-folder>` in the hash route. The folder and enabled
   composer persist. Use Back/Forward between home entries with and without a
   folder; the composer follows the restored folder. A whitespace-only folder
   keeps it disabled.
6. Open an existing conversation. Its composer remains usable as before.
7. Repeat in light and dark themes at desktop, 375x812, and 768x1024 sizes.
   Disabled styling must remain subtle and the folder controls must remain visible
   and usable.

## Cleanup

Discard any draft and close the picker. No message submission is necessary.

## Verification evidence

- Typecheck, production build, and unit suite passed (80 files, 1,205 tests).
- Chromium checks passed for initial disabled state, blocked focus, synthetic paste
  and drop, dropdown and picker selection, picker cancellation, simulated HTTP 500
  folder-open failure, URL restoration, refresh, back navigation, and typing in an
  existing conversation. No messages were submitted.
- Home screenshots: `output/playwright/composer-{light,dark}-{1280,375,768}.png`,
  at 1280x900, 375x812, and 768x1024 respectively.
- Home runtime profile: 227.3 KB API traffic, no warnings, one first-page thread
  list, one skills list, one rate-limit read, and no thread resume/read requests.
  The largest API response was thread/list (147.1 KB, 699.2 ms). The guard performs
  only synchronous string checks and DOM bindings; it adds no network requests,
  blocking I/O, fanout, payloads, watchers, or cache invalidation.
- Screen-reader announcements, physical mobile devices, and actual message
  submission were not exercised. Paste/drop checks used synthetic events.
