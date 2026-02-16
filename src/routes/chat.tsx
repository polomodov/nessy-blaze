import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rootRoute } from "./root";
import { LegacyRedirect } from "./LegacyRedirect";

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: LegacyRedirect,
  validateSearch: z.object({
    id: z.number().optional(),
  }),
});
