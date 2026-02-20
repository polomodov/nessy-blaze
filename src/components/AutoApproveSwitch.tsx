import { ChangeApplyModeSelector } from "@/components/ChangeApplyModeSelector";

export function AutoApproveSwitch({
  showToast = true,
}: {
  showToast?: boolean;
}) {
  return <ChangeApplyModeSelector variant="compact" showToast={showToast} />;
}
