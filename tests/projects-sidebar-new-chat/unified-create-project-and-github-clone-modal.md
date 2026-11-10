### Feature: Unified create project and GitHub clone modal

Prerequisites/setup:
- Run the app with access to `git` and network access to `github.com`.
- Have a small public GitHub repository URL available for testing.

Steps:
1. Open the app in light theme and navigate to the new chat screen.
2. Confirm the folder actions show `Select folder` and `Create Project`.
3. Click `Create Project` and confirm a modal opens with `New project` and `Clone from GitHub` modes.
4. In `New project`, keep or edit the destination folder, enter a single folder name, and submit.
5. Confirm the created project folder is selected in the new chat folder selector and appears as a project root.
6. Reopen the modal, switch to `Clone from GitHub`, paste a valid `https://github.com/<owner>/<repo>` URL, and submit.
7. Confirm the cloned repository folder is selected in the new chat folder selector and appears as a project root.
8. Switch the app to dark theme and repeat opening the modal.
9. Confirm the modal, tabs, inputs, error message, and buttons have readable contrast and stable spacing.

Expected results:
- New project creation and GitHub cloning share one modal and destination folder field.
- Created and cloned folders are registered as project roots and selected for the new chat.
- After cloning, the folder selector immediately includes the cloned project without a full page refresh.
- Invalid project names or non-GitHub URLs show an inline modal error without changing the selected folder.
- A stalled clone eventually fails with an error instead of keeping the request open indefinitely.
- Light and dark themes render the unified modal consistently with the existing new-chat controls.

Rollback/cleanup:
- Remove the created project folder from the filesystem if it was only used for testing.
- Remove the cloned repository folder from the filesystem if it was only used for testing.
- Remove the test projects from the app project list if they are no longer needed.

### Phase 9-A: ProjectSetupModal presentation extraction

Prerequisites/setup:
- Start the app and open the new chat screen. Use a disposable destination for actual creation/cloning.
- Check desktop (1440x900), phone (375x812), and tablet (768x1024), in light and dark themes.

Actions:
1. Click `Create Project`; confirm the project name input receives focus and the suggested name is present.
2. Edit destination and project name, switch to clone mode, enter a repository URL, and switch back. Confirm drafts survive mode changes.
3. Press Enter in the primary input; confirm the existing validation/submission runs once. While submitting, confirm inputs, tabs and buttons are disabled and Escape/backdrop clicks do not dismiss the modal.
4. After submission finishes, reopen and check Cancel, Escape, and clicking the backdrop each close the modal.
5. Check inline errors, tab selection, scrollability, and button/input contrast at each viewport/theme. Open `Select folder` as well to check the shared dialog styles.

Expected results:
- The extracted component emits field updates and close/submit requests; App.vue retains all drafts, validation, filesystem/API operations, and submission guards.
- Opening still focuses the primary input after the parent nextTick. Text input retains Vue v-model composition handling.
- The modal retains its existing layout, keyboard interactions, translations, and light/dark styling. Shared styles occur once in src/style.css.
- No new watcher, subscription, network call, or routing behavior is introduced.

Rollback/cleanup:
- Close the modal. Remove only disposable projects created for this check and their project-list entries.

### Phase 9-A: FolderPickerModal presentation extraction

Prerequisites/setup:
- Open the new chat screen with a disposable folder tree containing a child directory and a hidden directory.
- Check 1440x900, 375x812, and 768x1024 in light and dark themes.

Actions:
1. Click `Select folder`; confirm loading disables browsing/selection, then the current path receives focus.
2. Click a child directory and `..`; edit the current path and press Enter or Browse. Toggle hidden folders and filter the list.
3. Enter an unmatched filter in a directory without a parent entry, then browse an empty directory. Confirm the appropriate empty messages.
4. Browse an invalid path, check the inline error and Retry, then browse a valid path to recover.
5. Click `New folder`; confirm the name input receives focus. Enter a valid disposable name and press Enter; confirm the created directory becomes the current path. Repeat with an invalid name to check validation.
6. Confirm using the current-path Select button and a directory-row Select button separately; confirm the chosen path appears on the new chat screen.
7. Reopen and dismiss separately using Cancel, backdrop, and Escape from path, filter, and create inputs. Preserve the existing bubbling behavior: Escape in the create input closes the picker as well as its create panel.
8. At each viewport/theme, check the actual dialog surface, inputs, list, scrolling, and buttons for readable contrast and containment.

Expected results:
- App.vue owns all drafts, filtering, directory APIs, creation/opening, request IDs, and project updates. The component only renders props and emits edits/actions.
- Focus still runs after the parent's nextTick. No new watchers, subscriptions, or requests are added.
- Loading/error/empty states and selection/cancellation behavior remain unchanged; ProjectSetupModal still opens and retains shared styles.

Rollback/cleanup:
- Close the picker, remove only disposable directories created during testing, and remove test project entries. Mock-backed browser checks do not verify real filesystem creation or opening.
