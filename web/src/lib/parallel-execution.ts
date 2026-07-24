/** Local dev: run multiple QA modules concurrently. Production stays single-job. */
export function isParallelExecutionEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_QA_PARALLEL_MODULES === "0") return false;
  if (process.env.NEXT_PUBLIC_QA_PARALLEL_MODULES === "1") return true;
  return process.env.NODE_ENV === "development";
}