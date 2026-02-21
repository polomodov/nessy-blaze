import React, { createContext, useContext } from "react";
import { DeepLinkData } from "../ipc/deep_link_data";

type DeepLinkContextType = {
  lastDeepLink: (DeepLinkData & { timestamp: number }) | null;
  clearLastDeepLink: () => void;
};

const DeepLinkContext = createContext<DeepLinkContextType>({
  lastDeepLink: null,
  clearLastDeepLink: () => {},
});

export function DeepLinkProvider({ children }: { children: React.ReactNode }) {
  return (
    <DeepLinkContext.Provider
      value={{
        lastDeepLink: null,
        clearLastDeepLink: () => {},
      }}
    >
      {children}
    </DeepLinkContext.Provider>
  );
}

export const useDeepLink = () => useContext(DeepLinkContext);
