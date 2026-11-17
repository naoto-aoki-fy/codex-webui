### Feature: Empty project new thread action

#### Prerequisites
- App server is running from this repository.
- At least one workspace root is registered that has no threads.
- Light and dark themes are both available from Settings.

#### Steps
1. Open the app in light theme.
2. Find the empty project row in the sidebar that shows `No threads`.
3. Click that project's new thread icon.
4. Confirm the home composer opens and the folder dropdown is set to the empty project's workspace root.
5. Switch to dark theme and repeat steps 2-4.

#### Expected Results
- The new thread icon works for projects with zero threads.
- The new thread screen uses the clicked project's registered workspace root instead of leaving the folder blank or reusing another project.
- Light and dark theme sidebar and composer surfaces remain readable.

#### Rollback/Cleanup
- No cleanup is required unless a test message is sent; delete that test thread if created.

### Feature: Open project in a new tab

#### Prerequisites
- Register an empty project with a workspace root containing spaces, such as `/work/Empty project`.
- Also have a project with threads and a project that is not eligible for removal.
- Select an existing thread and note the current URL.

#### Steps
1. Right-click the empty project's header and choose `Open in new tab`.
2. Confirm the new tab opens the home composer with that project and its workspace root selected; inspect `projectId` and `cwd` in the URL.
3. Reload the new tab and confirm its project/directory selection is restored.
4. Return to the original tab; confirm its URL and selected thread are unchanged and the project menu is closed.
5. Repeat using the project's three-dot menu, then repeat with a project that has threads and one that cannot be removed.
6. Confirm `Remove` appears only for eligible projects, and still removes an eligible project.
7. Repeat in light and dark themes and compare the menu with the thread menu.

#### Expected Results
- Both entry points expose the same `Open in new tab` action for every project, including empty and non-removable projects.
- The destination preserves the exact project ID and directory, including spaces, using the same resolution as the existing new-thread button.
- The current tab retains its selected thread and page, and dismisses the menu.
- Menu styling remains consistent in both themes; removal eligibility is unchanged.

#### Rollback/Cleanup
- Close test tabs and remove any temporary registered project. No thread needs to be created.
