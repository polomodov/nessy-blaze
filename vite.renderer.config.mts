import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { blazeComponentTagger } from "./src/vite/blaze_component_tagger_plugin";

const ReactCompilerConfig = {};

function ipcHttpGatewayPlugin(): Plugin {
  return {
    name: "blaze-ipc-http-gateway",
    apply: "serve",
    async configureServer(server) {
      let chatStreamModule;
      let chatWsServerModule;
      let apiV1Module;
      let ipcGatewayModule;

      try {
        chatStreamModule = await server.ssrLoadModule(
          path.resolve(__dirname, "src/http/chat_stream_middleware.ts"),
        );
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing chat_stream_middleware",
          error,
        );
        throw error;
      }
      try {
        chatWsServerModule = await server.ssrLoadModule(
          path.resolve(__dirname, "src/http/chat_ws_server.ts"),
        );
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing chat_ws_server",
          error,
        );
        throw error;
      }
      try {
        apiV1Module = await server.ssrLoadModule(
          path.resolve(__dirname, "src/http/api_v1_middleware.ts"),
        );
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing api_v1_middleware",
          error,
        );
        throw error;
      }
      try {
        ipcGatewayModule = await server.ssrLoadModule(
          path.resolve(__dirname, "src/http/ipc_http_gateway.ts"),
        );
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing ipc_http_gateway",
          error,
        );
        throw error;
      }

      const { createChatStreamMiddleware } = chatStreamModule;
      const { attachChatWsServer } = chatWsServerModule;
      const { createApiV1Middleware } = apiV1Module;
      const { invokeIpcChannelOverHttp } = ipcGatewayModule;
      const chatStreamMiddleware = createChatStreamMiddleware({
        loadChatStreamHandlers: () =>
          server.ssrLoadModule(
            path.resolve(__dirname, "src/ipc/handlers/chat_stream_handlers.ts"),
          ),
      });
      const wsServerHandle = server.httpServer
        ? attachChatWsServer({
            httpServer: server.httpServer,
            loadChatStreamHandlers: () =>
              server.ssrLoadModule(
                path.resolve(
                  __dirname,
                  "src/ipc/handlers/chat_stream_handlers.ts",
                ),
              ),
          })
        : null;
      const apiMiddleware = createApiV1Middleware(invokeIpcChannelOverHttp);
      server.middlewares.use(chatStreamMiddleware);
      server.middlewares.use(apiMiddleware);
      if (server.httpServer && wsServerHandle) {
        server.httpServer.once("close", () => {
          wsServerHandle.dispose();
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    ipcHttpGatewayPlugin(),
    blazeComponentTagger(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: [
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname, "./src")}/`,
      },
    ],
  },
});
