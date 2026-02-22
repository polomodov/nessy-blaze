import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { ActionHeader } from "./ActionHeader";

const { clearSessionDataMock, restartAppMock, refreshAppIframeMock } =
  vi.hoisted(() => ({
    clearSessionDataMock: vi.fn(),
    restartAppMock: vi.fn(),
    refreshAppIframeMock: vi.fn(),
  }));

vi.mock("@/ipc/ipc_client", () => ({
  IpcClient: {
    getInstance: vi.fn(() => ({
      clearSessionData: clearSessionDataMock,
    })),
  },
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({
    restartApp: restartAppMock,
    refreshAppIframe: refreshAppIframeMock,
  }),
}));

vi.mock("@/hooks/useCheckProblems", () => ({
  useCheckProblems: () => ({
    problemReport: null,
  }),
}));

vi.mock("@/components/chat/ChatActivity", () => ({
  ChatActivityButton: () => <div data-testid="chat-activity-button" />,
}));

describe("ActionHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionDataMock.mockResolvedValue(undefined);
  });

  it("renders core preview modes and hides publish mode", () => {
    const queryClient = new QueryClient();
    const store = createStore();
    store.set(selectedAppIdAtom, 42);

    render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <ActionHeader />
        </Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("preview-mode-button")).toBeTruthy();
    expect(screen.getByTestId("problems-mode-button")).toBeTruthy();
    expect(screen.getByTestId("code-mode-button")).toBeTruthy();
    expect(screen.getByTestId("configure-mode-button")).toBeTruthy();
    expect(screen.getByTestId("security-mode-button")).toBeTruthy();
    expect(screen.queryByTestId("publish-mode-button")).toBeNull();
  });
});
