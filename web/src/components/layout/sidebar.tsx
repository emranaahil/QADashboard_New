"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Monitor,
  Search,
  Radar,
  Link2,
  History,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ui-testing", label: "UI Testing", icon: Monitor },
  { href: "/seo-testing", label: "SEO Testing", icon: Search },
  { href: "/keyword-radar", label: "Keyword Radar", icon: Radar },
  { href: "/link-radar", label: "Link Radar", icon: Link2 },
  { href: "/history", label: "History", icon: History },
  { href: "/reports", label: "Reports", icon: FileText },
];

type SidebarProps = {
  mobileOpen?: boolean;
  onNavigate?: () => void;
};

export function Sidebar({ mobileOpen = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen w-[280px] shrink-0 -translate-x-full flex-col border-r border-border px-4 py-6 transition-transform duration-250 ease-out lg:sticky lg:translate-x-0",
        "bg-[rgba(7,26,18,0.75)] backdrop-blur-[14px]",
        mobileOpen && "translate-x-0"
      )}
      aria-label="Main navigation"
    >
      <div className="mb-3 inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-primary text-[10px] font-bold">
          QA
        </div>
        <span className="text-sm font-semibold tracking-tight">QA Dashboard</span>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-[14px] border px-3.5 py-3 text-sm font-medium transition-all duration-250",
                active
                  ? "gradient-primary border-transparent text-white shadow-md"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}