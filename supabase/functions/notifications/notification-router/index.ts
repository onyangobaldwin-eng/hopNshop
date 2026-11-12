import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ADAPTER_MAP: Record<string, string> = {
  email: 'adapter-resend',
  sms: 'adapter-africastalking',
  push: 'adapter-fcm',
  in_app: 'adapter-inapp',
};

function logDelivery(
  supabase: any,
  queueId: string,
  channel: string,
  provider: string,
  status: string,
  fields: { provider_message_id?: string; error_code?: string; error_message?: string; request_payload?: any; provider_response?: any }
) {
  return supabase.from('notification_delivery_log').insert({
    queue_id: queueId,
    channel,
    provider,
    status,
    provider_message_id: fields.provider_message_id ?? null,
    error_code: fields.error_code ?? null,
    error_message: fields.error_message ?? null,
    request_payload: fields.request_payload ?? null,
    provider_response: fields.provider_response ?? null,
  });
}

async function callAdapter(
  supabase: any,
  adapterName: string,
  payload: any
): Promise<{ status: string; provider_message_id?: string; error_code?: string; error_message?: string; provider_response?: any }> {
  const functionUrl = `${SUPABASE_URL}/functions/v1/${adapterName}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        status: 'failed',
        error_code: String(res.status),
        error_message: body?.error ?? `Adapter ${adapterName} returned HTTP ${res.status}`,
        provider_response: body,
      };
    }

    return {
      status: body.status ?? 'sent',
      provider_message_id: body.provider_message_id ?? null,
      error_code: body.error_code ?? null,
      error_message: body.error_message ?? null,
      provider_response: body,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return {
        status: 'timeout',
        error_code: 'ETIMEDOUT',
        error_message: `Adapter ${adapterName} timed out after 25s`,
        provider_response: null,
      };
    }
    return {
      status: 'failed',
      error_code: err.code ?? 'UNKNOWN',
      error_message: err.message ?? 'Adapter call failed',
      provider_response: null,
    };
  }
}

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

  let supabase: any;
  try {
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { queue_id } = body;

    if (!queue_id) {
      return new Response(JSON.stringify({ error: 'queue_id is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { data: queue, error: fetchError } = await supabase
      .from('notification_queue')
      .select('*')
      .eq('id', queue_id)
      .in('status', ['pending', 'sending'])
      .order('attempts', { ascending: true })
      .maybeSingle();

    if (fetchError || !queue) {
      return new Response(JSON.stringify({ error: 'Queue item not found or already processed' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (queue.attempts >= queue.max_attempts) {
      await supabase
        .from('notification_queue')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', queue_id);
      return new Response(JSON.stringify({ error: 'Max delivery attempts exceeded' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    await supabase
      .from('notification_queue')
      .update({ status: 'sending', attempts: queue.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', queue_id);

    const adapterName = ADAPTER_MAP[queue.channel];
    if (!adapterName) {
      await supabase
        .from('notification_queue')
        .update({ status: 'failed', error_code: 'UNKNOWN_CHANNEL', error_message: `No adapter for channel ${queue.channel}`, updated_at: new Date().toISOString() })
        .eq('id', queue_id);
      return new Response(JSON.stringify({ error: `Unknown channel: ${queue.channel}` }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const adapterPayload = {
      queue_id: queue.id,
      user_id: queue.user_id,
      channel: queue.channel,
      event_type: queue.event_type,
      recipient: queue.recipient,
      subject: queue.subject,
      body_text: queue.body_text,
      body_html: queue.body_html,
      payload: queue.payload,
      idempotency_key: queue.idempotency_key,
    };

    const result = await callAdapter(supabase, adapterName, adapterPayload);

    await logDelivery(supabase, queue.id, queue.channel, adapterName, result.status, {
      provider_message_id: result.provider_message_id,
      error_code: result.error_code,
      error_message: result.error_message,
      request_payload: adapterPayload,
      provider_response: result.provider_response,
    });

    if (result.status === 'sent' || result.status === 'delivered') {
      await supabase
        .from('notification_queue')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          provider_response: result.provider_response ?? null,
        })
        .eq('id', queue.id);

      await supabase
        .from('notifications')
        .update({ delivery_status: 'delivered', provider_metadata: result.provider_response ?? {} })
        .eq('id', queue.id);

      return new Response(JSON.stringify({ status: 'delivered', queue_id: queue.id }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (result.status === 'suppressed') {
      await supabase
        .from('notification_queue')
        .update({
          status: 'suppressed',
          updated_at: new Date().toISOString(),
          error_code: result.error_code,
          error_message: result.error_message,
          provider_response: result.provider_response ?? null,
        })
        .eq('id', queue.id);
      return new Response(JSON.stringify({ status: 'suppressed', queue_id: queue.id }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const backoffSeconds = Math.min(60, Math.pow(2, queue.attempts));
    const nextAttempt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    await supabase
      .from('notification_queue')
      .update({
        status: 'failed',
        error_code: result.error_code,
        error_message: result.error_message,
        updated_at: new Date().toISOString(),
        scheduled_at: nextAttempt,
        provider_response: result.provider_response ?? null,
      })
      .eq('id', queue.id);

    return new Response(JSON.stringify({ status: 'failed', queue_id: queue.id, retry_at: nextAttempt }), {
      status: 202,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('notification-router error:', err);
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});