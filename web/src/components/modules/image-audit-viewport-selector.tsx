"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  MAX_AUDIT_VIEWPORTS,
  VIEWPORT_PRESETS,
  collectViewportsForRun,
  parseCustomViewport,
  serializeViewportsForApi,
  validateViewportsForRun,
  type AuditViewport,
} from "@/lib/image-audit-viewports";

export type ImageAuditViewportSelectorHandle = {
  getViewportsForRun: () => ReturnType<typeof serializeViewportsForApi> | null;
};

type ImageAuditViewportSelectorProps = {
  selectedKeys: string[];
  onSelectedKeysChange: (keys: string[]) => void;
  customViewports: AuditViewport[];
  onCustomViewportsChange: (viewports: AuditViewport[]) => void;
  disabled?: boolean;
};

export const ImageAuditViewportSelector = forwardRef<
  ImageAuditViewportSelectorHandle,
  ImageAuditViewportSelectorProps
>(function ImageAuditViewportSelector(
  {
    selectedKeys,
    onSelectedKeysChange,
    customViewports,
    onCustomViewportsChange,
    disabled = false,
  },
  ref
) {
  const [customLabel, setCustomLabel] = useState("");
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const pendingViewport = useMemo(
    () => parseCustomViewport(customWidth, customHeight, customLabel),
    [customWidth, customHeight, customLabel]
  );

  const totalSelected = useMemo(() => {
    const collected = collectViewportsForRun(selectedKeys, customViewports, pendingViewport);
    return collected.length;
  }, [selectedKeys, customViewports, pendingViewport]);

  const togglePreset = (key: string, event?: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event?.preventDefault();
    event?.stopPropagation();

    if (selectedSet.has(key)) {
      onSelectedKeysChange(selectedKeys.filter((item) => item !== key));
      return;
    }

    const nextCount = collectViewportsForRun(
      [...selectedKeys, key],
      customViewports,
      pendingViewport
    ).length;
    if (nextCount > MAX_AUDIT_VIEWPORTS) {
      toast.error(`Maximum ${MAX_AUDIT_VIEWPORTS} viewports allowed`);
      return;
    }

    onSelectedKeysChange([...selectedKeys, key]);
  };

  const addCustomViewport = (opts?: { silent?: boolean }) => {
    const parsed = parseCustomViewport(customWidth, customHeight, customLabel);
    if (!parsed) {
      if (!opts?.silent) {
        toast.error("Enter width and height between 1 and 3840");
      }
      return false;
    }

    const existing = collectViewportsForRun(selectedKeys, customViewports, null);
    if (existing.some((vp) => vp.key === parsed.key)) {
      if (!opts?.silent) {
        toast.error("Viewport already selected");
      }
      return false;
    }

    const nextCount = existing.length + 1;
    if (nextCount > MAX_AUDIT_VIEWPORTS) {
      if (!opts?.silent) {
        toast.error(`Maximum ${MAX_AUDIT_VIEWPORTS} viewports allowed`);
      }
      return false;
    }

    onCustomViewportsChange([...customViewports, parsed]);

    setCustomLabel("");
    setCustomWidth("");
    setCustomHeight("");

    if (!opts?.silent) {
      toast.success(`Added viewport ${parsed.label}`);
    }
    return true;
  };

  const removeCustomViewport = (index: number) => {
    const removed = customViewports[index];
    onCustomViewportsChange(customViewports.filter((_, i) => i !== index));
    if (removed) {
      onSelectedKeysChange(selectedKeys.filter((key) => key !== removed.key));
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      getViewportsForRun: () => {
        const viewports = collectViewportsForRun(selectedKeys, customViewports, pendingViewport);
        const error = validateViewportsForRun(viewports);
        if (error) {
          toast.error(error);
          return null;
        }
        return serializeViewportsForApi(viewports);
      },
    }),
    [selectedKeys, customViewports, pendingViewport]
  );

  const presetKeys = new Set(VIEWPORT_PRESETS.map((vp) => vp.key));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-muted-foreground">Viewports</label>
          <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[0.68rem] font-medium text-muted-foreground">
            {totalSelected} selected · max {MAX_AUDIT_VIEWPORTS}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {VIEWPORT_PRESETS.map((viewport) => {
            const active = selectedSet.has(viewport.key);
            return (
              <button
                key={viewport.key}
                type="button"
                disabled={disabled}
                onClick={(e) => togglePreset(viewport.key, e)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background-elevated text-muted-foreground hover:border-primary/40"
                )}
                title={`${viewport.width}×${viewport.height}`}
              >
                {viewport.label}
              </button>
            );
          })}
          {customViewports.map((viewport, index) => (
            <span
              key={`${viewport.key}-${index}`}
              className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium"
            >
              {viewport.label}
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeCustomViewport(index)}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${viewport.label}`}
              >
                ×
              </button>
            </span>
          ))}
          {pendingViewport &&
          !customViewports.some((vp) => vp.key === pendingViewport.key) &&
          !presetKeys.has(pendingViewport.key) ? (
            <span className="inline-flex items-center rounded-lg border border-dashed border-primary/60 bg-primary/5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {pendingViewport.label} — will run on start
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[0.7rem] text-muted-foreground">
          Each selected viewport loads every page at that size. More viewports increase runtime.
        </p>
        {totalSelected > 1 ? (
          <p className="mt-1 text-[0.7rem] text-amber-500">
            Multiple viewports multiply audit time — one viewport is fastest for full-site scans.
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Custom viewport</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_88px_88px_auto]">
          <Input
            placeholder="Label (optional)"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            disabled={disabled}
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomViewport();
              }
            }}
          />
          <Input
            type="number"
            placeholder="Width"
            value={customWidth}
            onChange={(e) => setCustomWidth(e.target.value)}
            disabled={disabled}
            className="h-9 text-sm"
            min={1}
            max={3840}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomViewport();
              }
            }}
          />
          <Input
            type="number"
            placeholder="Height"
            value={customHeight}
            onChange={(e) => setCustomHeight(e.target.value)}
            disabled={disabled}
            className="h-9 text-sm"
            min={1}
            max={3840}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomViewport();
              }
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => addCustomViewport()}
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium hover:border-primary/40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
});