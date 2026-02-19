import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AuthPage from "@/pages/auth";
import { hasStoredAuthContext } from "@/lib/auth_storage";

export const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  beforeLoad: () => {
    if (hasStoredAuthContext()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AuthPage,
});
