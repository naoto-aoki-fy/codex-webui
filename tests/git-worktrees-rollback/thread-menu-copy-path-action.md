### Thread menu copy path action

#### Feature/Change Name
The thread overflow menu includes a `Copy path` item that copies the selected thread's working directory path.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. Open any existing thread with a known project path
3. A browser that permits native clipboard writes or selection-based copying; use an isolated context for failure checks
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, hover a thread row in the sidebar and open its overflow menu
2. Verify `Copy path` appears after `Open in new tab`
3. Click `Copy path`
4. Paste the clipboard contents into a text field or clipboard inspector
5. Reopen the same menu in dark theme and verify the item remains readable and in the same position
6. Access the WebUI through an ordinary HTTP LAN origin (for example `http://<LAN-IP>:4173`, not localhost or a loopback address). Confirm `window.isSecureContext` is false and `navigator.clipboard` is unavailable, then repeat Copy path and paste into an editor.
7. In an isolated context, make native `writeText` reject, allow `document.execCommand('copy')`, and repeat. Then make the fallback return false or throw and retry.
8. Try a thread with no working directory. Confirm the menu closes without a copy attempt.

#### Expected Results
- The menu order is `Open in new tab`, `Copy path`, `Copy chat`, `Fork conversation`, `Pin thread` or `Unpin thread`, `Rename thread`, `Delete thread`
- Clicking `Copy path` closes the menu
- Clipboard contents equal the thread's `cwd` path with the existing outer-whitespace trimming preserved; internal spaces and Unicode remain intact
- Native writes remain preferred; unavailable or rejected native writes reach the shared selection fallback
- Copy path remains best-effort with no success indicator; failure of both methods produces no false success or unhandled rejection. Browser policy may block selection copying on HTTP too
- Light theme and dark theme both keep the menu item readable

#### Rollback/Cleanup
- Restore any previous clipboard contents manually if needed
- Restore overridden browser functions/permissions or close the isolated context

#### Automated Coverage and Performance
- `src/components/sidebar/sidebarMenus.test.ts`: immediate fallback without the Clipboard API, native writes, menu closure and empty/missing paths.
- `src/utils/clipboard.test.ts`: native preference, unavailable/rejected writes, exact text/selection, fallback failure and cleanup.
- Code-path audit: no requests, timers, listeners, cache changes or asynchronous preparation added. Native success allocates no textarea; fallback creates/removes one textarea per attempt. Live LAN/browser timing is not measured by these unit tests.

---
