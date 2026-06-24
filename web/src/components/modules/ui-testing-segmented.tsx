"use client";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: "lg" | "md";
  "aria-label"?: string;
};

export function UiTestingSegmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "lg",
  "aria-label": ariaLabel,
}: Props<T>) {
  const isLg = size === "lg";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex w-full rounded-[14px] border border-border bg-[rgba(7,26,18,0.45)] p-1",
        isLg ? "h-[52px] max-w-[420px]" : "h-11 min-w-[240px]",
        className
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-1 items-center justify-center rounded-[10px] border border-transparent text-sm font-semibold transition-all duration-250",
              active
                ? "bg-[rgba(29,191,115,0.15)] text-[#1dbf73] shadow-[0_0_0_3px_rgba(15,143,111,0.12)]"
                : "text-muted-foreground hover:bg-card hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}