/**
 * Crawl/discovery settings — independent of deployment env.
 * Tuned for low-RAM production hosts (~512 MB).
 */
module.exports = {
  maxDepth: 5,
  maxUrls: 5000,
  timeoutMs: 30000,
  gotoRetries: 1,

  normalizePathCase: true,

  preservePaginationQuery: true,
  paginationQueryKeys: ['page', 'p', 'offset', 'start'],
  maxPaginationVariantsPerPath: 25,

  postGotoWaitMs: 0,
  boundedScrollSteps: 0,
  scrollStepPx: 600,

  maxLinksPerPage: 2000,
  maxPagesToScan: 5000,

  logUrlListMax: 50
};