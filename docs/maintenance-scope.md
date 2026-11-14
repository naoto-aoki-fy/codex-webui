# Maintenance scope

The application is a Node.js CLI server and browser UI for Codex app-server. Supported hosts are Windows and Linux; mobile browsers can connect to those hosts.

## Supported workflows

- `package.json` defines frontend/CLI builds, unit tests, and development commands.

## Retired material

`ProxySpec.md` described removed OpenRouter, Zen, and custom proxy modules. Current authentication/model behavior is covered by `tests/providers-models/codex-only-models-and-auth.md`. Legacy provider fixtures that test history and preference migration remain relevant.

The Codex.app thread-filter and worktree-button patch scripts, their macOS launcher, and their manual procedures were removed. They patched a separate Electron application using version-specific internals and were not used by the application, package scripts, or CI. The unpacked debug launcher and unused compatibility alias were also removed.

The old CLI auto-star procedure was removed because the current CLI has no repository-star behavior. The documentation website now describes this repository instead of a separate OpenClaw Android APK product.

Historical source material under `llm-wiki/raw/` and generated upstream protocol documentation remain intact. They serve as evidence and protocol references, rather than current setup instructions.

## Outstanding work and tooling boundaries

[Open items](maintenance/open-items.md) is the canonical list of verified concerns
and deferred decisions, including portable profiler inputs.
