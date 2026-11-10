### Fix: Dark theme Settings controls and Telegram panel

#### Prerequisites
- Run the app from this repository and open Settings.
- Note the current appearance and Telegram settings so they can be restored.

#### Steps
1. Set Appearance to Dark. Inspect the UI language and appearance controls; open each menu and search where supported. Check selected, hovered, keyboard-focused, and disabled states when available.
2. Expand Telegram. Inspect all labels, inputs, placeholders, help and status text, the notification checkbox, and both action buttons. Tab through the controls and hover the buttons; check disabled and validation error states when available.
3. Repeat at desktop and mobile widths, checking for clipping or overflow.
4. Switch Appearance to Light and repeat the checks. Set Appearance to System and switch the operating system between light and dark preferences.

#### Expected Results
- In Dark appearance, dropdown triggers and Telegram buttons have dark backgrounds, light text, visible borders and focus indicators; menus, search, disabled states, and checkbox remain readable.
- The Telegram panel, fields, help text, and error messages use legible dark surfaces and text. No affected control has an unintended light surface.
- Light appearance retains its existing colors, System follows the system preference, and the layout remains usable at both widths. Settings and Telegram actions retain their existing behavior.

#### Rollback/Cleanup
- Restore the original appearance and any changed settings. Do not save test Telegram credentials or send a test notification unless intended.

### Account settings component extraction

Prerequisites: Run the current checkout and open Settings. Record the current appearance and UI language. Use a test account/server for logout checks.

1. At 1280x900, 375x812 and 768x1024, open the sidebar and Settings. Verify the account panel in Light and Dark appearance, including readable status/error text and buttons without clipping.
2. Click Reload. Expect Reloading… and disabled actions while refreshing, followed by the current authentication status. With an authenticated test server, verify Logout is visible; with signed-out/unknown status it is absent.
3. During a blocked authentication change, verify Logout remains disabled. On a test server, click Logout and verify the existing parent-owned logout flow runs.
4. Change UI language and verify account labels update. Reload the page and confirm saved language/appearance still apply.

Cleanup: Restore language and appearance. Reauthenticate the test account if logout was exercised. The component owns no credentials or persisted state.
