"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { VisualTwinWorkspace } from "@/components/modules/visual-twin-workspace";
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteReportButton } from "@/components/execution/delete-report-button";
import { api, type Job } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";

const MODE_OPTIONS = [
  { value: "single" as const, label: "Single Page" },
  { value: "full" as const, label: "Full Website" },
];

const MODULE_ID = "visual-twin";

type HistoryItem = {
  id: string;
  url: string;
  status: string;
  createdAt?: string;
  completedAt?: string;
  reportAvailable?: boolean;
  options?: { candidateUrl?: string; mode?: string };
};

export default function VisualTwinPage() {
  const [mode, setMode] = useState<"single" | "full">("single");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const refreshHistory = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.getHistory({ moduleId: MODULE_ID, limit: 40 });
      const items =
        (res as { items?: HistoryItem[] }).items ||
        (Array.isArray(res) ? (res as HistoryItem[]) : []);
      setHistory(items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, historyRefreshKey]);

  const handleSelect = async (item: HistoryItem) => {
    try {
      const { job } = await api.getJob(MODULE_ID, item.id);
      setHistoryJob(job);
      setSelectedHistoryId(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load job");
    }
  };

  return (
    <AppShell
      title="Visual Twin"
      subtitle="Compare reference site vs clone — headings, text, images, layout"
    >
      <div className="ui-testing-page mx-auto w-full max-w-[1100px] px-0 md:px-6">
        <div className="mb-6 flex justify-center">
          <UiTestingSegmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            aria-label="Compare mode"
          />
        </div>

        <div className="flex w-full flex-col gap-6">
          <VisualTwinWorkspace
            key={mode}
            mode={mode}
            onHistoryRefresh={refreshHistory}
            historyJob={historyJob}
            onHistoryJobClear={() => {
              setHistoryJob(null);
              setSelectedHistoryId(null);
            }}
          />

          <Card className="rounded-[20px] border-border">
            <CardHeader>
              <CardTitle className="text-base">Recent Visual Twin runs</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-4 pt-0">
              {historyLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : history.length ? (
                history.map((r) => (
                  <div
                    key={r.id}
                    className={cn(
                      "flex items-start gap-1 rounded-lg border px-2 py-2 transition-colors",
                      selectedHistoryId === r.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelect(r)}
                      className="min-w-0 flex-1 px-1 text-left text-xs"
                    >
                      <span className="block break-all font-medium">{r.url}</span>
                      {r.options?.candidateUrl ? (
                        <span className="mt-0.5 block break-all text-[0.7rem] text-muted-foreground">
                          vs {r.options.candidateUrl}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">
                        {formatDateTime(r.completedAt || r.createdAt || "")} · {r.status}
                      </span>
                    </button>
                    <DeleteReportButton
                      moduleId={MODULE_ID}
                      reportId={r.id}
                      label=""
                      className="px-2"
                      onDeleted={() => {
                        if (selectedHistoryId === r.id) {
                          setHistoryJob(null);
                          setSelectedHistoryId(null);
                        }
                        void loadHistory();
                      }}
                    />
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No runs yet. Compare a reference URL against a candidate clone.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
