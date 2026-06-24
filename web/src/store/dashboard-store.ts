import { create } from "zustand";
import type { DashboardStats } from "@/lib/api";

type DashboardStore = {
  stats: DashboardStats | null;
  loading: boolean;
  setStats: (stats: DashboardStats) => void;
  setLoading: (loading: boolean) => void;
  refreshKey: number;
  bumpRefresh: () => void;
};

export const useDashboardStore = create<DashboardStore>((set) => ({
  stats: null,
  loading: true,
  setStats: (stats) => set({ stats, loading: false }),
  setLoading: (loading) => set({ loading }),
  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));