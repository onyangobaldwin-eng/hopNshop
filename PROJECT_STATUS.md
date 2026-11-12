# hopNshop project status and specification checklist

Updated: 2026-11-12 (Africa/Nairobi)

## Hybrid Kenya delivery milestone — implemented locally, not deployed

- Added migration `202611120008_hybrid_delivery_core.sql` for county/locality coverage, manual courier partners, expiring KES rate cards, product weight/dimensions, approved supplier direct-delivery permissions, order fulfilments, inbound hub shipments, parcel contents, tracking events, proof/attempt records, returns, delivery expenses, fee adjustments and audit trails.
- Resale checkout now requires an active configured delivery locality and current courier rate. The server calculates the estimated fee, validates product dimensions and KES currency, checks pickup-point addresses, and stores delivery with the order. The order remains unpaid until an authorized reviewer verifies the exact amount. Unsupported or stale rates fail closed.
- Added role-gated delivery administration for courier/locality/rate setup, product shipping dimensions, supplier direct-route approval, hub receipt/inspection, parcel creation, tracking events, proof, attempts, return review, and customer-approved pre-payment fee changes.
- Customers can see parcel-level tracking and request delivery support/returns in their account. Shipment updates and return/fee notices currently use in-app notifications only; channel preferences are checked for parcel events.
- Tightened shipment integrity: parcel contents must match their specific supplier fulfilment, an order cannot become delivered until each fulfilment has parcels and every parcel is delivered, and customers cannot submit payment while a delivery-fee change awaits their decision. Configuration, parcel assignment, fee and return actions are audit logged.
- **Not production-ready yet:** migration `202611120008` has not been applied or run against PostgreSQL. No `psql`, Supabase CLI or disposable test database is available in this Windows environment. Do not treat the migration or live data flows as validated.
- No courier partner, service locality, price, coverage, API, or tracking URL has been invented or seeded. Admins must add verified operational data; all counties start disabled. Courier integrations and credentials are not configured.
- **Scope gap:** this delivery checkout currently covers HopNShop resale orders. Affiliate orders remain with external retailers. Existing personal-sourcing quotation orders have no delivery-locality selection or parcel routing in this milestone; their current payment/fulfilment workflow is preserved but not yet integrated with this delivery core.
- **Operational limitations:** there is no courier API/automatic stock synchronization, post-payment fee collection flow, or automated M-Pesa/STK Push. Inspection UI records written findings but does not upload inspection photos; the current proof UI records recipient confirmation rather than capturing a signature/photo. Do not claim nationwide service until each operational area/rate is verified and configured.
- Verification after the delivery UI changes: `npm.cmd test` passes 28 tests; standalone `npx.cmd vite build` succeeds (with existing large-chunk/dependency annotation warnings). `npm.cmd run lint` remains blocked by notification-system TypeScript errors in `App.tsx`, `CustomerAccount.tsx` and notification-centre components; the delivery components produced no TypeScript diagnostics. SQL execution and authenticated customer/staff isolation have not been tested.

## Latest category storefront update

- Added a twelve-category editorial photography section near the top of the homepage, before the product catalogue. Each card uses its own locally served image, consistent responsive crop, dark text-safe gradient, descriptive copy and keyboard-visible focus.
- Standardized tile proportions across breakpoints to prevent uneven/squeezed category cards. Checked 320, 390, 768, 1024 and 1440px viewports; the document has no horizontal overflow and card grids settle to two, three or four columns.
- All twelve local image files loaded in the browser preview. Sources and Unsplash License records are documented in `docs/CATEGORY_IMAGE_ATTRIBUTION.md`.
- Added migration `202611120007_editorial_category_photography.sql` to publish the full taxonomy and local asset paths. This migration has not yet been applied remotely; the homepage still has local-image fallbacks while it is pending.
- The Vite preview is running at `http://127.0.0.1:5173/`.

## Status key

- **Complete and verified** — implemented and exercised by an applicable automated or manual check.
- **Implemented but unverified** — code/schema exists, but live integration or acceptance evidence is unavailable.
- **Partially implemented** — some of the requirement exists; important parts remain.
- **Not implemented** — no functioning implementation found.
- **Blocked by external credentials or approval** — cannot safely activate until an external credential, asset, permission, or approval is supplied. Internal implementation work may still be possible.

## Preservation and development state

- This is the existing Ionic React/Vite project. No files were deleted, the project was not rebuilt, and no environment values were copied into this status file.
- This workspace has no `.git` directory. Git history, `git status`, attribution of earlier edits, and safe Git checkpoints are unavailable. No destructive Git command was run. Establish a repository/checkpoint from the authoritative project source when `.git` is restored.
- The supplied specification was found at the user-provided attachment path and is now the governing checklist below. `hopNshop-source.zip` contains the earlier scaffold, not this specification or newer workflows.
- The user-provided Supabase anon key is stored only in ignored local `.env`; its value is not recorded here. The configured project URL matches the key's project. After the user reported applying earlier migrations, live REST probes for `products`, `addresses`, `orders` and `refunds` returned HTTP 200; the anon role sees no rows. The default-address RPC responds with its expected sign-in requirement when called anonymously. The browser now displays the five published reference categories; whether migration `202611120002_storefront_categories.sql` or pre-existing category records supplied them has not been independently confirmed.
- Existing stack: Ionic React 8, React 19, TypeScript, Vite 7, Supabase JS, Capacitor 7, PostgreSQL/RLS migrations. `package.json`, lockfile and installed dependencies are present.

## Current sourcing-engine milestone

- Implemented in the existing application: structured customer sourcing fields; a database-backed, idempotency-keyed task queue; provider-independent matching, risk and landed-cost logic; optional allowlisted catalogue and AI adapters; a JWT- and role-checked sourcing orchestrator; a worker-secret-protected queue function; a responsive admin/editor workbench; supplier candidate approval; transactional result/cost persistence RPCs; and task/request in-app updates.
- Production functions are deployed and active. The orchestrator keeps JWT verification enabled; the worker requires its configured server-side secret header. CORS is configured for `https://hopnshop.co.ke` and `http://127.0.0.1:5173`. The user reports that migration `202611120003_sourcing_engine.sql` is applied; that database change was not independently queried.
- Supabase CLI was authenticated through `npx.cmd` and used to deploy the functions and configure server-side secrets. Deno and PostgreSQL tooling are unavailable. CORS preflight and unauthenticated-worker rejection were verified, but authenticated RLS/task processing and scheduled invocation remain unverified. No supplier or AI provider credentials are configured. The full TypeScript check still reports pre-existing notification-system errors in `App.tsx`, `CustomerAccount.tsx`, `AdminNotificationCentre.tsx` and `CustomerNotificationCentre.tsx`; those paths were not changed. The new sourcing UI was separately type-checked.

## Marketplace discovery and campaigns continuation

- Reordered the storefront so a concise marketplace introduction and the published catalogue appear before campaign/editorial content; removed the unsupported “Trending Now” claim. The copy distinguishes affiliate listings, hopNshop pre-orders and personal sourcing without inventing products, ratings or discounts.
- Added real size/colour variant filters, corrected exact-token matching so a size such as `L` does not match the letter inside “Medium”, and included both filters in reset behavior.
- Replaced the catalogue's client-only reveal with Supabase range-based pages (24 displayed per page, with a look-ahead row), stable ordering and a retryable load-more error state. Published collection products and product-targeted campaign links resolve independently of the current catalogue page.
- Added category tiles using published category rows and configured HTTPS images, published collection cards using stored collection imagery, clear service-model cards, a factual “How hopNshop works” explanation and accessible FAQ disclosures.
- Connected scheduled published campaign calls to category filtering, collection scrolling, product detail opening or the existing sourcing form. Mounted campaign CRUD controls in the admin/editor account view; database RLS remains authoritative.
- Added migrations `202611120005_verified_admin_bootstrap.sql` (verified-email allowlist role grant and audit log) and `202611120006_marketplace_campaigns.sql` (campaign records, category images, scheduling and staff/customer RLS). **These two migrations have not been applied or live-tested.** Applying the admin bootstrap migration seeds the specifically requested email allowlist; the role is granted only after Supabase confirms that account's email. No frontend role assignment exists.
- Validation: all 28 Vitest tests pass; the production Vite bundle builds independently. The full `npm run build` remains blocked by pre-existing notification code type errors (incorrect Ionic imports/edge-runtime `Deno` references and missing notification event methods), plus existing auth-notification errors in `App.tsx`; no newly added storefront type errors were reported. Browser checks at 320px and 390px showed no horizontal overflow, the catalogue precedes the campaign hero, and all five published categories render. The connected Supabase project currently has no published products; campaign/category-image queries confirm their new migrations are still pending, and the UI falls back to existing category data and an empty-catalogue state.

## Implemented in this continuation

- Added password registration, password sign-in, password-reset email and recovery-password update to the existing Supabase email-link sign-in modal in `src/App.tsx`.
- Added customer wishlist save/remove controls and wishlist view. Replaced the nonfunctional newsletter form with a clear message because no delivery provider is configured.
- Added guidance on Auth URL allowlisting and email-template setup to `docs/INTEGRATIONS.md`.
- Added `supabase/migrations/202611110003_security_hardening.sql`: enables RLS on previously uncovered tables; narrows staff access by role; removes customer ability to change sourcing request status; and restricts data access for orders, addresses, payments, notifications and support.
- Added `supabase/migrations/202611110004_manual_payment_verification.sql` plus `AdminPaymentQueue.tsx`: customers submit M-Pesa reference/payer/amount against an order; only admin/finance can verify or reject. Server checks ownership, amount, duplicate references and state. Customer submissions stay pending and never count as proof.
- Added `supabase/migrations/202611110005_order_fulfilment_workflow.sql` plus `AdminOrderQueue.tsx`: admin/fulfilment roles advance permitted order states with a customer update and courier/tracking details; the database checks transitions, writes an audit record and customer-visible event. Customers see the order timeline.
- Added `supabase/migrations/202611110006_sourcing_product_name.sql`; customers can include a bounded product name with a request and both customer/admin views display it.
- Added `supabase/migrations/202611110007_sourcing_image_storage.sql`: creates a private 5 MiB JPEG/PNG/WebP bucket, refuses unexpected pre-existing bucket settings, and scopes object access to the request owner and admin/editor. Sourcing form uploads images and the admin queue uses signed URLs.
- Added admin/editor catalogue create/edit/publish controls with client/server publication checks, scoped private product-media storage, descriptive alt-text uploads, published-product signed galleries and product detail modals. Added variant creation/removal, customer option selection and variant-aware server-side order price/availability validation in migration 202611110010_product_variant_orders.sql. Added admin category creation and publication controls; categories populate product editor and storefront filters. Added curated collection/product membership with role-gated management, RLS migration 202611110011_collection_products.sql and published collection storefront cards. Added admin supplier verification and affiliate programme records/status controls.
- Added category, brand, availability, currency-aware price filters, sorting and load-more pagination to product discovery; added domain tests for publication rules and combined/safe-currency filtering.
- Added approval-gated affiliate link and campaign administration, a public-link lookup and click-recording RPC, plus click counts in the admin view. Added migration `202611110012_remaining_workflows.sql` for supplier contact/terms fields, customer support responses, notification permissions and quote/fulfilment/support notification triggers.
- Added customer support cases, customer notification inbox, admin/fulfilment support queue and manual in-app notifications. Added finance/admin date-filtered order/payment/expense reports, expense entry and CSV export, plus root Open Graph/Twitter metadata.
- Added `supabase/migrations/202611110013_admin_operational_overview.sql` and the admin-only operational dashboard. Counts are read from current workflow tables and are explicitly not presented as sales or profit.
- Added `supabase/migrations/202611110014_manual_refunds.sql`: customers can request refunds only against verified payments, finance can approve/reject, and completion requires an external transaction reference. Orders are marked refunded only after completed refunds cover the order total. Added customer and finance UI plus input tests.
- Added the complete multi-channel notification system:
  - `supabase/migrations/202611120003_notification_system.sql`: notification preferences, templates, queue, delivery log, device tokens tables; extended notifications with channel/event/deep_link/delivery_status/related entity IDs; RLS policies for customer isolation and admin access.
  - `supabase/migrations/202611120004_notification_runtime.sql`: default preferences trigger, enqueue_notification RPC, create_in_app_notification RPC, mark_all_notifications_read RPC.
  - Edge Functions under `supabase/functions/notifications/`: notification-router, adapter-inapp, adapter-resend, adapter-africastalking, adapter-fcm — each as a separate provider adapter with retry, exponential backoff, idempotency, timeout handling, and simulated delivery when credentials are missing.
  - Branded HTML email templates in `supabase/functions/notifications/templates/`: welcome, order-confirmation, payment-confirmed, shipment-update, delivery-confirmed, quotation-ready, password-reset.
  - `src/lib/notifications.ts`: typed notification service client.
  - `src/lib/notificationEvents.ts`: event-driven notification triggers integrated with account registration, email verification, password reset, sourcing request submission, quotation creation/acceptance/rejection, payment confirmation/failure, order confirmation, procurement/supplier updates, shipment/delivery tracking, order ready for collection, order delivery, cancellation/refund updates, and admin alerts.
  - `src/components/CustomerNotificationCentre.tsx`: customer notification centre with unread count, read/unread status, mark all as read, categories, timestamps, deep links, and notification preferences (email/SMS/push/in-app).
  - `src/components/AdminNotificationCentre.tsx`: admin dashboard with notification history, channel, recipient, event, delivery status, provider response/error details, retry failed, message templates, provider configuration status, and delivery statistics.
  - Integrated notification triggers into `src/App.tsx` (auth events) and `src/components/CustomerAccount.tsx` (quotation acceptance).
  - Updated `.env.example`, `docs/INTEGRATIONS.md`, and `README.md` with notification provider credentials, deployment steps, and delivery guarantees.
- Added authenticated customer profile editing and saved-address management with validated inputs, loading/error/empty states, address-in-use deletion guards, account data export, and an owner-checked RPC for atomic default-address changes. Account deletion is not implemented.
- Added account-scoped saved-address selection in resale checkout with loading/error/empty states and manual-entry fallback. Selecting an address fills the checkout form; the existing order RPC creates an order-specific delivery record. Live address RLS and checkout behavior remain unverified.
- Redesigned the storefront homepage and shared navigation around the supplied dark/ivory/electric-lime reference. Added `HomeHero`, `StorefrontHeader`, a reference-derived hero crop, dynamic category navigation, real wishlist/cart counts, truthful benefits, model-specific product actions, and mobile bottom navigation. Existing Supabase catalogue, collections, search/filter, affiliate, resale, sourcing, wishlist, and account flows remain wired.
- Removed minimum/maximum price controls and their filtering logic. Categories now load from published Supabase category records, with a new idempotent migration seeding the five categories shown in the reference. Currency options use the KES schema default plus currencies found on published products; no unsupported currencies are fabricated.
- Reworked sign-in, sign-up and password-reset dialogs to remove the duplicate email field from one-time-link sign-in, reuse the validated email input, group secondary actions clearly, add a back-to-sign-in route, and improve spacing and typography on narrow screens. Improved mobile readability and responsive admin cost grids/product detail rows.
- Fixed long sourcing dialogs on short viewports so the submit control remains reachable; browser smoke-tested the configured-unavailable state to ensure it does not report a false submission.
- `hopNshop-current-source.zip` is a preservation snapshot containing source, docs, migrations, tests and config templates, excluding `.env`, `.git`, `node_modules`, `dist` and the earlier scaffold archive; it predates migrations 013–014 and should be refreshed before distribution.
- Auth, SQL and Storage workflows have not been fully exercised against Supabase. The user reports that migrations are applied and representative table/RPC probes now succeed. Authenticated RLS behavior, order and refund workflows, and Storage uploads still need end-to-end testing; no test account or provider credentials are configured here.

## Visual redesign milestone

- **Pages/areas redesigned:** storefront homepage, shared header/category navigation, mobile bottom navigation, product discovery cards, collection-card styling, and shared modal/theme surfaces.
- **Components/assets:** `src/App.tsx`, `src/components/HomeHero.tsx`, `src/components/StorefrontHeader.tsx`, `src/styles.css`, and `public/images/hero-reference.jpg`. The hero is a crop of the user-supplied `WhatsApp Image 2026-11-12 at 9.45.01 AM.jpeg`; the original reference image was preserved.
- **Functionality preserved:** existing Supabase catalogue and collection queries, product search and filters, model-specific affiliate/resale/sourcing actions, wishlist persistence, account/authentication, sourcing request flow, and cart/checkout logic. Navigation counts come from current wishlist/cart state; no products, discounts, ratings or customer identities were fabricated.
- **Taxonomy/currency source:** the browser now displays the five reference categories: Electronics, Fashion, Home & Living, Beauty and Sports. The idempotent migration seeds them if missing. KES is the existing database default, with any additional currency choices derived from real published product rows.
- **Outstanding visual issues:** no official logo asset or independent product/editorial photo library is present. The catalogue currently has no visible published products, so card/collection behavior needs review with real records. Sign-in, sign-up and password-reset dialogs have been visually checked at narrow widths; authenticated account/admin workflow states still need detailed state-by-state QA. Tablet and Android-device QA remain.
- **Verification:** TypeScript check, 19 tests and Vite production build pass. Browser checks at 360, 390 and 412px show no horizontal overflow; the homepage image loads and the sourcing dialog opens/closes.
- **Responsive review:** homepage checked at 320, 360, 390, 768, 1024 and 1440px with no document-level horizontal overflow. At 320px, sign-in, sign-up and password-reset dialogs fit without horizontal clipping; sign-in uses one email field, rejects empty/malformed one-time-link addresses, and reset offers a clear return to sign-in. Sourcing dialog remains vertically scrollable on short screens.

## Requirement checklist

### 1. Business overview and three business models

- [ ] **Partially implemented** — premium curated discovery, reliable information, transparent sourcing, comparisons, collections, bundles, deals, video discovery and local fulfilment: only the editorial-style shell and manual sourcing concept exist; most capabilities below are missing.
- [ ] **Partially implemented** — Affiliate commerce: admin-managed links require an approved partner and published product; campaign clicks are recorded and counted. Partner conversions, commission lifecycle and reconciliation are not wired.
- [ ] **Implemented but unverified** — Affiliate purchases remain external and are not created as hopNshop orders; frontend purchase action opens the retailer. Disclosures and retailer-specific delivery/returns explanations are incomplete.
- [ ] **Partially implemented** — Resale/pre-order: published products can be added to a cart and an authenticated customer can create an order through a database RPC. Customer M-Pesa details can be submitted for manual review, but no payment is taken or confirmed automatically; procurement and order updates remain unverified.
- [ ] **Blocked by external credentials or approval** — Resale supplier permissions, blind-shipping permissions and approved sourcing relationships are not evidenced; verify before selling or procuring.
- [ ] **Partially implemented** — Personal sourcing: customer can submit URL, optional product name, reference image, variant, quantity and notes; staff can review images and prepare a KES quote; customer can accept it. Quote/fulfilment events now create in-app notifications. Cancellation/rejection/revisions and procurement execution remain missing. Manual payment review and staff fulfilment updates exist but are unverified.

### 2. Technology architecture

- [x] **Complete and verified** — Existing frontend uses Ionic React, TypeScript and Vite; TypeScript check passes and production web bundle builds.
- [ ] **Implemented but unverified** — React Router, reusable components, responsive CSS and Capacitor configuration exist; navigation is currently a single-page shell, reusable design-system coverage is limited, and device packaging is not tested.
- [ ] **Partially implemented** — Supabase PostgreSQL/Auth/RLS/Edge Function architecture and migrations exist; migrations are reported applied and representative REST/RPC calls respond, but authenticated RLS and workflow integration tests remain.
- [ ] **Implemented but unverified** — Supabase Storage bucket/policies and authenticated sourcing image uploads exist; no live bucket/database test has run. Netlify/Vercel deployment configuration is absent.
- [ ] **Partially implemented** — Android app identity is configured in Capacitor; no generated Android project, APK/AAB pipeline or iOS validation exists. No Android Studio or emulator was installed.
- [ ] **Not implemented** — Git/GitHub checkpointing is unavailable in the current folder because `.git` is absent; source snapshots provide local preservation checkpoints.

### 3. Design system and brand

- [ ] **Blocked by external credentials or approval** — Specification says the official logo was supplied, but no `brand-assets` directory or logo file exists in the inspected workspace/archive. Integrate the original asset when it is made available; do not redraw or substitute it.
- [ ] **Partially implemented** — Storefront now uses the supplied dark/ivory/lime direction, editorial hero, responsive navigation and product cards; global tokens also theme shared account/admin dialogs. There is no official logo asset, and detailed visual QA for every account/admin state remains.
- [ ] **Not implemented** — Reusable tables, drawers, badges, notification/confirmation components and refined motion system.
- [ ] **Partially implemented** — Browser sizing checks passed at 360, 390 and 412px without horizontal overflow; tablet and Android-device QA has not been performed.

### 4. Customer storefront and product discovery

- [ ] **Partially implemented** — Homepage now leads with the live published catalogue, followed by database-backed category and collection discovery, distinct affiliate/pre-order/sourcing paths, process guidance and FAQ. Scheduled campaign display and staff management are implemented in code but await migrations `202611120005` and `202611120006`; no verified discounts, popularity rankings, bundles or conversion metrics exist.
- [ ] **Implemented but unverified** — Product search matches name/description/brand; category, brand, available size/colour variant, availability and currency filters plus sorting use real product rows. Supabase range-based pagination loads additional catalogue pages; large-catalogue performance, live data and filters spanning pages remain unverified.
- [ ] **Partially implemented** — Wishlist save/remove and account display are implemented but not integration-tested. Related products, recently viewed products and comparison are absent.
- [ ] **Partially implemented** — Product cards link to a detail modal with verified fields, estimated costs, source and business-model disclosure; published product image galleries are shown. Variant options are now shown and selectable, including variant-specific cart totals and order snapshots; live catalogue and order RPC behavior remains unverified. Full specification details and shipping/fulfilment information remain missing.
- [ ] **Implemented but unverified** — Affiliate action is differentiated from internal resale order creation; approved disclosure copy and customer-facing handling of retailer delivery/returns/support are incomplete.
- [ ] **Implemented but unverified** — Admin-curated collections with product membership and storefront presentation exist; comparison workflow, bundles and evidenced bundle savings are absent.

### 5. Customer accounts and authentication

- [ ] **Implemented but unverified** — Supabase email/password registration and sign-in, passwordless email-link sign-in, logout, password reset email and recovery password update are now wired in `src/App.tsx`; live email/Auth behavior needs Supabase credentials, redirect allowlisting and provider testing.
- [ ] **Partially implemented** — Session state is observed and customer data uses authenticated user identity; protected routes, account security controls and auth component tests are absent.
- [ ] **Partially implemented** — Account modal displays orders, sourcing requests, quotations, wishlist and payment history and allows quote acceptance; customers can submit support cases and read/mark in-app notifications. Profile editing, saved-address management, data export and resale checkout address selection are implemented but unverified; account deletion is absent.
- [ ] **Implemented but unverified** — Customer-specific reads are scoped by user ID and RLS policies; cross-account isolation has not been verified against a live database.

### 6. Product catalogue and management

- [ ] **Partially implemented** — Database has products, variants, media, sources, currency, local/source price fields, shipping/duties estimates, margin, availability, publication status and verification timestamp; retailer, richer specifications, supplier/source-price history, independent freshness timestamps and fulfilment/disclosure fields are incomplete.
- [ ] **Implemented but unverified** — Product draft/review/published/archived states, admin/editor RLS, create/edit/publish form and database publication trigger exist; no live DB/role test has run.
- [ ] **Partially implemented** — Admin/editor can create/edit/publish/archive products, add/remove variants and manage private gallery images with alt text. Bulk management, editing existing variants, image ordering, price history and live RLS/Storage testing remain. Category creation/publication and collection curation controls exist but are unverified.
- [ ] **Implemented but unverified** — Storefront reads only published catalogue rows and does not fabricate reviews, ratings, sales figures or availability; no live catalogue test has run.

### 7. Product sourcing engine

- [ ] **Implemented but partially verified** — Customer form accepts public HTTPS URL, product name, published category, brand/model, condition, preferred location, variant, quantity, requirements and private reference image (JPEG/PNG/WebP up to 5 MiB). The user reports migration `202611120003_sourcing_engine.sql` is applied in production; new fields, live Storage and RLS behavior still need account-based testing. Multiple products per request and customer cancellation are absent.
- [ ] **Deployed; database behavior unverified** — Sourcing task queue, evaluations, approvals, price/cost history, settings, schedule state and service-only RPCs are in the migration. Production functions are active; transactional RPC and RLS behavior still require authorized end-to-end testing.
- [ ] **Implemented but unverified** — Admin/editor workbench supports bounded queue execution/retry, manual candidate entry, deterministic comparison, potential-duplicate flags, human risk review, detailed high-risk approval notes, request priority/internal notes and task history. Authenticated role enforcement and live RLS require separate-account testing.
- [ ] **Implemented but unverified** — Landed-cost calculator stores transparent KES totals, explicit FX rate, estimate/confirmed status, evidence reference and target-price override reason. Supplier inputs are never silently confirmed. RPC transaction behavior has not been tested against PostgreSQL.
- [ ] **Implemented but unverified** — Request/task notifications only state that options need human review and do not claim a supplier, price or availability is confirmed. Staff result approval emits a request update. Live notification ownership and delivery are untested.
- [ ] **Blocked by external credentials or approval** — Automatic product discovery requires an authorized JSON catalogue API, server secrets and exact host allowlist. The generic adapter is implemented, but no real provider or response has been tested. OpenAI-compatible comparison is optional, disabled by default, and cannot certify supplier legitimacy or authenticity.
- [ ] **Partially implemented** — Existing request → review → quote → accept → awaiting-payment → manual payment review → fulfilment update remains in place. Procurement execution, request cancel/revision and multi-product request flow are absent.
- [ ] **Partially implemented** — URL validation rejects common private/localhost ranges and does not scrape; robust DNS rebinding/unsafe redirect defenses are not implemented. Current validator is not a safe arbitrary-URL fetcher.
- [ ] **Blocked by external credentials or approval** — Automatic marketplace extraction is not configured; only authorised APIs/feeds and manual review are supported by policy.
- [ ] **Implemented but unverified** — Private request image bucket, client-side size/type validation and owner/admin/editor object policies exist; live object ownership, signed URL and upload tests are pending.

### 8. Quotation and pricing engine

- [ ] **Partially implemented** — Existing admin/editor quote form accepts KES item price, shipping, duties, taxes, service fee, flat markup, discount, delivery estimate and expiry. The new sourcing cost calculator adds optional source currency/FX, insurance, import/other expenses, explicit estimate/confirmed labels and an audit history; it does not yet populate or replace the existing quotation form.
- [ ] **Implemented but unverified** — SQL RPC validates quote amounts/expiry, snapshots quote rows and writes audit data; migration and DB behavior have not been executed.
- [ ] **Partially implemented** — Customer sees quote total, item lines, expiry and delivery window; a transparent cost breakdown and estimates-versus-confirmed/actual labels are missing.
- [ ] **Not implemented** — Historical exchange-rate capture and quotation revisions/snapshots beyond the current quote record.

### 9. Payments

- [ ] **Blocked by external credentials or approval** — Daraja STK Push/callback registration and production/sandbox credentials are absent; no payment initiation adapter or UI exists.
- [ ] **Partially implemented** — Payment table and callback scaffold exist; callback currently does not authenticate provider origin or verify amount/order association and cannot be treated as payment proof.
- [ ] **Implemented but unverified** — Customer manual M-Pesa reference/payer/amount submission and admin/finance verification/rejection UI/RPC exist; migrations are reported applied, but live role/statement checks are unavailable. Publish verified payment instructions before inviting payment.
- [ ] **Partially implemented** — Payment rows support unique manual references and reviewed-by metadata; reconciliation, STK callback verification and live payment integration tests are absent. Manual refund requests, review and recorded completion now exist but are not database-tested.
- [x] **Complete and verified** — Affiliate purchases do not use hopNshop payment/order creation in the implemented storefront.

### 10. Order management and fulfilment

- [ ] **Implemented but unverified** — Order status enum covers the specified lifecycle, and resale/sourcing orders can be created through RPCs; no live transaction verification has run.
- [ ] **Implemented but unverified** — Customer can see order number, items, total, payment history and customer-visible fulfilment timeline with courier/tracking details; live database testing is pending.
- [ ] **Implemented but unverified** — Admin/fulfilment order queue and server-validated transition/update workflow exist; broader order management remains incomplete. Manual refund processing is recorded separately and has not been live-tested.
- [ ] **Partially implemented** — Staff RPC records factual customer-visible updates and tracking metadata; live role/RLS testing and automatic customer notifications are absent.

### 11. Supplier management

- [ ] **Partially implemented** — Supplier/product tables store name, country, type, marketplace, verification status, notes, MOQ and lead time; contacts, categories, samples, return/payment terms, shipping permissions and reliability history are missing.
- [ ] **Implemented but unverified** — Admins can manage supplier contacts, samples, return/payment terms, shipping permissions and verification evidence; supplier performance reporting and live permissions remain unverified.
- [ ] **Blocked by external credentials or approval** — Supplier verification and resale/fulfilment permissions require external evidence and approval.

### 12. Administrative dashboard and roles

- [ ] **Partially implemented** — Admin/editor product catalogue, sourcing, payment verification, order/fulfilment queues, collections, supplier/affiliate management, support and finance reports exist; settings and some operational workflows remain incomplete.
- [ ] **Implemented but unverified** — Admin-only database-backed operational counts cover published/review products, open sourcing, pending quotes, payment/order states, fulfilment and support. Migration 013 must be applied and the role check live-tested.
- [ ] **Partially implemented** — Roles exist for customer, admin, editor, fulfilment and finance; super-admin and operations-staff role distinctions/permissions are incomplete.
- [ ] **Implemented but unverified** — Admin/editor quote RPC checks roles server-side; RLS policies now limit selected management data, but complete least-privilege review and live role tests are pending.
- [ ] **Implemented but unverified** — No self-service admin role assignment was found; role provisioning and audit process still require controlled Supabase operations.

### 13. Financial reporting

- [ ] **Partially implemented** — Orders, payments, refunds, affiliate events and operating expense tables exist; records and definitions for GMV, revenue, commissions, costs, fees, chargebacks and margins are incomplete.
- [ ] **Implemented but unverified** — Reports include date/model filters, currency-grouped order/payment/expense summaries and CSV export; they are not verified profit/reconciliation statements and do not yet report refunds.
- [ ] **Not implemented** — Explicit estimate-versus-confirmed financial state and contribution/net-profit calculation from verified transactions.

### 14. Affiliate management

- [ ] **Implemented but unverified** — Affiliate partner records, approval status, disclosure/rate/terms, affiliate links, click recording and click counts have admin UI. Scheduled storefront campaign management is also implemented but awaits its database migration. Conversion reconciliation and payout reports remain absent.
- [ ] **Implemented but unverified** — No actual partner or rate is claimed in the repository; affiliate links are used only when present on a published product.
- [ ] **Blocked by external credentials or approval** — Partner programme approval, geographic eligibility, attribution rules and payout requirements must be verified before activation.

### 15. Product discovery automation

- [ ] **Partially implemented** — Published products load from Supabase; approved feed/API ingestion, metadata imports, freshness tracking, tagging and category suggestions are absent.
- [ ] **Partially implemented** — Manual product create/edit/publish and media controls exist; approved-feed discovery queue, freshness checks, metadata imports and automated SEO metadata are absent.
- [ ] **Partially implemented** — Publication state exists and manual create/edit/publish controls are present; approved feeds, freshness tracking, metadata and discovery queues remain absent.
- [ ] **Not implemented** — AI-assisted product descriptions; AI must remain optional and is not configured.

### 16. Notifications and customer support

- [ ] **Implemented but unverified** — Customers submit support cases and read notifications; admin/fulfilment staff respond, update status and send in-app notices. Quote, fulfilment and support-response changes create notification rows; live RLS/trigger behavior is untested.
- [ ] **Blocked by external credentials or approval** — Email/WhatsApp/SMS providers and consent/sender configuration are not supplied.
- [ ] **Implemented but unverified** — In-app event notifications and a manual support workflow exist. External email/WhatsApp/SMS delivery still requires provider credentials and consent configuration.

### 17. Android application

- [ ] **Partially implemented** — Capacitor app ID/name/webDir and Android scheme are set; no generated Android project or build pipeline exists.
- [ ] **Blocked by external credentials or approval** — Official icon/splash source assets are absent.
- [ ] **Partially implemented** — CSS supports mobile viewport and safe-area viewport setting exists; keyboard handling, deep links, share, camera/photo picker, push notification and offline catalogue cache are absent.
- [ ] **Not implemented** — Stale-cache labels and offline-action handling.
- [ ] **Complete and verified** — No Android Studio or emulator has been installed as requested.

### 18. Database architecture

- [ ] **Partially implemented** — Core tables, relationships, timestamps, some checks/indexes and business/status enums exist; several suggested entities/fields and constraints are absent.
- [ ] **Implemented but unverified** — New RLS hardening migration addresses previously uncovered tables and removes customer ability to alter sourcing request status; migrations are reported applied, but the policies have not been reviewed with authenticated live tests.
- [ ] **Partially implemented** — Core customer isolation and selected staff permissions have policies; full least-privilege coverage, storage-object policies and cross-account tests remain.
- [x] **Complete and verified** — Seed is explicitly marked demo-only and unpublished.
- [x] **Complete and verified** — Frontend uses the anon client key and no service-role credential is in Vite code; server-only secret requirements are documented.

### 19. Security and privacy

- [ ] **Implemented but unverified** — Supabase Auth/RLS and server-side RPC validation exist, with additional hardening migration added; live RLS and auth attack-surface tests are pending.
- [ ] **Partially implemented** — Input validation and HTTPS/private-IP URL checks exist; robust SSRF/DNS/re-direct protection, rate limiting and abuse protection are absent.
- [ ] **Partially implemented** — Sourcing and product media uploads validate type/size and use scoped Storage policies; storage tests, protected route layer, full audit coverage and user privacy/data export/deletion workflow remain absent.
- [ ] **Partially implemented** — Safe user-facing error messages and no hardcoded app credentials were found; some logs include backend error messages, and production logging/privacy review is pending.
- [ ] **Blocked by external credentials or approval** — Data protection, consumer, tax/import and payment-provider legal/regulatory review is outside the repository and not evidenced.
- [ ] **Not implemented** — Editable privacy, terms, returns/refunds, shipping/delivery and affiliate disclosure policy documents/pages. Footer currently has non-linked labels.

### 20. SEO and marketing

- [ ] **Partially implemented** — Root title/description/canonical, robots and sitemap exist; per-product/category/collection/editorial metadata and SEO routes are absent.
- [ ] **Partially implemented** — Root Open Graph/Twitter metadata exists; dynamic product/collection sharing, structured product data and shareable routes remain absent.
- [ ] **Partially implemented** — Search-friendly root and source anchor exist; no real category/product/collection routes.

### 21. Testing and QA

- [ ] **Blocked by pre-existing issues** — Full `npm.cmd run lint` reports notification integration type errors in `App.tsx`, `CustomerAccount.tsx`, `AdminNotificationCentre.tsx` and `CustomerNotificationCentre.tsx`. The sourcing workbench and its direct frontend dependencies pass an isolated TypeScript check.
- [x] **Complete and verified** — Current automated suite passes: 2 files, 28 tests, including 8 sourcing domain cases. SQL/RLS and Edge Function behaviors remain untested.
- [ ] **Partially verified** — Vite production bundling succeeds with existing bundle-size/Zod warnings, but `npm.cmd run build` remains blocked by the full-project TypeScript errors above.
- [ ] **Not implemented** — Component tests, auth/payment/role/RLS/product-publishing/freshness tests and full end-to-end scenarios.
- [ ] **Partially implemented** — Sourcing → quote → accept → manual payment review → staff fulfilment elements exist; procurement execution, refund/cancel, affiliate click verification and reporting/export scenarios are not implemented.
- [ ] **Partially implemented** — No fabricated reviews, ratings, production metrics or availability were found in current storefront; full catalogue/product acceptance QA is absent.
- [ ] **Partially implemented** — The plain `npm.cmd test` and `npm.cmd run build` config-bundling path hits a restricted parent-directory access error in this OneDrive sandbox. `npm.cmd test -- --configLoader runner` and `npm.cmd exec vite build -- --configLoader runner` pass.

### 22. Development execution rules

- [x] **Complete and verified** — Existing implementation has been preserved; no destructive Git command or Android Studio/emulator installation was performed.
- [ ] **Partially implemented** — Documentation and config templates exist; authenticated Auth/RLS/workflow integration verification needs test accounts.
- [ ] **Not implemented** — Git checkpoints cannot be maintained until repository metadata is restored.

### 23. Deliverables

- [x] **Complete and verified** — Source code, web application, Supabase SQL migrations, demo seed, environment example, README, architecture/integration/admin/security documentation and project status exist.
- [ ] **Deployed; partially verified** — Production `sourcing-orchestrator` and `sourcing-worker` functions are active. Orchestrator JWT verification is enabled; worker gateway JWT verification is disabled and its secret-header check is active. CORS preflight succeeded for the configured production origin, and an unauthenticated worker request was correctly rejected. Authorized end-to-end sourcing remains untested. Scheduler and external provider integrations remain unconfigured.
- [ ] **Partially implemented** — Authentication, storefront, sourcing/quotation, customer account, admin sourcing/payment/order workflows and catalogue create/edit/publish are present; full product, supplier, finance and support systems are incomplete. Notification system is implemented (migrations, Edge Functions, adapters, customer notification centre, admin notification management, email templates, event integrations).
- [ ] **Partially implemented** — Capacitor configuration and Android build instructions exist; Android project and APK/AAB are not available.
- [ ] **Partially implemented** — A current source ZIP (hopNshop-current-source.zip) excludes secrets/build caches and Netlify/Vercel deployment instructions are documented; automated deployment pipeline is absent.
- [ ] **Complete and verified** — Known limitations and outstanding requirements are documented in this file.

### 24. Final acceptance criteria

- [x] **Complete and verified** — Web TypeScript check, domain tests and production build pass using the documented runner workaround.
- [ ] **Partially implemented** — Homepage, shared navigation, discovery cards and mobile bottom navigation follow the reference direction; mobile browser checks passed at target widths. Full account/admin visual review, tablet/device QA, official brand assets and a populated published catalogue remain.
- [ ] **Blocked by external credentials or approval** — Supplied official logo is not present in workspace.
- [ ] **Implemented but unverified** — Authentication paths are wired, but Supabase email settings/redirects and live account workflows are not tested.
- [ ] **Implemented but unverified** — SQL migrations are reported applied and representative anon table/RPC probes succeeded; authenticated RLS and business workflows remain untested.
- [ ] **Partially implemented** — Customer accounts, wishlist, sourcing, quote creation/acceptance, manual payment/refund review, staff fulfilment and admin/editor catalogue, variant and product media controls exist; live product detail/gallery/order variant and collection flows, affiliate conversion reconciliation, procurement and full support remain incomplete.
- [ ] **Partially implemented** — Affiliate link separation exists; approved program/disclosure/tracking and management flows are incomplete.
- [ ] **Partially implemented** — Role-gated admin workflows, operational counts and finance reports exist; live authorization, database and reporting validation remain.
- [ ] **Partially implemented** — Android identity/configuration exists; Android packaging and device acceptance are incomplete.
- [ ] **Not implemented** — Automated component, integration, security and end-to-end suites are absent.
- [ ] **Blocked by external credentials or approval** — Production payment, marketplace, supplier and regulatory readiness require external credentials/approvals.

## Verification in this continuation

- `npm.cmd run lint` — passed (`tsc --noEmit`) after the admin dashboard and manual refund workflow changes.
- `npm.cmd run lint` — passed (`tsc --noEmit`) after profile and saved-address changes.
- `npm.cmd run lint` — passed (`tsc --noEmit`) after the storefront filter and category-query changes.
- `npm.cmd test -- --configLoader runner` — passed: 1 test file, 19 tests, including category/currency discovery filters, profile and saved-address validation.
- `npm.cmd exec vite build -- --configLoader runner` — passed after the filter changes. Existing warnings: main bundle exceeds 500 kB and Rollup removes upstream Zod pure-annotation comments.
- `npm.cmd run lint`, `npm.cmd test -- --configLoader runner` and `npm.cmd exec vite build -- --configLoader runner` — passed after the responsive/auth UI review (19 tests).
- Browser QA — sign-in, sign-up and reset states checked at 320px; sign-in uses one email field, empty/malformed one-time-link addresses are rejected before network submission, and the reset view returns to sign-in. Homepage checked at 320–1440px without horizontal document overflow.
- Browser QA — the reference-derived hero image loads; sourcing dialog opens and closes; no horizontal overflow at 360, 390 or 412px; mobile bottom navigation appears at those widths and is hidden on desktop.
- Product catalogue — migrations are reported applied; browser query succeeds and shows the truthful empty-catalogue state because no published products are visible. Product-card interaction is therefore not yet live-data tested.
- Checkout saved-address integration — TypeScript check and production build pass; authenticated address RLS/data behavior still needs an account-based test.
- SQL migrations — the user reports applying earlier migration files, including `202611120003_sourcing_engine.sql`; production application of the sourcing migration was not independently queried. Taxonomy migration `202611120002_storefront_categories.sql` was also not independently confirmed. `psql` is not installed. Live anon probes returned HTTP 200 for `products`, `addresses`, `orders` and `refunds` (zero rows visible); the default-address RPC correctly rejected an anonymous call with its sign-in requirement.
- Supabase CLI was authenticated through `npx.cmd` and used to deploy both sourcing functions and configure server-side secrets. Authenticated customer/admin flows, refund and full Auth workflows remain untested.
- Live Auth health — HTTP 200. Actual email/password, magic-link and recovery flows remain untested pending Auth URL/email configuration and use of authorized test accounts.
- Sourcing continuation — `npm.cmd test -- --configLoader runner` passes 2 files/28 tests; isolated TypeScript check for `AdminSourcingWorkbench.tsx`, `domain.ts` and `supabase.ts` passes; Vite production bundling passes. Full `npm.cmd run build` remains blocked by pre-existing notification integration TypeScript errors. Deno typechecking and authorized sourcing flows have not been run.
- Sourcing production verification — Supabase reports both Edge Functions `ACTIVE`; orchestrator `verify_jwt=true`, worker `verify_jwt=false`. Orchestrator CORS preflight returned HTTP 200 with the configured origin; a worker POST without its secret returned HTTP 401 as intended. No authenticated admin/customer task processing has been verified. The user reports the sourcing migration was applied; RPC/RLS behavior remains unverified.
- Sourcing configuration — `SOURCING_ALLOWED_ORIGINS` and a randomly generated `SOURCING_WORKER_SECRET` are set server-side. The worker schedule is not configured or enabled. No supplier catalogue or AI provider credentials are configured, so external discovery/AI comparison are unavailable; the workbench can still use manual candidate review.
- Live catalogue — the browser now loads the catalogue query successfully and shows the truthful empty-catalogue state; no published products are visible.
- Git — unavailable because `.git` is absent.

## Highest-priority next task

Apply `supabase/migrations/202611120002_storefront_categories.sql` to publish the reference taxonomy, then use authorized customer/admin test accounts to verify authenticated RLS and profile/address, checkout, payment review, refund and fulfilment flows. Publish real reviewed products to validate the product cards and collections. Before release, restore `.git` and run end-to-end integration tests. Keep STK Push and supplier procurement disabled until credentials, provider registration and permissions are verified.






