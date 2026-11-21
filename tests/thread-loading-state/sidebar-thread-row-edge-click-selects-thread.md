### Sidebar thread row edge click selects thread

#### Feature/Change Name
The thread link covers the full highlighted row, including the timestamp and both padded edges. Delete and the three-dot menu have separate controls.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar contains multiple threads
3. At least one thread has visible time text on the right

#### Steps
1. Hover a thread row and confirm the row highlight appears
2. Click near the left edge, clear of the delete icon
3. Click near the right edge/time area (outside the menu button)
4. Click the thread title/body area
5. Click Delete once and open the three-dot menu to verify their behavior

#### Expected Results
- Steps 2, 3, and 4 all select/open the clicked thread
- Hover highlight and click target area now match user expectations
- Delete shows inline confirmation without selecting the thread
- The three-dot menu opens without selecting the thread and includes the pin action

#### Rollback/Cleanup
- None

---

### Shared thread row presentation regression

#### Prerequisites/Setup
- Run the current frontend with multiple project threads and projectless chats.
- Include pinned, unread, working, worktree, and awaiting approval/response threads.
- Record API requests in browser developer tools before interacting.

#### Exact Actions
1. In both light and dark themes, inspect pinned, project, chronological (Organize > Chronological list), and Chats rows.
2. Select rows through their title, empty edge, and timestamp. Tab to the title and activate with Enter and Space.
3. Tab to delete and menu controls. Confirm there is a visible focus outline on each control. At 375×812, also tap each action and verify that it works independently of the row link.
4. Open the three-dot menu; rename a thread, dismiss with Escape, and pin/unpin it. Verify menus anchor to the correct row after moving between lists.
5. Click inline delete once, then select another row to cancel confirmation. Do not confirm deletion unless using a disposable thread.
6. Resize the sidebar and verify long titles truncate while timestamps, worktree icons, and request chips retain their layout.

#### Expected Results
- All four placements share identical row presentation and preserve active state, labels, indicators, keyboard focus, and light/dark colors.
- Each title/edge activation selects once; menu and delete controls do not select through event bubbling.
- Rename, pin/unpin, menu dismissal, and confirmation retain existing behavior.
- Selection and menu interactions issue the same requests as before; rendering rows adds no API traffic.

#### Rollback/Cleanup
- Restore original titles, pin state, ordering mode, and theme. Remove any disposable test threads.

### Feature: Full thread title on hover

#### Prerequisites
- Have a short-titled thread and a thread whose title is truncated by the sidebar width.
- Pin one thread and leave another unpinned; enable both light and dark themes for verification.

#### Steps
1. Hover each thread row in the pinned section and project groups, including the title and empty row area.
2. Confirm the native tooltip text equals the full displayed thread title, for both short and truncated titles.
3. Use the sidebar's organize menu to switch to chronological view and repeat with the unpinned threads.
4. Rename a thread through its menu, then hover the row again without reloading.
5. Repeat in the other theme.

#### Expected Results
- All three sidebar locations provide the full current title through the shared row's native `title` attribute.
- Long titles remain visually truncated and show their complete text on hover; short titles also have tooltips.
- Rename updates both the row text and tooltip immediately.
- Existing action-specific tooltips (delete and menu buttons) remain available; row appearance stays consistent in both themes.

#### Rollback/Cleanup
- Restore any renamed titles, original pin state, view mode, and theme. No new threads are required.
