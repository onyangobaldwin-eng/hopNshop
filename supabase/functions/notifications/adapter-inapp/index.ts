import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

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

    if (!user_id || !body_text) {
      return new Response(JSON.stringify({ error: 'user_id and body_text are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Create the in-app notification record
    const { data: notification, error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id,
        title: subject ?? 'Notification',
        body: body_text,
        channel: 'in_app',
        event_type,
        deep_link: payload?.deep_link ?? null,
        related_order_id: payload?.related_order_id ?? null,
        related_quotation_id: payload?.related_quotation_id ?? null,
        related_sourcing_request_id: payload?.related_sourcing_request_id ?? null,
        provider_metadata: payload ?? {},
        delivery_status: 'delivered',
      })
      .select('id')
      .single();

    if (notifError) throw notifError;

    // Mark queue as delivered
    if (queue_id) {
      await supabase
        .from('notification_queue')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', queue_id);
    }

    // Broadcast via Supabase Realtime to the user's private channel
    try {
      await supabase.channel(`user:${user_id}`).send({
        type: 'broadcast',
        event: 'new_notification',
        payload: {
          id: notification.id,
          user_id,
          title: subject ?? 'Notification',
          body: body_text,
          event_type,
          deep_link: payload?.deep_link ?? null,
          created_at: new Date().toISOString(),
          read_at: null,
        },
      });
    } catch (realtimeErr) {
      // Realtime is best-effort; the notification is already persisted
      console.error('Realtime broadcast failed:', realtimeErr.message);
    }

    return new Response(
      JSON.stringify({ status: 'delivered', provider: 'supabase_realtime', notification_id: notification.id }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('adapter-inapp error:', err);
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});