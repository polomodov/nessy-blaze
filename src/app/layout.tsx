import { ThemeProvider } from "../contexts/ThemeContext";
import { I18nProvider } from "../contexts/I18nContext";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <main className="h-screen w-full overflow-hidden bg-background">
          {children}
        </main>
        <Toaster richColors />
      </I18nProvider>
    </ThemeProvider>
  );
}
