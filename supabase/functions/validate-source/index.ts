const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function isPublicHttpsUrl(raw: string) {
  try { const u = new URL(raw); const h = u.hostname.toLowerCase(); return u.protocol === 'https:' && !u.username && !u.password && !['localhost','::1'].includes(h) && !/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h) && h.includes('.'); } catch { return false; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { url } = await req.json();
    if (typeof url !== 'string' || !isPublicHttpsUrl(url)) return new Response(JSON.stringify({ error: 'Only a public HTTPS product URL is accepted.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    // Deliberately do not fetch arbitrary URLs here. Marketplace extraction must use an approved API/feed adapter.
    return new Response(JSON.stringify({ status: 'manual_review_required', hostname: new URL(url).hostname, message: 'This source is queued for administrator review. No marketplace content was scraped.' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch { return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }); }
});
