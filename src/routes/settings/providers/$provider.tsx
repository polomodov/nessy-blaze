import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../../root";
import { LegacyRedirect } from "../../LegacyRedirect";

export const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/providers/$provider",
  component: LegacyRedirect,
});
