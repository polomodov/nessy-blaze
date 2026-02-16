import { ThemeProvider } from "../contexts/ThemeContext";
import { DeepLinkProvider } from "../contexts/DeepLinkContext";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <DeepLinkProvider>
        <main className="h-screen w-full overflow-hidden bg-background">
          {children}
        </main>
        <Toaster richColors />
      </DeepLinkProvider>
    </ThemeProvider>
  );
}
