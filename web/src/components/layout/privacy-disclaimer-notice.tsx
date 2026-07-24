"use client";

import { ShieldCheck } from "lucide-react";
import { LinkedInIcon } from "@/components/ui/linkedin-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AUTHOR } from "@/lib/author";
import { cn } from "@/lib/utils";

const SUMMARY =
  "We do not keep permanent accounts or long-term storage of your audits. Closing the browser or refreshing the page ends your session and clears that run's data from this tool.";

function NoticeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 rounded-[10px] border border-[rgba(29,191,115,0.12)] bg-[rgba(7,26,18,0.35)] px-3 py-2.5">
      <h3 className="text-[0.65rem] font-bold uppercase tracking-wider text-[#86efac]">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-[#c5d4ce]">{children}</div>
    </section>
  );
}

export function PrivacyDisclaimerNotice() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          id="privacy-disclaimer"
          className={cn(
            "inline-flex w-fit max-w-full items-center gap-1.5 rounded-[10px] border px-2 py-1 text-left shadow-[0_2px_10px_rgba(0,0,0,0.12)]",
            "border-[rgba(29,191,115,0.22)]",
            "bg-gradient-to-br from-[rgba(15,143,111,0.12)] via-[rgba(7,26,18,0.5)] to-[rgba(29,191,115,0.06)]",
            "text-[#d8e8e0] transition-all duration-200 hover:border-[rgba(29,191,115,0.4)] hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(29,191,115,0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#071a12]"
          )}
        >
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[rgba(29,191,115,0.16)] text-[#86efac] ring-1 ring-[rgba(29,191,115,0.28)]">
            <ShieldCheck className="h-2.5 w-2.5" aria-hidden />
          </span>
          <span className="whitespace-nowrap text-[0.7rem] font-semibold tracking-tight text-[#ecfdf5]">
            Privacy &amp; disclaimer
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[min(88vh,720px)] overflow-hidden">
        <div className="privacy-dialog-scroll max-h-[min(88vh,720px)] overflow-y-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(29,191,115,0.18)] text-[#86efac] ring-1 ring-[rgba(29,191,115,0.35)]">
                <ShieldCheck className="h-4 w-4" aria-hidden />
              </span>
              Privacy &amp; disclaimer
            </DialogTitle>
            <DialogDescription className="rounded-[10px] bg-[rgba(29,191,115,0.08)] px-3 py-2.5 ring-1 ring-[rgba(29,191,115,0.15)]">
              {SUMMARY}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <NoticeSection title="Data handling">
              <ul className="list-disc space-y-1.5 pl-5 marker:text-[#1dbf73]">
                <li>No login or user account is required. Access is tied to a temporary browser session only.</li>
                <li>
                  When you refresh the page or close the browser, your session ends and reports/logs for that session
                  are removed from this service.
                </li>
                <li>URLs and pages you submit are processed only to generate your audit result for that session.</li>
                <li>This tool does not sell your data or build a long-term profile of the sites you test.</li>
              </ul>
            </NoticeSection>

            <NoticeSection title="Your responsibility">
              <ul className="list-disc space-y-1.5 pl-5 marker:text-[#1dbf73]">
                <li>Use this tool only on websites you own or are authorized to test.</li>
                <li>
                  Results are automated and provided &ldquo;as is&rdquo; for QA / educational purposes — they are not
                  legal, security, or compliance certification.
                </li>
                <li>
                  The author and operators are not liable for damages arising from use, misuse, reliance on results,
                  downtime, or data loss after session end.
                </li>
                <li>
                  By starting an audit you confirm you understand that session data is temporary and will not remain
                  available after refresh or browser close.
                </li>
              </ul>
            </NoticeSection>

            <NoticeSection title="Legal note">
              <p>
                This notice is for transparency and does not create a lawyer–client relationship or replace formal legal
                advice in your country.
              </p>
            </NoticeSection>

            <NoticeSection title="Author credit">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>Designed &amp; developed by</span>
                <span className="font-semibold text-[#ecfdf5]">{AUTHOR.name}</span>
                <a
                  href={AUTHOR.linkedInUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${AUTHOR.name}'s LinkedIn profile`}
                  className="inline-flex items-center text-[#0A66C2] transition-opacity hover:opacity-80"
                >
                  <LinkedInIcon className="h-3.5 w-3.5" />
                </a>
              </p>
            </NoticeSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}