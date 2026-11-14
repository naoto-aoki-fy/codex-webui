### Feature: Website describes the current Codex web application

#### Prerequisites
- Open `docs/index.html` locally or from the repository documentation site.

#### Steps
1. Confirm the page describes a browser UI backed by a Node.js Codex app-server bridge.
2. Check the source build commands against `package.json` and the README.
3. Confirm setup instructions target Windows and Linux hosts and preserve mobile browser access.
4. Follow the setup and source repository links.

#### Expected Results
- The page describes the application in this repository and links to its setup instructions.
- Source builds use the current CLI entry point.
- No separate product demo or native Android packaging is presented as this application.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Codex WebUI project name

#### Prerequisites
- Build the current checkout with `pnpm run build`.
- Run the web backend against an independently managed app-server. For the login check, start an isolated backend with `--password <test-password>`.

#### Steps
1. Check the README heading and the title and main heading of `docs/index.html`: each must say `Codex WebUI`.
2. Open the application home page in light and dark themes; confirm the browser tab says `Codex WebUI` after initialization and refresh.
3. Open a named thread; confirm the existing project/thread title remains in the tab.
4. In a fresh browser context, open the password-protected backend; confirm the login heading and browser tab say `Codex WebUI`.
5. Check the backend startup banner says `Codex WebUI is running!`.

#### Expected Results
- The project name is consistent in documentation, browser titles, login, and startup output, with readable text in both themes.
- Existing `codexapp`/`codexui` commands, package identity, stored settings, and saved threads remain compatible.

#### Rollback/Cleanup
- Stop the isolated password-protected backend and close the test browser context. Do not modify existing user data.
