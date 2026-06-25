import { LinkedInIcon } from "@/components/ui/linkedin-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTHOR } from "@/lib/author";

export function AboutPlatformCard() {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-2">
        <CardTitle>About this platform</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-5 pt-0 text-sm text-muted-foreground">
        <p className="max-w-2xl">
          QA Dashboard centralizes UI testing, SEO audits, keyword scans, and link health checks —
          built for fast, reliable quality workflows.
        </p>
        <p className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span>Designed &amp; developed by</span>
          <span className="font-semibold text-foreground">{AUTHOR.name}</span>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span>{AUTHOR.title}</span>
            <a
              href={AUTHOR.linkedInUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${AUTHOR.name}'s LinkedIn profile`}
              className="inline-flex items-center text-[#0A66C2] transition-opacity hover:opacity-80"
            >
              <LinkedInIcon className="h-3.5 w-3.5" />
            </a>
          </span>
        </p>
      </CardContent>
    </Card>
  );
}