import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createCodexBridgeMiddleware } from "./src/server/codexAppServerBridge";
import { createLocalFileMiddleware } from "./src/server/localFileHttp";
import tailwindcss from "@tailwindcss/vite";
import { attachBrowserNotificationTransport } from "./src/server/browserNotificationTransport";

const WS_UPGRADE_ATTACHED_KEY = "__codexBridgeWsAttached__";

export default defineConfig({
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
