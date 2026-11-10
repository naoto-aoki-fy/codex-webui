### Feature: Chat file-link context menu (open/copy)

#### Prerequisites
- App server is running from this repository.
- Open a thread that contains rendered `.message-file-link` anchors (for example Markdown file links).

#### Steps
1. In a message with a file link, right-click the file link text.
2. Verify the custom context menu appears near the pointer.
3. Click `Open link` and confirm the link opens in a new tab.
4. Right-click the same file link again and click `Copy link`, then paste into a text input to verify copied value.
5. For local file links, verify the menu contains only Open link and Copy link in light and dark themes.
6. Click outside the menu and press `Escape` while the menu is open.

#### Expected Results
- Right-clicking any `.message-file-link` opens the custom context menu.
- Menu includes `Open link` and `Copy link` for all links.
- No browser editing action is available.
- Pointer-down outside, blur, and `Escape` close the menu.

#### Rollback/Cleanup
- Close any tabs opened during the test.
