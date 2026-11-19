import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createCodexBridgeMiddleware } from "./src/server/codexAppServerBridge";
import { createLocalFileMiddleware } from "./src/server/localFileHttp";
import tailwindcss from "@tailwindcss/vite";
import { attachBrowserNotificationTransport } from "./src/server/browserNotificationTransport";
import { getBuildMetadata } from "./scripts/build-metadata";
import { holdWebuiWriterLease } from "./src/server/webuiMaintenance.mjs";

const WS_UPGRADE_ATTACHED_KEY = "__codexBridgeWsAttached__";
const buildMetadata = getBuildMetadata();

export default defineConfig({
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(buildMetadata.commitSha),
    __BUILD_TIMESTAMP__: JSON.stringify(buildMetadata.timestamp),
  },
  build: { manifest: true },
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
      buildStart() {
        holdWebuiWriterLease();
      },
      configureServer(server) {
        holdWebuiWriterLease();
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
