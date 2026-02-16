import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { LegacyRedirect } from "./LegacyRedirect";

export const hubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hub",
  component: LegacyRedirect,
});
