import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createCodexBridgeMiddleware } from "./src/server/codexAppServerBridge";
import { createLocalFileMiddleware } from "./src/server/localFileHttp";
import tailwindcss from "@tailwindcss/vite";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { attachBrowserNotificationTransport } from "./src/server/browserNotificationTransport";
import pkg from "./package.json";

function getWorktreeName(): string {
  const normalizedCwd = process.cwd().replace(/\\/g, "/");
  const segments = normalizedCwd.split("/").filter(Boolean);
  const worktreesIndex = segments.lastIndexOf("worktrees");
  if (worktreesIndex >= 0 && worktreesIndex + 1 < segments.length) {
    return segments[worktreesIndex + 1];
  }

  const gitDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (gitDir.status === 0) {
    const resolvedGitDir = gitDir.stdout.trim().replace(/\\/g, "/");
    const worktreeMarker = "/.git/worktrees/";
    const markerIndex = resolvedGitDir.indexOf(worktreeMarker);
    if (markerIndex >= 0) {
      const worktreeSegments = resolvedGitDir.slice(markerIndex + worktreeMarker.length).split("/").filter(Boolean);
      if (worktreeSegments.length > 0) {
        return worktreeSegments[0] ?? "unknown";
      }
    }
  }

  const gitCommonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (gitCommonDir.status === 0) {
    const resolvedGitCommonDir = gitCommonDir.stdout.trim().replace(/\\/g, "/");
    if (resolvedGitCommonDir.endsWith("/.git")) {
      const commonDirSegments = resolvedGitCommonDir.split("/").filter(Boolean);
      if (commonDirSegments.length >= 2) {
        return commonDirSegments[commonDirSegments.length - 2] ?? "unknown";
      }
    }
  }

  return segments[segments.length - 1] ?? "unknown";
}

const worktreeName = getWorktreeName();
const packageVersion: unknown = "version" in pkg ? pkg.version : undefined;
const appVersion =
  typeof packageVersion === "string" && packageVersion.trim().length > 0
    ? packageVersion.trim()
    : "unknown";
const WS_UPGRADE_ATTACHED_KEY = "__codexBridgeWsAttached__";

function readEnvValueFromFile(filePath: string, key: string): string {
  if (!existsSync(filePath)) return "";
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const currentKey = trimmed.slice(0, separator).trim();
    if (currentKey !== key) continue;
    return trimmed.slice(separator + 1).trim();
  }
  return "";
}

function resolveViteRollbackDebugFallback(): string {
  const fromEnvLocal = readEnvValueFromFile(".env.local", "VITE_ROLLBACK_DEBUG");
  if (fromEnvLocal) return fromEnvLocal;
  return readEnvValueFromFile(".env", "VITE_ROLLBACK_DEBUG");
}

const viteRollbackDebugFallback = resolveViteRollbackDebugFallback();

export default defineConfig({
  build: { manifest: true },
  define: {
    "import.meta.env.VITE_WORKTREE_NAME": JSON.stringify(worktreeName),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_ROLLBACK_DEBUG_FALLBACK": JSON.stringify(viteRollbackDebugFallback),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [".trycloudflare.com"],
    watch: {
      ignored: [
        '**/.omx/**',
        '**/.cursor/**',
        '**/.playwright-cli/**',
        '**/dist/**',
        '**/dist-cli/**',
      ],
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: "codex-bridge",
      configureServer(server) {
        process.env.CODEXUI_SERVER_PORT = String(server.config.server.port ?? 5173);
        const bridge = createCodexBridgeMiddleware();
        const httpServer = server.httpServer;
        if (httpServer) {
          httpServer.once("listening", () => {
            const addr = httpServer.address();
            if (addr && typeof addr === "object" && addr.port) {
              process.env.CODEXUI_SERVER_PORT = String(addr.port);
            }
          });
          const hostScope = httpServer as typeof httpServer & {
            [WS_UPGRADE_ATTACHED_KEY]?: boolean;
          };
          if (!hostScope[WS_UPGRADE_ATTACHED_KEY]) {
            hostScope[WS_UPGRADE_ATTACHED_KEY] = true;
            attachBrowserNotificationTransport(httpServer, bridge.subscribeNotifications);
          }
        }
        server.middlewares.use(createLocalFileMiddleware(bridge.files));
        server.middlewares.use(bridge);
        server.httpServer?.once("close", () => {
          bridge.dispose();
        });
      },
    },
  ],
});
