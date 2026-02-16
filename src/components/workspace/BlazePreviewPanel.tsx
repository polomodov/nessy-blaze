import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Eye,
  Monitor,
  Rocket,
  Smartphone,
  Tablet,
} from "lucide-react";

type Device = "desktop" | "tablet" | "mobile";

const previewWidthByDevice: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

type MockPage = {
  projectTitle: string;
  pageTitle: string;
  sections: ReactNode;
};

const previewPagesById: Record<string, MockPage> = {
  "1-1": {
    projectTitle: "Spring Cashback Campaign",
    pageTitle: "Landing",
    sections: (
      <>
        <section className="bg-primary px-8 py-16 text-center">
          <h1 className="mb-2 text-3xl font-extrabold text-primary-foreground">
            30% Cashback on Every Purchase
          </h1>
          <p className="mb-6 text-sm text-primary-foreground/80">
            Get up to 30% cashback with instant rewards.
          </p>
          <button className="rounded-lg bg-card px-6 py-2.5 text-sm font-semibold text-foreground shadow-sm">
            Apply now
          </button>
        </section>
        <section className="grid grid-cols-3 gap-4 p-8">
          {["Up to 30% cashback", "No monthly fee", "Free transfers"].map(
            (feature) => (
              <div
                key={feature}
                className="rounded-xl bg-muted p-4 text-center text-xs font-medium text-foreground"
              >
                <div className="mx-auto mb-2 h-10 w-10 rounded-lg bg-primary/15" />
                {feature}
              </div>
            ),
          )}
        </section>
        <section className="border-t border-border bg-card px-8 py-10 text-center">
          <h2 className="mb-2 text-lg font-bold text-foreground">
            Open your card in 5 minutes
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Free delivery next business day.
          </p>
          <button className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">
            Get started
          </button>
        </section>
      </>
    ),
  },
  "1-2": {
    projectTitle: "Spring Cashback Campaign",
    pageTitle: "Terms",
    sections: (
      <section className="px-8 py-10">
        <h1 className="mb-6 text-2xl font-bold text-foreground">
          Campaign Terms
        </h1>
        <div className="space-y-4">
          {[
            ["Campaign period", "Feb 1, 2026 - Mar 31, 2026"],
            ["Eligible categories", "Restaurants, supermarkets, fuel"],
            ["Maximum monthly reward", "$500"],
            ["Activation", "Available automatically for all card holders"],
          ].map(([title, description]) => (
            <div key={title} className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>
    ),
  },
  "2-1": {
    projectTitle: "Premium Plan Update",
    pageTitle: "Product Page",
    sections: (
      <>
        <section className="bg-foreground px-8 py-16 text-center">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            New plan
          </p>
          <h1 className="mb-2 text-3xl font-extrabold text-background">
            Premium
          </h1>
          <p className="mb-6 text-sm text-background/60">
            Everything advanced in one plan.
          </p>
          <span className="inline-block rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">
            $29/month
          </span>
        </section>
        <section className="space-y-3 p-8">
          {[
            "Up to 30% cashback",
            "Unlimited transfers",
            "Personal manager",
            "Airport lounge access",
          ].map((feature) => (
            <div
              key={feature}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
            >
              <div className="h-8 w-8 flex-shrink-0 rounded-lg bg-primary/15" />
              <p className="text-sm text-foreground">{feature}</p>
            </div>
          ))}
        </section>
      </>
    ),
  },
  "3-1": {
    projectTitle: "Refer a Friend",
    pageTitle: "Campaign Page",
    sections: (
      <>
        <section className="bg-primary px-8 py-14 text-center">
          <h1 className="mb-2 text-3xl font-extrabold text-primary-foreground">
            Invite a Friend
          </h1>
          <p className="mb-6 text-sm text-primary-foreground/80">
            Earn $150 for each successful invite.
          </p>
          <button className="rounded-lg bg-card px-6 py-2.5 text-sm font-semibold text-foreground">
            Invite now
          </button>
        </section>
        <section className="p-8 text-center">
          <div className="grid grid-cols-3 gap-4">
            {[
              "Share your invite link",
              "Friend signs up",
              "Both receive rewards",
            ].map((step) => (
              <div key={step} className="rounded-xl bg-muted p-4">
                <p className="text-xs font-medium text-foreground">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </>
    ),
  },
};

interface BlazePreviewPanelProps {
  activePageId: string | null;
}

export function BlazePreviewPanel({ activePageId }: BlazePreviewPanelProps) {
  const [device, setDevice] = useState<Device>("desktop");
  const page = activePageId ? previewPagesById[activePageId] : null;

  return (
    <div className="flex h-full w-full flex-col bg-muted/50">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <div className="flex items-center gap-1">
          {(["desktop", "tablet", "mobile"] as Device[]).map((item) => {
            const Icon =
              item === "desktop"
                ? Monitor
                : item === "tablet"
                  ? Tablet
                  : Smartphone;
            return (
              <button
                key={item}
                onClick={() => setDevice(item)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  device === item
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={item}
                aria-label={item}
              >
                <Icon size={16} />
              </button>
            );
          })}
          {page && (
            <div className="ml-3 flex items-center gap-2 border-l border-border pl-3">
              <span className="text-xs text-muted-foreground">
                {page.projectTitle}
              </span>
              <span className="text-xs text-muted-foreground">/</span>
              <span className="text-xs font-medium text-foreground">
                {page.pageTitle}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {page && (
            <button className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-all hover:brightness-105">
              <Rocket size={13} />
              Deploy
            </button>
          )}
          <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Eye size={14} />
            Preview
          </button>
          <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Download size={14} />
            Export
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Open in new tab"
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center overflow-auto p-6">
        <motion.div
          layout
          className="min-h-full max-w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          style={{ width: previewWidthByDevice[device] }}
        >
          <AnimatePresence mode="wait">
            {page ? (
              <motion.div
                key={activePageId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
              >
                {page.sections}
              </motion.div>
            ) : (
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-96 flex-col items-center justify-center p-8 text-center"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                  <Monitor size={20} className="text-muted-foreground" />
                </div>
                <h3 className="mb-1 text-sm font-medium text-foreground">
                  Page preview
                </h3>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Select a page from the workspace or create one from chat.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
