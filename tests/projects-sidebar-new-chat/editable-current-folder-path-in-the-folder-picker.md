### Editable current folder path in the folder picker

#### Feature/Change Name
The `Select folder` dialog now lets the user edit the current folder path directly, browse that folder on `Enter` or `Browse`, and select the typed path without first clicking a child row.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open the home/new-thread route
3. Have at least two accessible local directories available for navigation
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the `Select folder` dialog from the new-thread folder chooser
2. Confirm the `Current folder` field is an editable text input instead of static text
3. Type a different absolute path and press `Enter`
4. Confirm the folder list reloads for the typed path
5. Edit the path again, click outside the input, and confirm the listing does not reload on blur
6. Type a valid absolute path and click `Select`
7. Reopen the dialog, enter a path, and click `Browse`; confirm only the listing changes. Press `Enter` again on the same path and confirm the dialog stays open. Click a child row to browse, then use its `Select` button to select it
8. Reopen the dialog, switch to dark theme, and confirm the editable current-folder input remains readable and focusable

#### Expected Results
- The current-folder path can be typed into directly
- Pressing `Enter` or clicking `Browse` reloads the folder listing for that path
- Blurring a changed path does not reload the listing or select a folder
- Clicking `Select` uses the typed path when it is valid
- The input remains readable and has visible focus treatment in both light theme and dark theme

#### Rollback/Cleanup
- Return the chooser to the original folder if the test changed the selected project path

---

### Folder picker composable regression

Prerequisites: run the current dev server on `127.0.0.1:4173`; use disposable folders with a child and a hidden child. Repeat at 1440x1000, 375x812, and 768x1024 in light and dark themes.

1. Open Select folder. Expect one listing request and focus in Current folder after loading.
2. Browse a child and retry a typed path. Toggle Show hidden folders rapidly with network throttling. Expect only the latest listing/error and loading state to apply; each toggle requests once.
3. Filter by a mixed-case name and an absent name. Expect matching children (and the parent entry where available), or the empty-filter message at the filesystem root; filtering makes no requests.
4. Confirm New folder is absent. Browse an existing child instead; selection must never create directories.
5. Try a forbidden or missing directory. Expect an error with no registration or directory creation. Retry an accessible path to recover.
6. Close with Escape, Cancel, and the backdrop during pending listings. Reopen. Expect no late response or focus to overwrite the new session.
7. Select a child row or typed existing folder. Expect existing project registration, selected cwd update, workspace refresh, and dialog dismissal. Cancel instead and expect no registration.

Automation: `pnpm exec vitest run src/composables/useFolderPicker.test.ts` tests mocked gateway responses. `node scripts/test-folder-picker.cjs` checks the real App/modal at all six viewport/theme combinations, with mocked directory listings, project registration, and workspace state. Startup reads use the dev server. Neither suite proves operating-system permission behavior.

Cleanup: remove only disposable test folders and restore the original selected project. Browser automation does not write projects or directories to disk. Screenshots are saved under `output/playwright/folder-picker-*.png`.
