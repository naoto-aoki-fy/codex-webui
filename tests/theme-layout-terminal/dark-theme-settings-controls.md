### Fix: Dark theme Settings controls

#### Prerequisites
- Run the app from this repository and open Settings.
- Note the current appearance settings so they can be restored.

#### Steps
1. Set Appearance to Dark. Inspect the UI language and appearance controls; open each menu and search where supported. Check selected, hovered, keyboard-focused, and disabled states when available.
2. Repeat at desktop and mobile widths, checking for clipping or overflow.
3. Switch Appearance to Light and repeat the checks. Set Appearance to System and switch the operating system between light and dark preferences.

#### Expected Results
- In Dark appearance, dropdown triggers have dark backgrounds, light text, visible borders and focus indicators; menus, search, disabled states, and checkbox remain readable.
- Light appearance retains its existing colors, System follows the system preference, and the layout remains usable at both widths. Settings actions retain their existing behavior.

#### Rollback/Cleanup
- Restore the original appearance and language.

### Account settings component extraction

Prerequisites: Run the current checkout and open Settings. Record the current appearance and UI language. Use a test account/server for logout checks.

1. At 1280x900, 375x812 and 768x1024, open the sidebar and Settings. Verify the account panel in Light and Dark appearance, including readable status/error text and buttons without clipping.
2. Click Reload. Expect Reloading… and disabled actions while refreshing, followed by the current authentication status. With an authenticated test server, verify Logout is visible; with signed-out/unknown status it is absent.
3. During a blocked authentication change, verify Logout remains disabled. On a test server, click Logout and verify the existing parent-owned logout flow runs.
4. Change UI language and verify account labels update. Reload the page and confirm saved language/appearance still apply.

Cleanup: Restore language and appearance. Reauthenticate the test account if logout was exercised. The component owns no credentials or persisted state.

### General preferences component extraction

Prerequisites: Run the current checkout, record the four general preferences, and open the sidebar and Settings. No authenticated server is needed for these local preferences.

1. At 1440x900, 375x812, and 768x1024, repeat in Light and Dark appearance. Verify send shortcut, Appearance, UI language, and Chat width are readable, retain row separators, and fit inside the panel.
2. Focus the send shortcut button and press Enter. Expect the toggle to change and focus to stay on the button. Cycle Appearance with Space through all three modes; System must follow the OS preference.
3. Open UI language, choose Simplified Chinese, and confirm translated settings labels. Select English again. Tab through the controls and press Escape to close Settings.
4. Cycle Chat width and verify the conversation/composer width follows the existing presets. Reload and reopen Settings; verify shortcut, appearance, language, and chat width persisted.

Expected: The extracted controls retain their existing labels, help titles, custom dropdown, keyboard actions, theme styles, and local persistence. They have no loading/error/validation states; the language menu continues to restrict selection to supported options. API calls and persistence remain owned by App.vue and the existing language composable.

Cleanup: Restore all four recorded preferences. Automated checks should use an isolated browser context; local preference checks do not prove live backend authentication or filesystem behavior.
