import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LightbulbIcon } from "lucide-react";
import { ErrorComponentProps } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { useI18n } from "@/contexts/I18nContext";

export function ErrorBoundary({ error }: ErrorComponentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const posthog = usePostHog();
  const { t } = useI18n();

  useEffect(() => {
    console.error("An error occurred in the route:", error);
    posthog.captureException(error);
  }, [error]);

  const handleReportBug = async () => {
    setIsLoading(true);
    try {
      // Create a formatted issue body with the current error information
      const issueBody = `
## Bug Description
<!-- Please describe the issue you're experiencing -->

## Steps to Reproduce
<!-- Please list the steps to reproduce the issue -->

## Expected Behavior
<!-- What did you expect to happen? -->

## Actual Behavior
<!-- What actually happened? -->

## Error Details
- Error Name: ${error?.name || "Unknown"}
- Error Message: ${error?.message || "Unknown"}
${error?.stack ? `\n\`\`\`\n${error.stack.slice(0, 1000)}\n\`\`\`` : ""}
`;

      // Create the GitHub issue URL with the pre-filled body
      const encodedBody = encodeURIComponent(issueBody);
      const encodedTitle = encodeURIComponent(
        "[bug] Error in Blaze application",
      );
      const githubIssueUrl = `https://github.com/blaze-sh/blaze/issues/new?title=${encodedTitle}&labels=bug,filed-from-app,client-error&body=${encodedBody}`;

      // Open the pre-filled GitHub issue page
      window.open(githubIssueUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("Failed to prepare bug report:", err);
      // Fallback to opening the regular GitHub issue page.
      window.open(
        "https://github.com/blaze-sh/blaze/issues/new",
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen p-6">
      <div className="max-w-md w-full bg-background p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4">{t("errorBoundary.title")}</h2>

        <p className="text-sm mb-3">{t("errorBoundary.subtitle")}</p>

        {error && (
          <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-md mb-6">
            <p className="text-sm mb-1">
              <strong>{t("errorBoundary.label.errorName")}:</strong>{" "}
              {error.name}
            </p>
            <p className="text-sm">
              <strong>{t("errorBoundary.label.errorMessage")}:</strong>{" "}
              {error.message}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={handleReportBug} disabled={isLoading}>
            {isLoading
              ? t("errorBoundary.button.preparing")
              : t("errorBoundary.button.report")}
          </Button>
        </div>

        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md flex items-center gap-2">
          <LightbulbIcon className="h-4 w-4 text-blue-700 dark:text-blue-400 flex-shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-400">
            <strong>{t("errorBoundary.tip.label")}</strong>{" "}
            {t("errorBoundary.tip.text")}
          </p>
        </div>
      </div>
    </div>
  );
}
