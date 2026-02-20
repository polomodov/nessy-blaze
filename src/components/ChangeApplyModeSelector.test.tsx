import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeApplyModeSelector } from "./ChangeApplyModeSelector";

const { settingsRef, updateSettingsMock, showInfoMock } = vi.hoisted(() => ({
  settingsRef: {
    current: { autoApproveChanges: false } as {
      autoApproveChanges?: boolean;
    } | null,
  },
  updateSettingsMock: vi.fn(),
  showInfoMock: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settingsRef.current,
    updateSettings: updateSettingsMock,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showInfo: showInfoMock,
}));

describe("ChangeApplyModeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = { autoApproveChanges: false };
    updateSettingsMock.mockResolvedValue({ autoApproveChanges: false });
  });

  it("defaults to manual mode when auto-approve is disabled", () => {
    render(<ChangeApplyModeSelector />);

    expect(
      screen.getByTestId("apply-mode-manual").getAttribute("data-state"),
    ).toBe("on");
    expect(
      screen.getByTestId("apply-mode-auto").getAttribute("data-state"),
    ).toBe("off");
  });

  it("switches to auto mode and persists setting", () => {
    render(<ChangeApplyModeSelector />);

    fireEvent.click(screen.getByTestId("apply-mode-auto"));

    expect(updateSettingsMock).toHaveBeenCalledWith({
      autoApproveChanges: true,
    });
    expect(showInfoMock).toHaveBeenCalledTimes(1);
  });

  it("can disable toast notifications", () => {
    settingsRef.current = { autoApproveChanges: true };
    updateSettingsMock.mockResolvedValue({ autoApproveChanges: true });

    render(<ChangeApplyModeSelector showToast={false} variant="compact" />);

    fireEvent.click(screen.getByTestId("apply-mode-manual"));

    expect(updateSettingsMock).toHaveBeenCalledWith({
      autoApproveChanges: false,
    });
    expect(showInfoMock).not.toHaveBeenCalled();
  });
});
