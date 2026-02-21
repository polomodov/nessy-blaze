export const WORKSPACE_AUTOFIX_STARTED_EVENT =
  "blaze:workspace-autofix-started";
export const WORKSPACE_AUTOFIX_COMPLETED_EVENT =
  "blaze:workspace-autofix-completed";
export const WORKSPACE_PREVIEW_REFRESH_EVENT =
  "blaze:workspace-preview-refresh";

export type WorkspaceAutofixStartedDetail = {
  chatId: number;
  message: string;
};

export type WorkspaceAutofixCompletedDetail = {
  chatId: number;
};

export type WorkspacePreviewRefreshDetail = {
  appId: number;
  reason: "manual-approve";
};
