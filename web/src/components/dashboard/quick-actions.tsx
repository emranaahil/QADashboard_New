"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useExecutionStore } from "@/store/execution-store";

export function QuickActions() {
  const router = useRouter();
  const [url, setUrl] = useState("https://example.com");

  const status = useExecutionStore((s) => s.status);
  const moduleId = useExecutionStore((s) => s.moduleId);
  const progress = useExecutionStore((s) => s.progress);
  const message = useExecutionStore((s) => s.message);
  const isCancelling = useExecutionStore((s) => s.isCancelling);
  const startJob = useExecutionStore((s) => s.startJob);
  const cancelJob = useExecutionStore((s) => s.cancelJob);

  const globalRunning = status === "running" || isCancelling;
  const uiRunning = globalRunning && moduleId === "ui-check";
  const seoRunning = globalRunning && moduleId === "seo";

  const handleUiTest = () => {
    startJob({
      moduleId: "ui-check",
      url,
      options: { devices: ["desktop"], browser: "chrome" },
      source: "quick_actions",
      successMessage: "UI Test completed successfully",
    });
  };

  const handleSeoTest = () => {
    startJob({
      moduleId: "seo",
      url,
      options: { mode: "single" },
      source: "quick_actions",
      successMessage: "SEO Test completed successfully",
    });
  };

  return (
    <Card className="w-full lg:w-80">
      <CardHeader className="pb-3">
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            aria-label="Test URL"
            disabled={globalRunning}
          />
        </div>

        <Button
          className="w-full"
          loading={uiRunning && !isCancelling}
          disabled={globalRunning && !uiRunning}
          onClick={handleUiTest}
        >
          {uiRunning ? "Running…" : "Run UI Test"}
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={seoRunning && !isCancelling}
          disabled={globalRunning && !seoRunning}
          onClick={handleSeoTest}
        >
          {seoRunning ? "Running…" : "Run SEO Test"}
        </Button>

        {globalRunning && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">{progress}% · {moduleId}</p>
            {message && <p className="truncate text-xs text-muted-foreground">{message}</p>}
            <Button variant="cancel" size="sm" loading={isCancelling} disabled={isCancelling} onClick={cancelJob}>
              {isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            router.push("/history");
            toast.info("Opening execution history");
          }}
        >
          View History
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            router.push("/reports");
            toast.info("Opening reports center");
          }}
        >
          Reports Center
        </Button>
      </CardContent>
    </Card>
  );
}