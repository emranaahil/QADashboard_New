import { LinkedInIcon } from "@/components/ui/linkedin-icon";
import { AUTHOR } from "@/lib/author";

export function AuthorTopBarCredit() {
  return (
    <a
      href={AUTHOR.linkedInUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${AUTHOR.name}'s LinkedIn profile`}
      className="hidden items-center gap-1.5 rounded-full border border-border/80 bg-card/50 px-2.5 py-1 text-[11px] leading-none text-muted-foreground transition-colors hover:border-[rgba(29,191,115,0.35)] hover:text-foreground sm:inline-flex"
    >
      <span className="font-medium text-foreground">{AUTHOR.name}</span>
      <span aria-hidden="true" className="opacity-50">
        ·
      </span>
      <span className="hidden md:inline">{AUTHOR.title}</span>
      <LinkedInIcon className="h-3 w-3 shrink-0 text-[#0A66C2]" />
    </a>
  );
}