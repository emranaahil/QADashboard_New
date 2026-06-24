"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { openJobReport } from "@/lib/report";

type Report = {
  id: string;
  title?: string;
  moduleId: string;
  moduleName: string;
  generatedAt?: string;
  hasHtml?: boolean;
};

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("qa:pinned-reports");
    if (stored) try { setPinned(JSON.parse(stored)); } catch { /* ignore */ }
    api
      .getReportsCenter({ limit: 100 })
      .then((data) => setReports(data.reports || []))
      .finally(() => setLoading(false));
  }, []);

  const togglePin = (key: string) => {
    const next = pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
    setPinned(next);
    localStorage.setItem("qa:pinned-reports", JSON.stringify(next));
    toast.success(pinned.includes(key) ? "Unpinned" : "Pinned");
  };

  const openReport = (r: Report) => {
    if (r.id.startsWith("job:")) {
      openJobReport(r.moduleId, r.id.replace("job:", ""));
      return;
    }
    window.open(api.jobReportUrl(r.moduleId, r.id), "_blank", "noopener,noreferrer");
  };

  const renderList = (list: Report[]) => (
    <div className="flex flex-col gap-2">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reports in this view.</p>
      ) : (
        list.map((r) => {
          const key = `${r.moduleId}:${r.id}`;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 transition-colors duration-150 hover:bg-elevated/60"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{r.title || r.id}</p>
                <p className="text-xs text-muted-foreground">
                  {r.moduleName} · {r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {r.hasHtml && (
                  <Button size="sm" onClick={() => openReport(r)}>
                    Open
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => togglePin(key)}>
                  {pinned.includes(key) ? "Unpin" : "Pin"}
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <AppShell title="Reports Center" subtitle="Recent, pinned, and favorite reports">
      <div className="mx-auto max-w-4xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Reports</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full rounded-lg" />
            ) : (
              <Tabs defaultValue="recent">
                <TabsList>
                  <TabsTrigger value="recent">Recent</TabsTrigger>
                  <TabsTrigger value="pinned">Pinned</TabsTrigger>
                </TabsList>
                <TabsContent value="recent">{renderList(reports)}</TabsContent>
                <TabsContent value="pinned">
                  {renderList(reports.filter((r) => pinned.includes(`${r.moduleId}:${r.id}`)))}
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}