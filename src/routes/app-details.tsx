import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rootRoute } from "./root";
import { LegacyRedirect } from "./LegacyRedirect";

export const appDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-details",
  component: LegacyRedirect,
  validateSearch: z.object({
    appId: z.number().optional(),
  }),
});
