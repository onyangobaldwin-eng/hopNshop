# Integrations and credential requirements

## Supabase

Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Server-only Edge Function secrets: `SUPABASE_SERVICE_ROLE_KEY` and any provider credentials. Configure email verification, password recovery redirect URLs, Storage buckets and SMTP in Supabase. Allowlist each app origin in Auth URL Configuration; email-link sign-in and password recovery return to the current origin. The account supports password registration/sign-in, password reset and passwordless email-link sign-in. Test these flows against the configured Supabase project's email templates and redirect allowlist.

## Kenya delivery operations (manual, not deployed)

`supabase/migrations/202611120008_hybrid_delivery_core.sql` adds resale delivery localities, couriers, expiring KES rate cards, product shipping dimensions, approved supplier delivery terms, order fulfilments, hub intake/inspection, parcels, tracking, proof, attempts, returns, expenses, audit records, and owner-checked fee/return RPCs. Apply it only after migrations `202611120001` through `202611120007`, in a reviewed/test project first. This migration has not been run against PostgreSQL or applied to the connected Supabase project; no Supabase CLI or local PostgreSQL validator is available in this environment.

No courier provider, API endpoint, service area, cost or credential is configured. The admin/fulfilment panel uses manual tracking and will not expose checkout coverage until staff configure verified areas, active service, a current expiring rate, and product weight/dimensions. The rate source and expiry are required. Courier API status remains manual. Configure only actual partner-approved service areas and prices; all 47 counties are initially inactive and no county-wide coverage is implied.

The checkout RPC enforces KES because the delivery rate cards are KES-only, recalculates the fee server-side, validates current serviceability and dimensions, and creates a pending resale order. Manual M-Pesa verification is still required for the exact order total. A fee change is allowed only before payment activity and requires customer approval. Post-payment surcharge collection and STK Push are not implemented. Affiliate checkouts remain external; personal-sourcing quotation orders are not yet integrated with delivery locality capture or parcel routing.

Use the private `delivery-evidence` Storage bucket created by the migration for staff dispatch/receipt evidence. The bucket is restricted to 5 MiB JPEG/PNG/WebP/PDF uploads. Customer read access is limited to proof attached to their own parcels; supplier-side references, inbound shipment records and inspection findings remain staff-only. Shipment tracking notifications currently create in-app notifications; provider email/SMS/push delivery is not connected.

Migration `202611110007_sourcing_image_storage.sql` creates the private `sourcing-request-media` bucket with a 5 MiB limit and JPEG/PNG/WebP types, then scopes object read/write/delete access to the request owner and admin/editor roles. If the bucket already exists with different settings, the migration stops and requires review; it does not overwrite that bucket's configuration. Verify signed uploads and request ownership with separate customer accounts before launch.

Migration `202611110009_product_media_storage.sql` creates a private `product-media` bucket with the same limits. Only admin/editor roles can upload/delete catalogue assets; customers can obtain short-lived image links only for products that are published. Product images require descriptive alt text.

## M-Pesa Daraja

Required after Safaricom approval: consumer key, consumer secret, short code, passkey, callback URL and production/sandbox environment. Store them only as Edge Function secrets. The callback must be registered with Daraja and verified against the expected request/idempotency key. A payment stays pending until an authorized administrator verifies it; transaction codes entered by customers are not proof.

Manual M-Pesa reference submission is available for resale and sourcing orders after the payment-verification migration is applied. Customers enter a transaction code, payer name and exact order total; an administrator or finance user must confirm these against the official M-Pesa statement before the order advances. Configure and publish verified payment instructions separately before asking customers to pay. Manual submissions are untrusted claims, not payment evidence.

## Affiliate programmes

Each partner requires documented approval, tracking rules, geographic eligibility, commission terms, permitted product imagery and an approved tracking URL/feed/API. Admins can store partner/programme details and campaign links. A link can be activated only for an approved programme and published affiliate product; the public click RPC records the click and resolves the HTTPS redirect. Partner-side conversions and commission reconciliation still require approved reporting feeds or statements, which are not configured.

## Smart sourcing engine

Migration `202611120003_sourcing_engine.sql` adds the sourcing task queue, candidate/evaluation history, review approvals, landed-cost history, supplier integration records, staff settings and scheduled-job state. It extends the existing sourcing request and notification tables rather than replacing customer requests, quotations or payment/fulfilment workflows. Apply this migration after all earlier migrations and before deploying the sourcing functions. The user reports that this migration has been applied to production; database-side application and RPC/RLS behavior have not been independently verified.

The customer form stores structured category, brand/model, condition, location and requirements in the existing authenticated request row. A database trigger idempotently enqueues discovery. `AdminSourcingWorkbench` is mounted only for admin/editor roles, and the `sourcing-orchestrator` function independently verifies the caller's Supabase JWT and `has_role` result before allowing staff actions. Customer request inserts never receive the service-role key. Candidate creation, evaluations and price history use a service-only transactional RPC; reviews use the caller's authenticated role and a security-definer database check.

### Optional catalogue provider

The only implemented catalogue adapter is a generic JSON API contract. It performs an HTTPS `GET` to `SUPPLIER_CATALOG_API_URL`, adds a `q` query parameter and sends the token in an Authorization header. The host must exactly match a host in the comma-separated `SUPPLIER_CATALOG_ALLOWED_HOSTS`; redirects are rejected, responses are bounded, listing fields are schema-validated, and only public HTTPS source/image links are retained. The API must return an object containing a `products` array, for example:

```json
{
  "products": [
    {
      "name": "Example product",
      "source_url": "https://shop.example/item",
      "supplier_price": 120,
      "currency": "USD",
      "specifications": { "storage": "256GB" }
    }
  ]
}
```

Use only a supplier API/feed or access method that you are authorized to use. There are no Jumia/Amazon/Alibaba/etc. integrations or credentials in this project. A configured API response is not proof of seller legitimacy, availability, authenticity or a final customer price.

### Optional AI comparison

AI is off by default. It may compare supplied specifications through an OpenAI-compatible `chat/completions` endpoint, but its strict JSON result is advisory and always marked for human review. It cannot certify authenticity, supplier legitimacy or price. If the provider is unavailable or unconfigured, deterministic matching and manual review continue.

### Server secrets and deployment

`supabase/functions/.env.example` lists placeholder names only. Do not copy Edge Function secrets into the Vite `.env`, browser code or a committed file. Configure Edge Function secrets in the Supabase project (or a protected, ignored local CLI env file):

- Required for the orchestrator and worker: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Browser origins allowed to call the staff function: `SOURCING_ALLOWED_ORIGINS` (comma-separated exact origins, including the deployed app and any authorized local development origin).
- Optional supplier API: `SUPPLIER_CATALOG_API_URL`, `SUPPLIER_CATALOG_API_KEY`, `SUPPLIER_CATALOG_ALLOWED_HOSTS`.
- Optional AI comparison: `SOURCING_AI_API_BASE_URL`, `SOURCING_AI_API_KEY`, `SOURCING_AI_MODEL`, `SOURCING_AI_ALLOWED_HOSTS`.
- Scheduled worker authentication: `SOURCING_WORKER_SECRET` (at least 32 characters). `SOURCING_SCHEDULER_CONFIGURED=true` should be set only after the actual Supabase scheduled invocation below has been created and verified.

Deploy with Supabase CLI:

```powershell
supabase functions deploy sourcing-orchestrator
supabase functions deploy sourcing-worker --no-verify-jwt
```

The orchestrator keeps JWT verification enabled and does a second server-side role check. The worker disables gateway JWT verification only because Supabase Cron authenticates it with the separate `x-sourcing-worker-secret` header; the secret is compared server-side and must not be sent by the browser. Do not disable JWT verification on the orchestrator.

### Current production deployment

As of 2026-11-12, Supabase reports `sourcing-orchestrator` and `sourcing-worker` as active. The orchestrator has gateway JWT verification enabled; the worker has it disabled and enforces `SOURCING_WORKER_SECRET` itself. Server-side secrets are configured for the production origin `https://hopnshop.co.ke` and local development origin `http://127.0.0.1:5173`; secret values are intentionally not stored in this repository. A CORS preflight from the production origin returned HTTP 200, and an unauthenticated worker request returned HTTP 401 as intended.

The worker schedule is **not configured or enabled**. Admin/editor users can invoke queue processing through the orchestrator workbench, subject to database migration and staff-role verification. No supplier catalogue or AI provider credentials are configured, so external catalogue discovery and AI comparison are unavailable; staff can enter and review candidates manually. Production request creation and authorized staff processing still require end-to-end testing with separate customer and admin accounts.

### Optional daily schedule

Use Supabase Cron (`pg_cron`) and `pg_net` only if they are available and enabled for the project. Store the project URL and the exact worker secret in Supabase Vault, not in this migration or application code. Then schedule a daily HTTP invocation similar to:

```sql
select cron.schedule(
  'hopnshop-sourcing-review',
  '15 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hopnshop_project_url')
      || '/functions/v1/sourcing-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sourcing-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'hopnshop_sourcing_worker_secret')
    ),
    body := '{"limit":5,"jobKey":"daily-sourcing-review"}'::jsonb
  );
  $$
);
```

The staff schedule switch remains disabled until `SOURCING_SCHEDULER_CONFIGURED=true` and a sufficiently long `SOURCING_WORKER_SECRET` are set. The worker checks that the database job is enabled and due; otherwise a scheduled invocation is a no-op. Each invocation processes at most two tasks; optional AI comparison is limited to one possible match per task to bound provider time and usage. The schedule defaults to daily. Verify one run, the task history and the schedule row before activating it for production.

### Verification and limitations

Still test with separate authorized customer/admin accounts: customer request creation and isolation; task claim and retry; manual candidate idempotency; staff/editor authorization; risk approval comment requirement; estimate versus evidence-backed confirmed cost; supplier integration failure and missing-secret fallback; notification creation; and schedule disable/no-op behavior. The automated test file covers deterministic cost, matching, risk and retry rules. Deno typechecking and authenticated live database flows have not been run. No real supplier or AI delivery is claimed.

## Notifications

hopNshop includes a multi-channel notification system with four provider adapters:

- **In-app** (Supabase PostgreSQL + Realtime) — always available, displayed in the customer notification centre.
- **Email** (Resend) — transactional email via `adapter-resend` Edge Function. Requires `RESEND_API_KEY` and verified sender domain.
- **SMS** (Africa's Talking) — concise transactional SMS via `adapter-africastalking` Edge Function. Requires `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, and sender ID registration.
- **Android push** (Firebase Cloud Messaging + Capacitor) — via `adapter-fcm` Edge Function. Requires `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID`.

All provider credentials are server-only Edge Function secrets. They are never exposed in frontend code or `.env`. Set them with:

```
supabase secrets set RESEND_API_KEY=... AFRICASTALKING_USERNAME=... AFRICASTALKING_API_KEY=... FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' FIREBASE_PROJECT_ID=...
```

### Database

Migration `202611120003_notification_system.sql` creates:
- `notification_preferences` — per-user channel opt-ins (email, sms, push, in_app) with consent tracking.
- `notification_templates` — admin-managed message templates per channel/event type.
- `notification_queue` — queued outbound notifications with idempotency, retry, and delivery status tracking.
- `notification_delivery_log` — immutable record of each provider call attempt.
- `user_device_tokens` — Capacitor device tokens for push notification targeting.
- Extends `notifications` with channel, event_type, deep_link, delivery_status, and related entity IDs.

Migration `202611120004_notification_runtime.sql` adds:
- Default preferences trigger on new user registration.
- `enqueue_notification()` RPC for queueing with idempotency.
- `create_in_app_notification()` RPC for immediate in-app notification creation.
- `mark_all_notifications_read()` RPC.

RLS policies enforce customer isolation (users only see their own notifications/preferences) and admin access via `has_role()`.

### Edge Functions

Deploy all functions under `supabase/functions/notifications/`:

| Function | Purpose |
|---|---|
| `notification-router` | Receives queue items, routes to channel adapter, handles retries with exponential backoff |
| `adapter-inapp` | Writes in-app notification + broadcasts via Supabase Realtime |
| `adapter-resend` | Sends email via Resend API |
| `adapter-africastalking` | Sends SMS via Africa's Talking API |
| `adapter-fcm` | Sends push via Firebase FCM v1 HTTP API |

### Delivery guarantees

- No success notification is sent before the corresponding server-side operation is confirmed.
- Idempotency keys prevent duplicate deliveries.
- Failed deliveries retry with exponential backoff (max 5 attempts).
- Provider timeouts are handled with 25s AbortSignal.
- If credentials are missing, adapters return `status: "simulated"` and never claim real delivery.

### Email templates

Branded HTML templates live in `supabase/functions/notifications/templates/`. Configure Supabase Auth email delivery through a custom SMTP provider (not Supabase's default SMTP) for production.

### SMS rules

- Concise transactional templates only.
- Customers manage SMS preferences in the notification centre.
- Respect consent and opt-outs. No marketing SMS without appropriate consent.

### Admin dashboard

The admin notification centre (`AdminNotificationCentre`) shows notification history, channel used, recipient, event type, delivery status, provider response and error details, retry for failed notifications, message templates, provider configuration status, and delivery statistics.

Migration `202611110012_remaining_workflows.sql` adds supplier contact/terms fields, support response fields, notification insert permission for authorized staff, event notification triggers and affiliate click RPCs. Apply it only after migrations 001–011 and verify RLS, affiliate redirects, support ownership and notification delivery in a non-production project.

## Marketplace sources

Jumia, Amazon, Alibaba, SHEIN, Kilimall and other sources require permitted APIs, affiliate feeds or manual review. The URL function rejects unsafe URLs and never bypasses CAPTCHA, login restrictions, anti-bot controls or robots policies.
