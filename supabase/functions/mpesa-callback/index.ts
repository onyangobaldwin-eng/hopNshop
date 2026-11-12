import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const payload = await req.json();
  const callback = payload?.Body?.stkCallback;
  const checkoutId = callback?.CheckoutRequestID;
  if (!checkoutId) return new Response('Accepted', { status: 202 });
  const resultCode = callback.ResultCode;
  const metadata = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map((item: { Name: string; Value?: unknown }) => [item.Name, item.Value]));
  const { error } = await supabase.from('payments').update({ status: resultCode === 0 ? 'provider_confirmed_pending_admin' : 'failed', transaction_reference: metadata.MpesaReceiptNumber ?? null, provider_payload: payload }).eq('idempotency_key', checkoutId);
  if (error) console.error('mpesa callback persistence failed', error.message);
  return new Response('Accepted', { status: 202 });
});
