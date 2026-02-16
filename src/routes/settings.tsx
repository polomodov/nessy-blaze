import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { LegacyRedirect } from "./LegacyRedirect";

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: LegacyRedirect,
});
