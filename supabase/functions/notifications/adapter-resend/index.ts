const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') || 'hopNshop <notifications@hopnshop.local>';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      queue_id,
      user_id,
      channel,
      event_type,
      recipient,
      subject,
      body_text,
      body_html,
      payload,
      idempotency_key,
    } = await req.json();

    if (!recipient || !subject || !body_text) {
      return new Response(JSON.stringify({ error: 'recipient, subject and body_text are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // If Resend is not configured, simulate delivery (never claim real delivery)
    if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not configured - simulating email delivery');
      return new Response(
        JSON.stringify({
          status: 'simulated',
          provider: 'resend',
          message: 'Resend not configured - email NOT actually sent',
          idempotency_key,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const html = body_html || `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.6;color:#333;">
<h2 style="color:#1a1a1a;">${subject}</h2>
<p>${body_text.replace(/\n/g, '<br>')}</p>
<hr style="margin:2rem 0;border:none;border-top:1px solid #eee;">
<p style="font-size:0.875rem;color:#666;">You received this email because you are a hopNshop customer.</p>
</body></html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [recipient],
        subject,
        text: body_text,
        html,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          provider: 'resend',
          error_code: String(res.status),
          error_message: body?.message ?? `Resend API returned HTTP ${res.status}`,
          provider_response: body,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 'sent',
        provider: 'resend',
        provider_message_id: body.id ?? null,
        provider_response: body,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('adapter-resend error:', err);
    if (err.name === 'TimeoutError') {
      return new Response(
        JSON.stringify({ status: 'timeout', provider: 'resend', error_code: 'ETIMEDOUT', error_message: 'Resend request timed out' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});