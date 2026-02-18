import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ReactCompilerConfig = {};

function ipcHttpGatewayPlugin(): Plugin {
  return {
    name: "blaze-ipc-http-gateway",
    apply: "serve",
    async configureServer(server) {
      let chatStreamModule;
      let chatWsServerModule;
      let apiV1Module;
      let ipcHttpMiddlewareModule;
      let ipcGatewayModule;

      try {
        chatStreamModule = await import("./src/http/chat_stream_middleware");
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing chat_stream_middleware",
          error,
        );
        throw error;
      }
      try {
        chatWsServerModule = await import("./src/http/chat_ws_server");
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing chat_ws_server",
          error,
        );
        throw error;
      }
      try {
        apiV1Module = await import("./src/http/api_v1_middleware");
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing api_v1_middleware",
          error,
        );
        throw error;
      }
      try {
        ipcHttpMiddlewareModule = await import(
          "./src/http/ipc_http_middleware"
        );
      } catch (error) {
        console.error(
          "[blaze-ipc-http-gateway] failed importing ipc_http_middleware",
          error,
        );
        throw error;
      }
      try {
        ipcGatewayModule = await import("./src/http/ipc_http_gateway");
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
      const { createIpcInvokeMiddleware } = ipcHttpMiddlewareModule;
      const { invokeIpcChannelOverHttp } = ipcGatewayModule;
      const chatStreamMiddleware = createChatStreamMiddleware({
        loadChatStreamHandlers: () =>
          server.ssrLoadModule("/src/ipc/handlers/chat_stream_handlers.ts"),
      });
      const wsServerHandle = server.httpServer
        ? attachChatWsServer({
            httpServer: server.httpServer,
            loadChatStreamHandlers: () =>
              server.ssrLoadModule("/src/ipc/handlers/chat_stream_handlers.ts"),
          })
        : null;
      const apiMiddleware = createApiV1Middleware(invokeIpcChannelOverHttp);
      const middleware = createIpcInvokeMiddleware(invokeIpcChannelOverHttp);
      server.middlewares.use(chatStreamMiddleware);
      server.middlewares.use(apiMiddleware);
      server.middlewares.use(middleware);
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
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname, "./src")}/`,
      },
    ],
  },
});
