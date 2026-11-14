### Fix: Dark theme Settings controls

#### Prerequisites
- Run the app from this repository and open Settings.
- Note the current appearance settings so they can be restored.

#### Steps
1. Set Appearance to Dark. Inspect the appearance and remaining Settings controls; open menus and search where supported. Check selected, hovered, keyboard-focused, and disabled states when available.
2. Repeat at desktop and mobile widths, checking for clipping or overflow.
3. Switch Appearance to Light and repeat the checks. Set Appearance to System and switch the operating system between light and dark preferences.

#### Expected Results
- In Dark appearance, dropdown triggers have dark backgrounds, light text, visible borders and focus indicators; menus, search, disabled states, and checkbox remain readable.
- Light appearance retains its existing colors, System follows the system preference, and the layout remains usable at both widths. Settings actions retain their existing behavior.

#### Rollback/Cleanup
- Restore the original appearance.

### Account settings component extraction

Prerequisites: Run the current checkout and open Settings. Record the current appearance. Use a test account/server for logout checks.

1. At 1280x900, 375x812 and 768x1024, open the sidebar and Settings. Verify the account panel in Light and Dark appearance, including readable status/error text and buttons without clipping.
2. Click Reload. Expect Reloading… and disabled actions while refreshing, followed by the current authentication status. With an authenticated test server, verify Logout is visible; with signed-out/unknown status it is absent.
3. During a blocked authentication change, verify Logout remains disabled. On a test server, click Logout and verify the existing parent-owned logout flow runs.
4. Reload the page and confirm account labels remain English and saved appearance still applies.

Cleanup: Restore appearance. Reauthenticate the test account if logout was exercised. The component owns no credentials or persisted state.

### General preferences component extraction

Prerequisites: Run the current checkout, record the three general preferences, and open the sidebar and Settings. No authenticated server is needed for these local preferences.

1. At 1440x900, 375x812, and 768x1024, repeat in Light and Dark appearance. Verify send shortcut, Appearance, and Chat width are readable, retain row separators, and fit inside the panel.
2. Focus the send shortcut button and press Enter. Expect the toggle to change and focus to stay on the button. Cycle Appearance with Space through all three modes; System must follow the OS preference.
3. Verify there is no UI language row or dropdown. Tab through the remaining controls and press Escape to close Settings.
4. Cycle Chat width and verify the conversation/composer width follows the existing presets. Reload and reopen Settings; verify shortcut, appearance, and chat width persisted.

Expected: The extracted controls retain their existing labels, help titles, keyboard actions, theme styles, and local persistence. They have no loading/error/validation states. API calls and preference persistence remain owned by App.vue.

Cleanup: Restore all three recorded preferences. Automated checks should use an isolated browser context; local preference checks do not prove live backend authentication or filesystem behavior.

### English-only UI with legacy preferences

Prerequisites: Run the current checkout in an isolated browser context. Set the browser locale to `zh-CN` and save `localStorage.setItem('codex-web-local.ui-language.v1', 'zh-CN')` before loading the app.

1. Open Settings in Light appearance. Verify all interface labels are English and the UI language row/dropdown is absent. Inspect the root HTML element: `lang` must be `en`.
2. Exercise the send shortcut, Appearance, and Chat width controls; verify their existing behavior. Repeat in Dark appearance and check readability and keyboard access.
3. Reload, reopen Settings, and verify English labels, `lang="en"`, no language picker, and persistence of the remaining preferences.

Expected: Browser locale and the legacy saved language cannot change the interface language. No storage reset is needed.

Cleanup: Close the isolated browser context. When using a regular profile, restore the other preferences and remove the test key.
