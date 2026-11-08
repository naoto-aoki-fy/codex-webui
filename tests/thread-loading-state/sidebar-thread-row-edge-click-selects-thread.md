### Sidebar thread row edge click selects thread

#### Feature/Change Name
Thread rows now select when clicking anywhere on the highlighted row area (including left/right edge/time area), while pin/menu buttons keep their own actions.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar contains multiple threads
3. At least one thread has visible time text on the right

#### Steps
1. Hover a thread row and confirm the row highlight appears
2. Click near the left edge (outside the title text and not on pin icon)
3. Click near the right edge/time area (outside the menu button)
4. Click the thread title/body area
5. Click the pin button and menu button to verify their behavior

#### Expected Results
- Steps 2, 3, and 4 all select/open the clicked thread
- Hover highlight and click target area now match user expectations
- Pin button toggles pin state without selecting due to event bubbling
- Menu button opens thread menu without selecting due to event bubbling

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
3. Tab to delete and menu controls; confirm focus reveals controls and hides status indicators as before.
4. Open the dots menu and right-click menu. Rename a thread, dismiss with Escape, and pin/unpin it. Verify menus anchor to the correct row after moving between lists.
5. Click inline delete once, then select another row to cancel confirmation. Do not confirm deletion unless using a disposable thread.
6. Resize the sidebar and verify long titles truncate while timestamps, worktree icons, and request chips retain their layout.

#### Expected Results
- All four placements share identical row presentation and preserve active state, labels, indicators, keyboard focus, and light/dark colors.
- Each title/edge activation selects once; menu and delete controls do not select through event bubbling.
- Rename, pin/unpin, menu dismissal, and confirmation retain existing behavior.
- Selection and menu interactions issue the same requests as before; rendering rows adds no API traffic.

#### Rollback/Cleanup
- Restore original titles, pin state, ordering mode, and theme. Remove any disposable test threads.
