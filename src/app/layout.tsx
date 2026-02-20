import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { I18nProvider } from "../contexts/I18nContext";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <DeepLinkProvider>
          <main className="h-screen w-full overflow-hidden bg-background">
            {children}
          </main>
          <Toaster richColors />
        </DeepLinkProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
