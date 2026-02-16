import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ReactCompilerConfig = {};

function ipcHttpGatewayPlugin(): Plugin {
  return {
    name: "dyad-ipc-http-gateway",
    apply: "serve",
    async configureServer(server) {
      const [
        { createApiV1Middleware },
        { createIpcInvokeMiddleware },
        { invokeIpcChannelOverHttp },
      ] =
        await Promise.all([
          import("./src/http/api_v1_middleware"),
          import("./src/http/ipc_http_middleware"),
          import("./src/http/ipc_http_gateway"),
        ]);
      const apiMiddleware = createApiV1Middleware(invokeIpcChannelOverHttp);
      const middleware = createIpcInvokeMiddleware(invokeIpcChannelOverHttp);
      server.middlewares.use(apiMiddleware);
      server.middlewares.use(middleware);
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
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
