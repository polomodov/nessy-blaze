import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export function LegacyRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}
