# hopNshop

hopNshop is an Ionic React commerce and product-sourcing application for Kenya. It supports curated affiliate discovery, hopNshop-owned sales/pre-orders, and customer sourcing requests with quotations.

## Local development

1. Install Node.js 22+ and npm on Windows. If PowerShell blocks `npm.ps1`, run npm commands as `npm.cmd`.
2. Copy `.env.example` to `.env` and add a Supabase project URL and anon key.
3. Run `npm.cmd install` and `npm.cmd run dev` in PowerShell.
4. Apply every timestamped migration in `supabase/migrations/` in filename order with the Supabase CLI or SQL editor. This includes customer workflows, admin quotations, security hardening, manual payment verification and fulfilment updates. `supabase/seed.sql` is demo-only and intentionally unpublished.

The storefront loads published products from Supabase and displays an honest empty or error state rather than fabricated catalogue data. Customers can register/sign in with a password or use an email link, and can submit a M-Pesa transaction reference for administrator verification against an order total. Manual details are not payment proof; only submit after receiving verified hopNshop payment instructions. Refund requests require a previously verified payment; finance staff record completion only after confirming the actual external refund transaction. STK Push is not configured. Backend features require the project URL/key, applied migrations, and the required Supabase Auth and Storage configuration.

## Marketplace discovery and campaigns

The storefront puts published products first, then offers database-backed category tiles, curated collections and clear entry points for affiliate shopping, hopNshop pre-orders and personal sourcing. Search and filters use real catalogue and available variant data. Catalogue pages are fetched from Supabase as needed; a campaign or collection can still open products outside the first page. No popularity, discount or stock claim is invented.

Administrators and editors can manage scheduled promotional campaigns from their account panel. A campaign may lead to a published category, collection, product or the sourcing request form; only published campaigns inside their start/end window are shown publicly. Campaign images use HTTPS URLs. Campaigns do not change product prices or imply discounts.

Apply `202611120005_verified_admin_bootstrap.sql` and then `202611120006_marketplace_campaigns.sql` after all earlier migrations. The first migration uses a private email allowlist and grants the configured account the admin role only after Supabase marks its email verified; the storefront never assigns roles. The second migration adds category images, campaign scheduling and RLS. These latest migrations are present in the repository but have not yet been applied or live-tested.

The storefront category edit uses twelve locally managed, responsive editorial photographs with consistent card proportions, readable image overlays, and reduced-motion-aware hover zoom. Photo sources and license records are listed in [docs/CATEGORY_IMAGE_ATTRIBUTION.md](docs/CATEGORY_IMAGE_ATTRIBUTION.md). Apply `202611120007_editorial_category_photography.sql` after `202611120006_marketplace_campaigns.sql` to publish the category taxonomy and local image paths. Category filtering continues to use real catalogue category records.

## Kenya delivery operations (not yet deployed)

Migration `202611120008_hybrid_delivery_core.sql` adds the delivery foundation and must be applied after `202611120007_editorial_category_photography.sql`. It has not yet been applied or validated against PostgreSQL. Do not enable customer checkout until the migration is reviewed/applied and authorized staff configure actual couriers, covered localities, current expiring KES rates, and product shipping dimensions. All counties start inactive; the app does not claim unsupported areas are served.

Resale checkout is prepaid-only and fails closed if a current configured courier quote is unavailable. Delivery fees are server-calculated and included in the pending order total. Customers must approve any pre-payment fee adjustment; no post-payment surcharge or automated payment integration is implemented. Staff delivery controls appear in the account panel for admin/fulfilment roles. Courier tracking is manual. Affiliate orders continue through the external retailer; existing sourcing quotations do not yet collect delivery localities or use this parcel-routing workflow. See [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) before configuring delivery.

## Verification

`npm.cmd run lint` runs the TypeScript check, `npm.cmd test` runs domain tests, and `npm.cmd run build` runs TypeScript plus the Vite web build. In the current checkout, the test suite (28 tests) and standalone `npx.cmd vite build` pass; `npm.cmd run build` is blocked by pre-existing notification-system TypeScript errors documented in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Capacitor Android

The Android platform project is included at `android/` with package ID `com.hopnshop.app`, app version `1.0.0` and launcher/splash assets from the supplied hopNshop icon. Android Studio and an emulator are not required to build from the command line.

See [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md) for JDK/SDK prerequisites, local debug builds, authentication deep links, GitHub Actions APK/AAB builds, secure signing and installation. This environment has no JDK or Android SDK, so no APK/AAB has been built locally. The GitHub Actions workflow requires the public Supabase URL and anon key; signed release outputs additionally require GitHub signing secrets.

## Supabase Edge Functions

- `validate-source` validates a URL and returns a manual-review-required response; it does not persist or enqueue requests and deliberately does not scrape arbitrary URLs. The storefront's authenticated request form writes customer submissions to `sourcing_requests`.
- `mpesa-callback` persists provider callbacks idempotently and never treats a frontend message as payment proof.
- `notification-router` routes queued notifications to channel adapters with retry and idempotency.
- `adapter-inapp` delivers in-app notifications via Supabase Realtime.
- `adapter-resend` sends transactional email via Resend.
- `adapter-africastalking` sends transactional SMS via Africa's Talking.
- `adapter-fcm` sends Android push notifications via Firebase Cloud Messaging.
- `sourcing-orchestrator` verifies admin/editor access from the caller's Supabase JWT before running staff workflows.
- `sourcing-worker` claims and processes a bounded sourcing queue. It authenticates with a server-only worker secret and must be deployed with JWT verification disabled only for this function.

Deploy functions with the Supabase CLI and set server-only secrets using `supabase secrets set`. Required M-Pesa secrets are listed in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Notification provider credentials (RESEND_API_KEY, AFRICASTALKING_API_KEY, FIREBASE_SERVICE_ACCOUNT, etc.) are server-only Edge Function secrets and must never be added to `.env`.

## Smart sourcing engine

The sourcing engine extends the existing customer request → staff review → quotation flow; it does not replace the existing quote, payment-verification or fulfilment controls. Apply `supabase/migrations/202611120003_sourcing_engine.sql` after the earlier migrations before deploying the new functions. The customer form records structured product requirements and private reference images. Staff can inspect tasks and candidate matches, add manual candidates, review supplier-risk evidence, and save landed-cost estimates. Candidates, AI comparisons and supplier risk remain unverified until a human reviews them; a sourced result is never itself a confirmed price or purchasable offer.

Automatic catalogue discovery is inactive until a permitted JSON catalogue integration is configured with a public HTTPS endpoint and explicit host allowlist. AI comparison is optional, disabled by default, and cannot certify product authenticity or supplier legitimacy. When either integration is absent, the task is recorded for manual review. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for server-only secrets, provider contract, deployment, scheduled invocation and test steps.

Copy `supabase/functions/.env.example` only as a reference for Supabase Edge Function secrets; do not put those values in the Vite `.env` or commit a filled-in copy. No external supplier or AI credentials are present in this workspace.

## Notification System

hopNshop includes a multi-channel notification system:

- **In-app notifications** — displayed in the customer notification centre, with unread counts, read/unread status, mark-all-as-read, categories, timestamps, and deep links.
- **Email** — branded HTML templates for order confirmations, payment confirmations, shipment updates, delivery confirmations, quotation notifications, and account emails.
- **SMS** — concise transactional templates via Africa's Talking, respecting customer SMS preferences and opt-in consent.
- **Android push** — Firebase Cloud Messaging via Capacitor for mobile app push notifications.

Notification preferences are managed per customer in the notification centre. Admin notification management provides delivery history, retry for failed notifications, message templates, provider configuration status, and usage statistics.

## Documents

- [Architecture](docs/ARCHITECTURE.md)
- [Integrations and credentials](docs/INTEGRATIONS.md)
- [Administrator guide](docs/ADMIN_GUIDE.md)
- [Security checklist](docs/SECURITY.md)
- [Web deployment guide](docs/DEPLOYMENT.md)
- [PROJECT_STATUS.md](PROJECT_STATUS.md)
