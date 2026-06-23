# TODO - Playwright visual QA highlight refactor

## Step 1
- Inspect current highlight utilities and detection blocks in `uiChecksFull.js`.

## Step 2 (planned changes)
- Add `window.__qa_clearHighlights()` and Node helper `clearHighlights(page)`.
- Clear highlights before each specified detection block.

## Step 3
- Ensure each issue screenshot contains ONLY that block’s highlights.

## Step 4
- Implement Low Color Contrast highlighting with **yellow borders**.

## Step 5
- Clear highlights before `final-*.png`.

## Step 6
- Keep report generation, issue counts, screenshot naming, and severity levels unchanged.

## Step 7
- Run a quick test to validate screenshots and final.png are clean.

