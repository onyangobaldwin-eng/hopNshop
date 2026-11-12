import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { processSourcingQueue } from '../_shared/sourcing-worker.ts';

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function matchesSecret(provided: string, expected: string) {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const secret = Deno.env.get('SOURCING_WORKER_SECRET');
  const supplied = request.headers.get('x-sourcing-worker-secret');
  if (!secret || secret.length < 32 || !supplied || !(await matchesSecret(supplied, secret))) {
    return json({ error: 'Worker authentication failed.' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) return json({ error: 'Worker server configuration is incomplete.' }, 503);

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > 10_000) return json({ error: 'Request is too large.' }, 413);
  let payload: { limit?: number; jobKey?: string } = {};
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 10_000) return json({ error: 'Request is too large.' }, 413);
    if (body.trim()) {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json({ error: 'Request body must be a JSON object.' }, 400);
      }
      payload = parsed as { limit?: number; jobKey?: string };
    }
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  const limit = payload.limit ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) return json({ error: 'Queue limit must be between 1 and 2.' }, 400);
  if (payload.jobKey !== undefined && payload.jobKey !== 'daily-sourcing-review') {
    return json({ error: 'Unsupported scheduled sourcing job.' }, 400);
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  let job: { id: string; frequency_minutes: number; consecutive_failures: number } | null = null;
  if (payload.jobKey) {
    const { data, error } = await client.from('sourcing_scheduled_jobs')
      .select('id,frequency_minutes,consecutive_failures')
      .eq('job_key', payload.jobKey)
      .eq('enabled', true)
      .lte('next_run_at', new Date().toISOString())
      .maybeSingle();
    if (error) return json({ error: `Could not validate scheduled job: ${error.message}` }, 500);
    if (!data) return json({ ok: true, status: 'not_due' });
    job = data;
    const { error: startError } = await client.from('sourcing_scheduled_jobs').update({
      last_status: 'running',
      last_run_at: new Date().toISOString()
    }).eq('id', job.id);
    if (startError) return json({ error: `Could not start scheduled job: ${startError.message}` }, 500);
  }

  try {
    const result = await processSourcingQueue(client, limit);
    const hadFailedTask = result.outcomes.some(outcome => outcome.status === 'failed');
    if (job) {
      const failures = hadFailedTask ? job.consecutive_failures + 1 : 0;
      const interval = hadFailedTask
        ? Math.min(job.frequency_minutes, 1_440 * 2 ** Math.min(failures - 1, 3))
        : job.frequency_minutes;
      const { error } = await client.from('sourcing_scheduled_jobs').update({
        last_status: hadFailedTask ? 'failed' : 'completed',
        consecutive_failures: failures,
        last_error: hadFailedTask ? 'One or more sourcing tasks failed; see task history.' : null,
        next_run_at: new Date(Date.now() + interval * 60_000).toISOString()
      }).eq('id', job.id);
      if (error) return json({ error: `Sourcing ran but its schedule status could not be saved: ${error.message}`, result }, 500);
    }
    return json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sourcing worker failure.';
    console.error('Sourcing worker failed.', message);
    if (job) {
      const failures = job.consecutive_failures + 1;
      const interval = Math.min(job.frequency_minutes, 1_440 * 2 ** Math.min(failures - 1, 3));
      const { error: statusError } = await client.from('sourcing_scheduled_jobs').update({
        last_status: 'failed',
        consecutive_failures: failures,
        last_error: message.slice(0, 1_000),
        next_run_at: new Date(Date.now() + interval * 60_000).toISOString()
      }).eq('id', job.id);
      if (statusError) console.error('Could not record sourcing schedule failure.', statusError.message);
    }
    return json({ error: message }, 500);
  }
});
