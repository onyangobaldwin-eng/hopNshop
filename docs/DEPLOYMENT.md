# Web deployment

The web client is a static Vite application. Deploy from the project root with Node.js 22 or newer.

## Netlify

1. Import the repository into Netlify.
2. Set the build command to `npm ci && npm run build` and the publish directory to `dist`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as site environment variables. The anon key is intended for public clients; never add a Supabase service-role key or Daraja secret to `VITE_*` variables.
4. Configure the production and preview origins in Supabase Auth URL Configuration and verify the email-link/password-reset redirect flows.
5. Apply all SQL migrations in `supabase/migrations/` in filename order to the intended Supabase project before enabling customer workflows. Run RLS and Storage ownership checks with separate customer and staff accounts.
6. Point the production domain at the site. Update the canonical URL, sitemap and robots configuration if the domain differs from `https://hopnshop.co.ke/`.

## Vercel

1. Import the repository into Vercel using the Vite preset.
2. Use `npm ci` for install, `npm run build` for build, and `dist` as the output directory.
3. Add the same two client environment variables for each deployment environment. Keep server-only keys in Supabase Edge Function secrets.
4. Configure Supabase Auth redirect allowlists for production and preview domains. Restrict production customer use to the verified production origin.
5. Apply the migrations and complete the checks listed in the Netlify section before launch.

## Backend and launch checks

- Deploy Edge Functions separately with the Supabase CLI. Set service-role and provider secrets with `supabase secrets set`; do not place them in the web host environment.
- Keep M-Pesa STK Push disabled until Daraja approval, credentials, registered callback and server-side callback validation are complete. Manual transaction submissions remain pending until an authorized finance/admin user checks the official statement.
- Confirm the private `sourcing-request-media` bucket exists with its enforced 5 MiB size and MIME configuration. The migration intentionally fails if a pre-existing bucket has unexpected settings.
- Confirm production catalogue content and affiliate links have documented approval, current prices and customer disclosures.
- Build locally with `npm run build`. In the restricted OneDrive development environment, use `npm.cmd exec vite build -- --configLoader runner` if esbuild cannot read above the workspace.

This repository does not include a Netlify/Vercel deployment pipeline, production credentials, or a production-readiness claim.
