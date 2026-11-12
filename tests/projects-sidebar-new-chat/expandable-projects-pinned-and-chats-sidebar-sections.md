### Expandable Projects, Pinned, and Chats sidebar sections

#### Feature/Change Name
The sidebar labels the grouped thread area as `Projects`, makes `Projects`, `Pinned`, and `Chats` independently expandable, and places `Chats` after `Projects` in the same scrollable sidebar area.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. At least one existing thread is available in the sidebar
3. At least one pinned thread exists to verify the `Pinned` section
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open the app with the sidebar expanded
2. Verify the grouped thread header reads `Projects` instead of `Threads`
3. Verify `Pinned`, `Projects`, and `Chats` each show a chevron when present
4. Collapse and expand `Pinned`, confirming pinned rows hide and return
5. Collapse and expand `Projects`, confirming project groups hide and return
6. Confirm `Chats` appears after `Projects` and scrolls with the same sidebar content, not as a fixed bottom shelf
7. Collapse and expand `Chats`, confirming recent chat rows hide and return
8. Click the `Chats` filter icon and verify the existing sidebar search field opens and the filter button shows active state
9. Click the `Chats` compose icon and verify the app navigates to the new-chat/home composer
10. Open the Projects organize menu, enable `Chats first`, and verify `Chats` moves above `Projects`
11. In the same menu, switch `Sort by` between `Created` and `Updated`, then verify the active checkmark moves and the chat rows reorder by the selected timestamp
12. Refresh the page and verify `Chats first` and the selected sort mode persist
13. Switch to dark theme and repeat the visibility checks for section headers, chevrons, active filter state, sort menu state, and row text

#### Expected Results
- The sidebar uses `Projects` for the grouped project/thread area
- `Pinned`, `Projects`, and `Chats` expansion state changes immediately and persists across reload
- `Chats` is appended after `Projects` in the same scroll space
- `Chats first` moves the `Chats` section before `Projects` and persists across reload
- `Created` and `Updated` sort options update only the `Chats` ordering and persist across reload
- The filter icon toggles the sidebar search without losing the `Chats` section
- The compose icon starts a new chat using the existing new-thread flow
- Light theme and dark theme both keep section headers, controls, and rows readable

#### Rollback/Cleanup
- Clear the sidebar search query if the filter step left it open

---

### Active chat project title

#### Prerequisites/Setup
- Use grouped Projects view with chats in two projects, including a pinned chat.

#### Steps
1. Open a chat in the first project and inspect its project title.
2. Collapse that project, then open its pinned chat from Pinned.
3. Switch to a chat in the second project.
4. Search for another chat in the active project so the selected chat is filtered out.
5. Clear search and navigate to the new-chat screen.
6. Repeat in light and dark themes.

#### Expected Results
- Only the open chat's project title is bold (weight 700); other titles use normal weight.
- Collapsing, pinning, and filtering do not change which project is active.
- Switching chats updates the bold title immediately. No project is bold when no chat is selected.
- Text remains readable in both themes.

#### Rollback/Cleanup
- Clear search and restore the preferred theme and project expansion state.
