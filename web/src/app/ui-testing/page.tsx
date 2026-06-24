"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { UiTestingWorkspace } from "@/components/modules/ui-testing-workspace";
import { UiTestingHistoryPanel } from "@/components/modules/ui-testing-history";
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { api, type Job, type UiTestingHistoryItem } from "@/lib/api";
import { toast } from "sonner";

const MODE_OPTIONS = [
  { value: "single" as const, label: "Single Page" },
  { value: "full" as const, label: "Full Website" },
];

function UiTestPanel({
  mode,
  onModeChange,
  historyRefreshKey,
  onHistoryRefresh,
}: {
  mode: "single" | "full";
  onModeChange: (mode: "single" | "full") => void;
  historyRefreshKey: number;
  onHistoryRefresh: () => void;
}) {
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const testType = mode === "full" ? "full-website" : "single-page";

  const handleSelectReport = useCallback(async (item: UiTestingHistoryItem) => {
    try {
      const { job } = await api.getJob(item.moduleId, item.id);
      setHistoryJob(job);
      setSelectedHistoryId(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  return (
    <div className="ui-testing-stack flex w-full flex-col gap-6">
      <UiTestingWorkspace
        mode={mode}
        onHistoryRefresh={onHistoryRefresh}
        historyJob={historyJob}
        onHistoryJobClear={() => {
          setHistoryJob(null);
          setSelectedHistoryId(null);
        }}
      />

      <UiTestingHistoryPanel
        testType={testType}
        onTestTypeChange={(type) => onModeChange(type === "full-website" ? "full" : "single")}
        onSelectReport={handleSelectReport}
        refreshKey={historyRefreshKey}
        selectedJobId={selectedHistoryId}
      />
    </div>
  );
}

export default function UiTestingPage() {
  const [mode, setMode] = useState<"single" | "full">("single");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const refreshHistory = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  return (
    <AppShell title="UI Testing" subtitle="Single page and full website visual QA">
      <div className="ui-testing-page mx-auto w-full max-w-[1100px] px-0 md:px-6">
        <div className="mb-6 flex justify-center">
          <UiTestingSegmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            aria-label="Test mode"
          />
        </div>

        {mode === "single" ? (
          <UiTestPanel
            key="single"
            mode="single"
            onModeChange={setMode}
            historyRefreshKey={historyRefreshKey}
            onHistoryRefresh={refreshHistory}
          />
        ) : (
          <UiTestPanel
            key="full"
            mode="full"
            onModeChange={setMode}
            historyRefreshKey={historyRefreshKey}
            onHistoryRefresh={refreshHistory}
          />
        )}
      </div>
    </AppShell>
  );
}