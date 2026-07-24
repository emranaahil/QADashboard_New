/**
 * Local-only parallel module execution.
 * Production stays single-job unless QA_PARALLEL_MODULES=1 is explicitly set.
 */

function isParallelExecutionEnabled() {
  if (process.env.QA_PARALLEL_MODULES === '0') return false;
  if (process.env.QA_PARALLEL_MODULES === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

module.exports = {
  isParallelExecutionEnabled
};