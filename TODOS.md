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

**Remaining test coverage (~35 gaps)**
- **Priority:** P2
- **What:** Route handler tests (phone.ts, billing.ts, users.ts), Clerk webhook tests (create/update/delete), SignalWire/Twilio webhook tests, phone service tests (provisionNumber, sendSms, releaseNumber), auth middleware tests.
- **Why:** billing.ts and auth.ts are now tested, but route handlers and webhook flows still have zero coverage. Edge cases in these layers (malformed input, concurrent requests, partial failures) are untested.
- **Fix:** Write vitest test files following existing patterns (mock DB + providers, test each handler). Prioritize: Clerk webhook > phone routes > billing routes.
- **Effort:** M (~45 min CC)
- **Found by:** /plan-eng-review, 2026-04-05

**Replace long-poll with pg LISTEN/NOTIFY or SSE**
- **Priority:** P3
- **What:** The message poll endpoint (GET /v1/phone/messages/poll) queries the DB every 2 seconds per active user. Works now, but at 50+ concurrent pollers that's 25 queries/sec just for polling.
- **Why:** Scaling concern. DB polling won't keep up with growth.
- **Fix:** Use PostgreSQL LISTEN/NOTIFY to push new messages to the API server, then relay via SSE or WebSocket to clients. Eliminates per-poll DB queries entirely.
- **Effort:** M (~30 min CC)
- **Found by:** /plan-eng-review, 2026-04-05

**Add rate limiting**
- **Priority:** P2
- **What:** No rate limiting on any endpoint. Webhook endpoints are unauthenticated. API key creation has no per-user cap.
- **Why:** Abuse protection. A compromised key can create unlimited additional keys. Unauthenticated endpoints (webhooks, health) can be hammered.
- **Fix:** Add Hono rate-limit middleware. Per-IP for unauthenticated routes, per-userId for authenticated. Consider hono-rate-limiter package.
- **Effort:** S (~15 min CC)
- **Found by:** /plan-eng-review outside voice, 2026-04-05

**Fix upgrade subscription race condition**
- **Priority:** P2
- **What:** upgradeSubscription() writes plan to local DB immediately after Stripe API call. If the DB write fails but Stripe succeeds, user is billed for pro but gated at starter limits. The webhook handler doesn't reconcile the plan from Stripe's subscription items.
- **Why:** Data consistency. The webhook should be the source of truth for plan, not the inline DB write.
- **Fix:** Either make the webhook handler read the plan from Stripe subscription items, or add a retry/reconciliation mechanism for the inline write. Webhook-as-source-of-truth is the cleaner approach.
- **Effort:** S (~20 min CC)
- **Found by:** /plan-eng-review outside voice, 2026-04-05

**Handle null/empty providerSid in unique index**
- **Priority:** P3
- **What:** sms_messages has a unique index on provider_sid. If a provider webhook arrives with an empty messageSid (parsed to empty string ''), the second such message gets silently dropped by onConflictDoNothing.
- **Why:** Data loss. Real messages could be dropped if the provider doesn't reliably include a message ID.
- **Fix:** Generate a fallback UUID when providerSid is empty/null in handleIncomingSms. Or change onConflictDoNothing to only trigger on non-empty providerSid.
- **Effort:** S (~10 min CC)
- **Found by:** /plan-eng-review outside voice, 2026-04-05

## Completed

<!-- Items completed in a PR will be moved here with: **Completed:** vX.Y.Z (YYYY-MM-DD) -->
