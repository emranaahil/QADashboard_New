"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type BrowserOption = {
  id: string;
  label: string;
  warning?: boolean;
  hint?: string;
};

type BrowserSelectorProps = {
  value: string;
  onChange: (browserId: string) => void;
  disabled?: boolean;
  mode?: "single" | "full";
  compact?: boolean;
};

const FALLBACK_BROWSERS: BrowserOption[] = [
  { id: "chrome", label: "Chrome", hint: "Recommended — fastest and most consistent." },
  {
    id: "firefox",
    label: "Firefox",
    warning: true,
    hint: "Slower on live hosting — use one device; Chrome is more reliable on small servers.",
  },
  {
    id: "safari",
    label: "Safari",
    warning: true,
    hint: "Server-side WebKit — approximates Safari layout.",
  },
];

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

  const selected = browsers.find((b) => b.id === value) || browsers[0];
  const note =
    mode === "full" && value !== "chrome"
      ? `Full-site scans with ${selected?.label} use more memory — prefer one device.`
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
              selected?.warning || (mode === "full" && value !== "chrome")
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
          const active = value === browser.id;
          return (
            <button
              key={browser.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(browser.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40"
              )}
            >
              {browser.label}
            </button>
          );
        })}
      </div>
      {!compact && note ? (
        <p
          className={cn(
            "text-[0.7rem]",
            selected?.warning || (mode === "full" && value !== "chrome")
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