import { cn } from "@/lib/utils";

export function Progress({ value = 0, className }: { value?: number; className?: string }) {
  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]",
        className
      )}
    >
      <div
        className="gradient-progress h-full rounded-full transition-all duration-350 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}