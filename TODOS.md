# TODOS

## Dashboard / UI

**Focus management on section transitions**
- **Priority:** P2
- **What:** When `show()` switches between dashboard sections (loading → auth → pricing → dashboard), keyboard focus isn't moved to the new section. Screen reader users don't know the content changed.
- **Why:** Accessibility gap — keyboard and screen reader navigation breaks during multi-step flows.
- **Fix:** One line in `show()` in `dashboard.html`:
  ```js
  document.getElementById(id)?.querySelector('h1, h2, button')?.focus();
  ```
- **Effort:** S (< 30 min)
- **Found by:** /plan-design-review, 2026-04-04

## Completed

<!-- Items completed in a PR will be moved here with: **Completed:** vX.Y.Z (YYYY-MM-DD) -->
