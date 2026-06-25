"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { canViewReport, openRunReport } from "@/lib/report";
import {
  buildSearchResults,
  mapRunsToResults,
  matchNavItems,
  type SearchResult,
} from "@/lib/global-search";
import { cn, truncateUrl } from "@/lib/utils";

type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

export function GlobalSearch() {
  const listboxId = useId();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<PanelPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const runSearch = useCallback(async (q: string) => {
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const nav = matchNavItems(q);

    try {
      const history = await api.getHistory({ q, limit: 12 });
      const runs = mapRunsToResults(history.items || []);
      setResults(buildSearchResults(nav, runs));
    } catch (err) {
      setResults(nav);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void runSearch(debouncedQuery);
  }, [debouncedQuery, open, runSearch]);

  useEffect(() => {
    setActiveIndex(results.length ? 0 : -1);
  }, [results]);

  const updatePanelPosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(384, window.innerWidth - 20);
    const left = Math.max(10, Math.min(rect.right - width, window.innerWidth - width - 10));
    setPanelPos({
      top: rect.bottom + 8,
      left,
      width,
    });
  }, []);

  const showPanel = open && (loading || !!debouncedQuery || !!error);

  useLayoutEffect(() => {
    if (!showPanel) {
      setPanelPos(null);
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [showPanel, updatePanelPosition, debouncedQuery, results.length, loading]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      const panel = document.getElementById(listboxId);
      if (panel?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [listboxId]);

  function selectResult(result: SearchResult) {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);

    if (result.kind === "page") {
      router.push(result.href);
      return;
    }

    if (
      result.kind === "run" &&
      canViewReport({
        status: result.status,
        reportAvailable: result.reportAvailable,
      })
    ) {
      openRunReport(result.moduleId, result.id);
      return;
    }

    router.push(result.href);
  }

  function submitQuery() {
    const q = query.trim();
    if (!q) return;
    if (activeIndex >= 0 && results[activeIndex]) {
      selectResult(results[activeIndex]);
      return;
    }
    setOpen(false);
    router.push(`/history?q=${encodeURIComponent(q)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) => (results.length ? (prev + 1) % results.length : -1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) =>
        results.length ? (prev <= 0 ? results.length - 1 : prev - 1) : -1
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitQuery();
    }
  }

  const panelContent = showPanel && panelPos && (
    <div
      id={listboxId}
      role="listbox"
      style={{
        position: "fixed",
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        zIndex: 9999,
      }}
      className="overflow-hidden rounded-[14px] border border-border bg-background-elevated text-foreground shadow-2xl"
    >
      {loading && (
        <div className="px-4 py-3 text-sm text-foreground/80">Searching…</div>
      )}

      {!loading && error && (
        <div className="border-b border-border px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!loading && !results.length && debouncedQuery && (
        <div className="px-4 py-3 text-sm text-foreground/80">
          No results for &ldquo;{debouncedQuery}&rdquo;. Press Enter to view history.
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="max-h-80 overflow-auto py-1">
          {results.map((result, index) => (
            <li key={`${result.kind}-${result.id}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                  index === activeIndex ? "bg-primary/20" : "hover:bg-primary/12"
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectResult(result)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {result.kind === "run" ? truncateUrl(result.label, 42) : result.label}
                  </p>
                  <p className="truncate text-xs text-foreground/70">{result.description}</p>
                </div>
                {result.kind === "run" && (
                  <Badge variant={statusBadgeVariant(result.status)} className="shrink-0">
                    {result.status}
                  </Badge>
                )}
                {result.kind === "page" && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Page
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {debouncedQuery && (
        <div className="border-t border-border bg-[#081a13] px-4 py-2 text-xs text-foreground/75">
          Press Enter to search history for &ldquo;{debouncedQuery}&rdquo;
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search runs, URLs..."
        className="h-10 w-full bg-background-elevated pl-9 text-sm sm:w-56 md:w-64"
        aria-label="Global search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listboxId : undefined}
        aria-autocomplete="list"
      />

      {mounted && panelContent ? createPortal(panelContent, document.body) : null}
    </div>
  );
}