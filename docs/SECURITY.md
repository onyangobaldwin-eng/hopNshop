# Security checklist

- Supabase RLS policies are defined for customer and staff data, including security-hardening migrations; apply every migration in filename order and validate policy isolation with separate customer/staff accounts before launch.
- Never expose service-role, Daraja or provider secrets in Vite environment variables or Git.
- Only accept HTTPS public source URLs; do not fetch arbitrary URLs from the browser or server without an approved adapter.
- Validate file type, size and ownership before Storage uploads; use private buckets for request media.
- Treat payment callbacks and customer-entered M-Pesa references as untrusted input. The current manual workflow leaves claims pending until an admin/finance user checks the official statement. The Daraja callback remains a scaffold and is not payment proof.
- Log privileged changes in `admin_audit_logs` without storing unnecessary personal data.
- Configure rate limits, CAPTCHA/abuse controls, backups, retention and incident response before public launch.
- Have Kenya Data Protection Act, consumer, tax, import and payment documents reviewed by qualified professionals; this repository makes no legal-certification claim.
