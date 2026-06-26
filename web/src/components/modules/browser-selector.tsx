"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type BrowserOption = {
  id: string;
  label: string;
  warning?: boolean;
  hint?: string;
  comingSoon?: boolean;
  available?: boolean;
};

type BrowserSelectorProps = {
  value: string;
  onChange: (browserId: string) => void;
  disabled?: boolean;
  mode?: "single" | "full";
  compact?: boolean;
};

const COMING_SOON_TOAST: Record<string, { title: string; description: string }> = {
  firefox: {
    title: "Firefox — Coming soon",
    description:
      "Firefox testing on the live server is in development. Chrome is available today for reliable production runs.",
  },
  safari: {
    title: "Safari — Coming soon",
    description:
      "Safari (WebKit) testing on the live server is in development. Chrome is available today for reliable production runs.",
  },
};

const FALLBACK_BROWSERS: BrowserOption[] = [
  { id: "chrome", label: "Chrome", available: true, hint: "Recommended — fastest and most consistent." },
  {
    id: "firefox",
    label: "Firefox",
    warning: true,
    comingSoon: process.env.NODE_ENV === "production",
    available: process.env.NODE_ENV !== "production",
    hint:
      process.env.NODE_ENV === "production"
        ? "Coming soon on the live dashboard — Chrome is available today."
        : "Slower on live hosting — use one device; Chrome is more reliable on small servers.",
  },
  {
    id: "safari",
    label: "Safari",
    warning: true,
    comingSoon: process.env.NODE_ENV === "production",
    available: process.env.NODE_ENV !== "production",
    hint:
      process.env.NODE_ENV === "production"
        ? "Coming soon on the live dashboard — Chrome is available today."
        : "Server-side WebKit — approximates Safari layout.",
  },
];

function showComingSoonToast(browser: BrowserOption) {
  const copy = COMING_SOON_TOAST[browser.id] || {
    title: `${browser.label} — Coming soon`,
    description:
      "This browser is not available on the live dashboard yet. Chrome is ready for production testing today.",
  };
  toast.info(copy.title, { description: copy.description, duration: 5000 });
}

export function BrowserSelector({
  value,
  onChange,
  disabled = false,
  mode = "single",
  compact = false,
}: BrowserSelectorProps) {
  const [browsers, setBrowsers] = useState<BrowserOption[]>(FALLBACK_BROWSERS);

  useEffect(() => {
    api
      .getBrowsers({ scope: "ui" })
      .then((res) => {
        if (res.browsers?.length) setBrowsers(res.browsers);
      })
      .catch(() => {
        setBrowsers(FALLBACK_BROWSERS);
      });
  }, []);

  const selected =
    browsers.find((b) => b.id === value && !b.comingSoon) ||
    browsers.find((b) => b.available !== false && !b.comingSoon) ||
    browsers[0];

  const handleSelect = (browser: BrowserOption) => {
    if (disabled) return;
    if (browser.comingSoon) {
      showComingSoonToast(browser);
      return;
    }
    onChange(browser.id);
  };

  const note =
    mode === "full" && value !== "chrome" && !browsers.find((b) => b.id === value)?.comingSoon
      ? `Full-site scans with ${selected?.label} use more memory — prefer one device.`
      : selected?.comingSoon
        ? selected.hint
        : selected?.warning
          ? "Non-Chrome browsers may report different issues than Chrome."
          : selected?.hint || null;

  return (
    <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-muted-foreground">Browser</label>
        {compact && note ? (
          <span
            className={cn(
              "text-right text-[0.68rem] leading-snug",
              selected?.comingSoon || selected?.warning || (mode === "full" && value !== "chrome")
                ? "text-amber-500"
                : "text-muted-foreground"
            )}
          >
            {note}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Browser selection">
        {browsers.map((browser) => {
          const active = !browser.comingSoon && value === browser.id;
          const soon = Boolean(browser.comingSoon);
          return (
            <button
              key={browser.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-disabled={soon || disabled}
              disabled={disabled && !soon}
              onClick={() => handleSelect(browser)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                soon
                  ? "cursor-pointer border-dashed border-amber-500/35 bg-amber-500/5 text-muted-foreground hover:border-amber-500/55 hover:bg-amber-500/10"
                  : active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40",
                disabled && !soon && "pointer-events-none opacity-50"
              )}
            >
              {browser.label}
              {soon ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-2.5 w-2.5" aria-hidden />
                  Soon
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!compact && note ? (
        <p
          className={cn(
            "text-[0.7rem]",
            selected?.comingSoon || selected?.warning || (mode === "full" && value !== "chrome")
              ? "text-amber-500"
              : "text-muted-foreground"
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}