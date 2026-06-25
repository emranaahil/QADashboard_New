import { LinkedInIcon } from "@/components/ui/linkedin-icon";
import { AUTHOR } from "@/lib/author";

export function AuthorSidebarCredit() {
  return (
    <div className="shrink-0 border-t border-border pt-3">
      <a
        href={AUTHOR.linkedInUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${AUTHOR.name}'s LinkedIn profile`}
        className="group flex items-center gap-2 rounded-[12px] border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-card"
      >
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-semibold text-foreground">{AUTHOR.name}</p>
          <p className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
            <span>{AUTHOR.title}</span>
            <LinkedInIcon className="h-3 w-3 shrink-0 text-[#0A66C2] transition-opacity group-hover:opacity-80" />
          </p>
        </div>
      </a>
    </div>
  );
}