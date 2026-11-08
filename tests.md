# Tests

This file is the manual test index. Detailed regression and feature verification steps live in domain folders under [`tests/`](tests/).

Current automated commands and isolation boundaries: [development guide](docs/development.md#verification).
Live acceptance: [external server](tests/website-docs-misc/external-app-server.md).
Files marked historical preserve former behavior and are not current acceptance criteria.

## Architecture

- Keep one root index (`tests.md`) so existing links and contributor habits keep working.
- Put each product area in a domain folder such as `tests/thread-loading-state/` or `tests/chat-composer-rendering/`.
- Keep one manual test section per file inside the domain folder so feature updates create small diffs and narrow merge conflicts.
- Use each domain folder `index.md` to find the detailed section file.
- Add new test sections to the narrowest matching domain folder; create a new domain folder only when no existing domain fits.
- Use [`tests/template.md`](tests/template.md) for the required manual test shape.

## Domain Folders

| Folder | Scope |
| --- | --- |
| [Projects, Sidebar, and New Chat](tests/projects-sidebar-new-chat/index.md) | Home route, project picker, sidebar organization, new-chat setup, projectless folders, and project/worktree shell behavior. |
| [Skills, Plugins, and Integrations](tests/skills-plugins-integrations/index.md) | Skills Hub, local Skills management, plugin/app directory surfaces, prompts, Telegram, and installed skill behavior. |
| [Chat Composer and Message Rendering](tests/chat-composer-rendering/index.md) | Composer controls, immediate steering, plan mode, markdown parsing, file links, attachments, generated images, and visible message rows. |
| [Thread Loading, Streaming, and State](tests/thread-loading-state/index.md) | Thread list/detail loading, pagination, selected-thread stability, streaming scroll behavior, live-state reads, and missing-thread handling. |
| [Codex Models](tests/providers-models/index.md) | Official Codex models, reasoning preferences, per-thread model selection, and catalog behavior. |
| [Auth and Docker Runtime](tests/auth-docker-runtime/index.md) | External-auth acceptance links and historical Docker/local-auth records (excluded from current acceptance). |
| [CLI, Network, and Platform](tests/cli-network-platform/index.md) | CLI startup, dev scripts, npx, private networks, external proxies, Windows, Linux, and platform packaging behavior. |
| [Git, Worktrees, and Rollback](tests/git-worktrees-rollback/index.md) | Branch controls, worktree creation, rollback commits, changed-files panels, file browser links, and rollback debug behavior. |
| [Accounts and Observability](tests/accounts-feedback-observability/index.md) | External Codex account status, active-account quotas, visible errors, browser profiling, API perf logs, and Qodo diagnostic fixes. |
| [Theme and Layout](tests/theme-layout-terminal/index.md) | Light/dark theme regressions, responsive layout, mobile keyboard behavior, dialog sizing, and visual alignment. |
| [Website, Docs, and Miscellaneous](tests/website-docs-misc/index.md) | Static website checks and small compatibility checks that do not yet fit a narrower product area. |

## Template

See [`tests/template.md`](tests/template.md).

Indexes contain both current checks and explicitly separated historical references. Use the current external-server checklist for authentication and approvals; historical results are snapshots, not current suite totals. Run the commands in the development guide for current results.
