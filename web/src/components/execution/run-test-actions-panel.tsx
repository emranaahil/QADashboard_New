import { PrivacyDisclaimerNotice } from "@/components/layout/privacy-disclaimer-notice";
import { cn } from "@/lib/utils";

type RunTestActionsPanelProps = {
  children: React.ReactNode;
  className?: string;
};

/** Privacy notice + primary run/start controls for audit modules. */
export function RunTestActionsPanel({ children, className }: RunTestActionsPanelProps) {
  return (
    <div className={cn("mt-6 flex flex-col items-start gap-3", className)}>
      <PrivacyDisclaimerNotice />
      <div className="run-test-actions flex flex-wrap gap-3">{children}</div>
    </div>
  );
}