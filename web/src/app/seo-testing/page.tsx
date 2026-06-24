"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SeoTestingWorkspace } from "@/components/modules/seo-testing-workspace";
import { SeoTestingHistoryPanel } from "@/components/modules/seo-testing-history";
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { api, type Job, type SeoTestingHistoryItem } from "@/lib/api";
import { toast } from "sonner";

const MODE_OPTIONS = [
  { value: "single" as const, label: "Single Page" },
  { value: "full" as const, label: "Full Website" },
];

function SeoTestPanel({
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

  const handleSelectReport = useCallback(async (item: SeoTestingHistoryItem) => {
    try {
      const { job } = await api.getJob(item.moduleId, item.id);
      setHistoryJob(job);
      setSelectedHistoryId(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  return (
    <div className="seo-testing-stack flex w-full flex-col gap-6">
      <SeoTestingWorkspace
        mode={mode}
        onHistoryRefresh={onHistoryRefresh}
        historyJob={historyJob}
        onHistoryJobClear={() => {
          setHistoryJob(null);
          setSelectedHistoryId(null);
        }}
      />

      <SeoTestingHistoryPanel
        testType={testType}
        onTestTypeChange={(type) => onModeChange(type === "full-website" ? "full" : "single")}
        onSelectReport={handleSelectReport}
        refreshKey={historyRefreshKey}
        selectedJobId={selectedHistoryId}
      />
    </div>
  );
}

export default function SeoTestingPage() {
  const [mode, setMode] = useState<"single" | "full">("single");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const refreshHistory = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  return (
    <AppShell title="SEO Testing" subtitle="Meta tags, structured data, and performance audits">
      <div className="seo-testing-page mx-auto w-full max-w-[1100px] px-0 md:px-6">
        <div className="mb-6 flex justify-center">
          <UiTestingSegmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            aria-label="Test mode"
          />
        </div>

        {mode === "single" ? (
          <SeoTestPanel
            key="single"
            mode="single"
            onModeChange={setMode}
            historyRefreshKey={historyRefreshKey}
            onHistoryRefresh={refreshHistory}
          />
        ) : (
          <SeoTestPanel
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