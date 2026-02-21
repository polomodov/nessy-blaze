import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AuthPage from "@/pages/auth";
import { hasStoredAuthContext } from "@/lib/auth_storage";
import { hasOAuth2CallbackParams } from "@/lib/oauth2_flow";

export const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  beforeLoad: () => {
    const hasOAuthCallback =
      typeof window !== "undefined" &&
      hasOAuth2CallbackParams(window.location.search);
    if (hasStoredAuthContext() && !hasOAuthCallback) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AuthPage,
});
