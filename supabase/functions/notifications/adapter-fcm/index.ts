const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIREBASE_SERVICE_ACCOUNT = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID');

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
      return new Response(JSON.stringify({ error: 'recipient (device_token) and body_text are required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    if (!FIREBASE_SERVICE_ACCOUNT || !FIREBASE_PROJECT_ID) {
      console.warn('Firebase credentials not configured - simulating push delivery');
      return new Response(
        JSON.stringify({
          status: 'simulated',
          provider: 'firebase',
          message: 'Firebase not configured - push NOT actually sent',
          idempotency_key,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await getFirebaseAccessToken(FIREBASE_SERVICE_ACCOUNT);

    const fcmPayload = {
      message: {
        token: recipient,
        notification: {
          title: subject ?? 'hopNshop Notification',
          body: body_text,
        },
        android: {
          notification: {
            icon: 'ic_notification',
            color: '#1A1A1A',
            clickAction: payload?.deep_link ?? 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: { title: subject ?? 'hopNshop Notification', body: body_text },
              clickAction: payload?.deep_link ?? 'FLUTTER_NOTIFICATION_CLICK',
            },
          },
        },
        data: payload ?? {},
      },
    };
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmPayload),
        signal: AbortSignal.timeout(25000),
      }
    );

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          status: 'failed',
          provider: 'firebase',
          error_code: String(res.status),
          error_message: body?.error?.message ?? `FCM returned HTTP ${res.status}`,
          provider_response: body,
        }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        status: 'sent',
        provider: 'firebase',
        provider_message_id: body.name ?? null,
        provider_response: body,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('adapter-fcm error:', err);
    if (err.name === 'TimeoutError') {
      return new Response(
        JSON.stringify({ status: 'timeout', provider: 'firebase', error_code: 'ETIMEDOUT', error_message: 'FCM request timed out' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: err.message ?? 'Internal error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});

async function getFirebaseAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };

  const enc = new TextEncoder();
  const signInput = `${b64urlEncode(header)}.${b64urlEncode(payload)}`;
  const keyData = await crypto.subtle.importKey(
    'pkcs8',
    enc.encode(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyData, enc.encode(signInput));
  const jwt = `${signInput}.${b64urlEncode(bytesToBase64Url(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Firebase auth failed: ${tokenBody?.error_description ?? tokenRes.status}`);
  }
  return tokenBody.access_token;
}

const enc = new TextEncoder();

function b64urlEncode(obj: any): string {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const bytes = enc.encode(json);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
  let binary = '';
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}