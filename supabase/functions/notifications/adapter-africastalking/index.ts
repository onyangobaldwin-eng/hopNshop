const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AFRICASTALKING_USERNAME = Deno.env.get('AFRICASTALKING_USERNAME');
const AFRICASTALKING_API_KEY = Deno.env.get('AFRICASTALKING_API_KEY');
const AFRICASTALKING_FROM = Deno.env.get('AFRICASTALKING_FROM') || 'hopNshop';

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
      payload,
      idempotency_key,
    } = await req.json();

    if (!recipient || !body_text) {
      return new Response(JSON.stringify({ error: 'recipient and body_text are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // If credentials not configured, simulate (never claim real delivery)
    if (!AFRICASTALKING_USERNAME || !AFRICASTALKING_API_KEY) {
      console.warn('Africa\'s Talking credentials not configured - simulating SMS delivery');
      return new Response(
        JSON.stringify({
          status: 'simulated',
          provider: 'africastalking',
          message: 'Africa\'s Talking not configured - SMS NOT actually sent',
          idempotency_key,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const smsBody = body_text.length > 160 ? body_text.slice(0, 157) + '...' : body_text;

    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: AFRICASTALKING_API_KEY,
        username: AFRICASTALKING_USERNAME,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username: AFRICASTALKING_USERNAME,
        to: recipient,
        from: AFRICASTALKING_FROM,
        text: smsBody,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const body = await res.text();
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          provider: 'africastalking',
          error_code: String(res.status),
          error_message: parsed?.errorMessage ?? `Africa's Talking returned HTTP ${res.status}`,
          provider_response: parsed,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const recipients = parsed?.SMSMessageData?.Recipients ?? [];
    const first = recipients[0] ?? {};
    const status = first.status ?? 'sent';
    const providerMessageId = first.messageId ?? null;

    return new Response(
      JSON.stringify({
        status: status.toLowerCase().includes('fail') || status.toLowerCase().includes('error') ? 'failed' : 'sent',
        provider: 'africastalking',
        provider_message_id: providerMessageId,
        provider_response: parsed,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('adapter-africastalking error:', err);
    if (err.name === 'TimeoutError') {
      return new Response(
        JSON.stringify({ status: 'timeout', provider: 'africastalking', error_code: 'ETIMEDOUT', error_message: 'Africa\'s Talking request timed out' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});