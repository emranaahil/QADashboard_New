"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type DevicePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

export type CustomDevice = {
  name: string;
  width: number;
  height: number;
};

export type PendingCustomDevice = {
  name: string;
  width: string;
  height: string;
};

export type DeviceSelectorHandle = {
  getDevicesForRun: () => Array<string | CustomDevice> | null;
};

type DeviceSelectorProps = {
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  customDevices: CustomDevice[];
  onCustomDevicesChange: (devices: CustomDevice[]) => void;
  disabled?: boolean;
  showMultiDeviceWarning?: boolean;
  compact?: boolean;
};

export function parsePendingCustomDevice(pending: PendingCustomDevice): CustomDevice | null {
  const name = pending.name.trim();
  const width = Number(pending.width);
  const height = Number(pending.height);
  if (!name || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return { name, width: Math.round(width), height: Math.round(height) };
}

export function buildDeviceOptions(
  selectedIds: string[],
  customDevices: CustomDevice[],
  pending?: PendingCustomDevice | null
): Array<string | CustomDevice> {
  const preset = selectedIds.filter(Boolean);
  const items = [...preset, ...customDevices];
  const parsed = pending ? parsePendingCustomDevice(pending) : null;
  if (parsed) {
    const exists = customDevices.some(
      (d) => d.name === parsed.name && d.width === parsed.width && d.height === parsed.height
    );
    if (!exists) items.push(parsed);
  }
  return items;
}

export const DeviceSelector = forwardRef<DeviceSelectorHandle, DeviceSelectorProps>(
  function DeviceSelector(
    {
      selectedIds,
      onSelectedIdsChange,
      customDevices,
      onCustomDevicesChange,
      disabled = false,
      showMultiDeviceWarning = false,
      compact = false,
    },
    ref
  ) {
    const [catalog, setCatalog] = useState<DevicePreset[]>([]);
    const [customOpen, setCustomOpen] = useState(false);
    const [customName, setCustomName] = useState("");
    const [customWidth, setCustomWidth] = useState("");
    const [customHeight, setCustomHeight] = useState("");

    const pending = useMemo(
      () => ({ name: customName, width: customWidth, height: customHeight }),
      [customName, customWidth, customHeight]
    );

    useEffect(() => {
      const portraitOnly = (devices: DevicePreset[]) =>
        devices
          .filter(
            (device) =>
              !device.id.toLowerCase().includes("landscape") &&
              !/landscape/i.test(device.label)
          )
          .map((device) => ({
            ...device,
            label: device.label.replace(/\s*Portrait\s*/gi, "").trim() || device.label,
          }));

      api
        .getDevices()
        .then((res) => setCatalog(portraitOnly(res.devices || [])))
        .catch(() => {
          setCatalog([{ id: "desktop", label: "Desktop", width: 1440, height: 900 }]);
        });
    }, []);

    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const pendingDevice = parsePendingCustomDevice(pending);
    const totalSelected =
      selectedIds.length + customDevices.length + (pendingDevice ? 1 : 0);

    const toggleDevice = (id: string, event?: MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      event?.preventDefault();
      event?.stopPropagation();
      onSelectedIdsChange(
        selectedIds.includes(id)
          ? selectedIds.filter((deviceId) => deviceId !== id)
          : [...selectedIds, id]
      );
    };

    const addCustomDevice = (opts?: { silent?: boolean }) => {
      const parsed = parsePendingCustomDevice(pending);
      if (!parsed) {
        if (!opts?.silent) {
          toast.error("Enter a device name, width, and height (min 1px each)");
        }
        return false;
      }
      const exists = customDevices.some(
        (d) => d.name === parsed.name && d.width === parsed.width && d.height === parsed.height
      );
      if (!exists) {
        onCustomDevicesChange([...customDevices, parsed]);
      }
      setCustomName("");
      setCustomWidth("");
      setCustomHeight("");
      if (!opts?.silent) {
        toast.success(`Added custom viewport: ${parsed.name} (${parsed.width}×${parsed.height})`);
      }
      return true;
    };

    const removeCustomDevice = (index: number) => {
      onCustomDevicesChange(customDevices.filter((_, i) => i !== index));
    };

    useImperativeHandle(
      ref,
      () => ({
        getDevicesForRun: () => {
          const devices = buildDeviceOptions(selectedIds, customDevices, pending);
          if (!devices.length) {
            toast.error("Select at least one device or enter a custom viewport");
            return null;
          }
          return devices;
        },
      }),
      [selectedIds, customDevices, pending]
    );

    return (
      <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Devices</label>
            <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[0.68rem] font-medium text-muted-foreground">
              {totalSelected} selected
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {catalog.map((device) => {
              const active = selectedSet.has(device.id);
              return (
                <button
                  key={device.id}
                  type="button"
                  disabled={disabled}
                  onClick={(e) => toggleDevice(device.id, e)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background-elevated text-muted-foreground hover:border-primary/40"
                  )}
                  title={`${device.width}×${device.height}`}
                >
                  {device.label}
                </button>
              );
            })}
            {customDevices.map((device, index) => (
              <span
                key={`${device.name}-${index}`}
                className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium"
              >
                {device.name} ({device.width}×{device.height})
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeCustomDevice(index)}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${device.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            {pendingDevice &&
            !customDevices.some(
              (d) =>
                d.name === pendingDevice.name &&
                d.width === pendingDevice.width &&
                d.height === pendingDevice.height
            ) ? (
              <span className="inline-flex items-center rounded-lg border border-dashed border-primary/60 bg-primary/5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {pendingDevice.name} ({pendingDevice.width}×{pendingDevice.height}) — will run on start
              </span>
            ) : null}
          </div>
          {!compact ? (
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              Each selected device runs at its own viewport during the test.
            </p>
          ) : null}
          {showMultiDeviceWarning && totalSelected > 1 ? (
            <p className="mt-1 text-[0.7rem] text-amber-500">
              Multiple devices increase runtime — one device is more reliable for full-site scans.
            </p>
          ) : null}
        </div>

        <div className={compact ? "border-t border-border/60 pt-2" : ""}>
          {compact ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCustomOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <span>Custom viewport</span>
              <span className="text-[0.65rem] font-normal">{customOpen ? "Hide" : "Add"}</span>
            </button>
          ) : (
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Custom viewport</p>
          )}
          {(!compact || customOpen) && (
          <div className={cn("grid gap-2 sm:grid-cols-[1fr_88px_88px_auto]", compact ? "mt-1.5" : "")}>
            <Input
              placeholder="Device name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              disabled={disabled}
              className="h-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomDevice();
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomDevice();
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomDevice();
                }
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => addCustomDevice()}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium hover:border-primary/40"
            >
              Add
            </button>
          </div>
          )}
        </div>
      </div>
    );
  }
);