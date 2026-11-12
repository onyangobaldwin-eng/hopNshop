import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@4.1.8';
import {
  assessSupplierRisk,
  calculateLandedCostValues,
  compareProducts
} from '../_shared/sourcing-domain.ts';
import { createSupplierAdapter, isPublicHttpsUrl } from '../_shared/sourcing-adapters.ts';
import { processSourcingQueue } from '../_shared/sourcing-worker.ts';

const maxBodyBytes = 100_000;
const currencyCode = z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase());
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const manualListingSchema = z.object({
  productName: z.string().trim().min(1).max(300),
  sourceUrl: z.string().url().max(2_000),
  supplierPrice: z.number().finite().positive().max(999_999_999_999.99),
  currency: currencyCode,
  supplierId: z.string().uuid().nullable().optional(),
  brand: optionalText(200),
  model: optionalText(200),
  specifications: z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.null()])).default({}),
  variant: optionalText(200),
  productCondition: optionalText(100),
  supplierLocation: optionalText(200),
  imageUrl: z.string().url().max(2_000).nullable().optional(),
  availabilityInformation: optionalText(500),
  sellerRating: z.number().finite().min(0).max(5).nullable().optional()
});

const costInputSchema = z.object({
  supplierPrice: z.number().finite().positive().max(999_999_999_999.99),
  currency: currencyCode,
  exchangeRateToKes: z.number().finite().positive().max(1_000_000).optional(),
  shippingKes: z.number().finite().min(0).max(999_999_999_999.99),
  insuranceKes: z.number().finite().min(0).max(999_999_999_999.99),
  importCostsKes: z.number().finite().min(0).max(999_999_999_999.99),
  otherExpensesKes: z.number().finite().min(0).max(999_999_999_999.99),
  markupPercent: z.number().finite().min(0).max(10_000).optional(),
  targetSellingPriceKes: z.number().finite().positive().max(999_999_999_999.99).optional()
}).superRefine((input, context) => {
  if (input.currency !== 'KES' && input.exchangeRateToKes === undefined) {
    context.addIssue({ code: 'custom', path: ['exchangeRateToKes'], message: 'A verified exchange rate is required for non-KES prices.' });
  }
  if ((input.markupPercent === undefined) === (input.targetSellingPriceKes === undefined)) {
    context.addIssue({ code: 'custom', path: ['markupPercent'], message: 'Provide either a markup percentage or a target selling price.' });
  }
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('run_queue'), limit: z.number().int().min(1).max(2).default(2) }),
  z.object({
    action: z.literal('queue_request'),
    requestId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(200)
  }),
  z.object({
    action: z.literal('add_manual_result'),
    requestId: z.string().uuid(),
    result: manualListingSchema
  }),
  z.object({
    action: z.literal('review_result'),
    resultId: z.string().uuid(),
    decision: z.enum(['approved', 'rejected', 'research_required']),
    comments: z.string().trim().max(5_000).optional()
  }),
  z.object({
    action: z.literal('manage_request'),
    requestId: z.string().uuid(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    assignedAgentId: z.string().uuid().nullable(),
    internalNotes: z.string().max(10_000)
  }),
  z.object({
    action: z.literal('save_cost'),
    requestId: z.string().uuid().nullable(),
    resultId: z.string().uuid().nullable(),
    input: costInputSchema,
    calculationStatus: z.enum(['estimated', 'confirmed']),
    evidenceReference: z.string().trim().min(3).max(500).optional(),
    overrideReason: z.string().trim().min(3).max(1_000).optional()
  }).refine(value => value.requestId !== null || value.resultId !== null, {
    message: 'A request or sourcing result is required.'
  }).refine(value => value.calculationStatus !== 'confirmed' || Boolean(value.evidenceReference), {
    message: 'Confirmed cost data requires an evidence reference.'
  }).refine(value => value.input.targetSellingPriceKes === undefined || Boolean(value.overrideReason), {
    message: 'A reason is required when entering a target selling price.'
  }),
  z.object({
    action: z.literal('save_integration'),
    integrationKey: z.string().trim().min(1).max(100),
    supplierId: z.string().uuid().nullable(),
    enabled: z.boolean()
  }),
  z.object({ action: z.literal('test_integration'), integrationId: z.string().uuid() }),
  z.object({
    action: z.literal('set_ai_enabled'),
    enabled: z.boolean()
  }),
  z.object({
    action: z.literal('set_schedule'),
    jobKey: z.literal('daily-sourcing-review'),
    enabled: z.boolean(),
    frequencyMinutes: z.number().int().min(1_440).max(10_080)
  })
]);

type Action = z.infer<typeof actionSchema>;
type JsonRecord = Record<string, unknown>;

class SourcingActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SourcingActionError';
  }
}

const jsonResponse = (body: JsonRecord, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });

function getCors(origin: string | null) {
  const allowedOrigins = (Deno.env.get('SOURCING_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) return null;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

async function checkStaff(userClient: ReturnType<typeof createClient>) {
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return { user: null, error: 'Authentication required.' };
  const [adminResult, editorResult] = await Promise.all([
    userClient.rpc('has_role', { required_role: 'admin' }),
    userClient.rpc('has_role', { required_role: 'editor' })
  ]);
  if (adminResult.error || editorResult.error) throw new Error('Could not verify staff permissions.');
  if (adminResult.data !== true && editorResult.data !== true) return { user: null, error: 'Sourcing staff access required.' };
  return { user: userData.user, error: null };
}

async function loadStatus(client: ReturnType<typeof createClient>) {
  const [
    integrations,
    agents,
    suppliers,
    settings,
    jobs,
    queued,
    running,
    awaitingReview,
    failed,
    results
  ] = await Promise.all([
    client.from('supplier_integrations').select('id,integration_key,supplier_id,adapter_key,enabled,last_tested_at,last_test_status,last_error_code').order('created_at', { ascending: false }),
    client.from('sourcing_agents').select('id,code,name,enabled,execution_status,last_execution_at,completed_tasks,failed_tasks').order('code'),
    client.from('suppliers').select('id,name').order('name').limit(200),
    client.from('sourcing_settings').select('setting_key,setting_value,updated_at').in('setting_key', ['automation', 'ai_provider']),
    client.from('sourcing_scheduled_jobs').select('id,job_key,job_type,enabled,frequency_minutes,next_run_at,last_run_at,last_status,consecutive_failures,last_error'),
    client.from('sourcing_tasks').select('id', { count: 'exact', head: true }).in('status', ['queued', 'retrying']),
    client.from('sourcing_tasks').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    client.from('sourcing_results').select('id', { count: 'exact', head: true }).eq('status', 'awaiting_approval'),
    client.from('sourcing_tasks').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    client.from('sourcing_results').select('id', { count: 'exact', head: true })
  ]);
  const queries = [integrations, agents, suppliers, settings, jobs, queued, running, awaitingReview, failed, results];
  const queryError = queries.find(result => result.error)?.error;
  if (queryError) throw new Error(`Could not load sourcing status: ${queryError.message}`);

  const aiEnabled = settings.data?.find(row => row.setting_key === 'ai_provider')?.setting_value?.enabled === true;
  return {
    integrations: integrations.data ?? [],
    agents: agents.data ?? [],
    suppliers: suppliers.data ?? [],
    settings: settings.data ?? [],
    scheduledJobs: jobs.data ?? [],
    providers: {
      supplierCatalog: Boolean(Deno.env.get('SUPPLIER_CATALOG_API_URL') && Deno.env.get('SUPPLIER_CATALOG_API_KEY') && Deno.env.get('SUPPLIER_CATALOG_ALLOWED_HOSTS')),
      ai: Boolean(Deno.env.get('SOURCING_AI_API_BASE_URL') && Deno.env.get('SOURCING_AI_API_KEY') && Deno.env.get('SOURCING_AI_MODEL') && Deno.env.get('SOURCING_AI_ALLOWED_HOSTS')),
      workerSecret: (Deno.env.get('SOURCING_WORKER_SECRET')?.length ?? 0) >= 32,
      scheduler: Deno.env.get('SOURCING_SCHEDULER_CONFIGURED') === 'true'
    },
    aiEnabled,
    volume: {
      queued: queued.count ?? 0,
      running: running.count ?? 0,
      awaitingReview: awaitingReview.count ?? 0,
      failed: failed.count ?? 0,
      totalResults: results.count ?? 0
    }
  };
}

async function addManualResult(
  client: ReturnType<typeof createClient>,
  actorId: string,
  requestId: string,
  value: z.infer<typeof manualListingSchema>
) {
  if (!isPublicHttpsUrl(value.sourceUrl) || (value.imageUrl && !isPublicHttpsUrl(value.imageUrl))) {
    throw new SourcingActionError('Use public HTTPS URLs for the product and image references.', 400);
  }
  let supplier: Record<string, unknown> | null = null;
  if (value.supplierId) {
    const { data, error } = await client.from('suppliers')
      .select('id,name,country,website,contact_email,contact_phone,verification_status,verification_evidence')
      .eq('id', value.supplierId)
      .maybeSingle();
    if (error) throw new Error(`Could not load supplier evidence: ${error.message}`);
    if (!data) throw new SourcingActionError('Selected supplier was not found.', 404);
    supplier = data;
  }

  const { data: request, error: requestError } = await client.from('sourcing_requests')
    .select('id,status,title,product_name,brand_preference,model_specification,product_condition,variant')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) throw new Error(`Could not load sourcing request: ${requestError.message}`);
  if (!request) throw new SourcingActionError('Sourcing request was not found.', 404);
  if (!['submitted', 'reviewing'].includes(request.status)) {
    throw new SourcingActionError('Only open sourcing requests can receive new candidates.', 409);
  }

  const comparison = compareProducts(
    {
      name: request.product_name ?? request.title,
      brand: request.brand_preference,
      model: request.model_specification,
      variant: request.variant,
      condition: request.product_condition
    },
    {
      name: value.productName,
      brand: value.brand ?? null,
      model: value.model ?? null,
      variant: value.variant ?? null,
      condition: value.productCondition ?? null,
      specifications: value.specifications
    }
  );
  const { data: existingResults, error: existingError } = await client.from('sourcing_results')
    .select('id,product_name,brand,model,specifications,variant,product_condition')
    .eq('request_id', requestId);
  if (existingError) throw new Error(`Could not check for duplicate candidates: ${existingError.message}`);
  const possibleDuplicate = existingResults?.find(existing =>
    compareProducts(
      {
        name: value.productName,
        brand: value.brand ?? null,
        model: value.model ?? null,
        variant: value.variant ?? null,
        condition: value.productCondition ?? null,
        specifications: value.specifications
      },
      {
        name: existing.product_name,
        brand: existing.brand,
        model: existing.model,
        variant: existing.variant,
        condition: existing.product_condition,
        specifications: existing.specifications
      }
    ).outcome === 'possible_match'
  );
  const risk = assessSupplierRisk({
    humanVerified: supplier?.verification_status === 'verified',
    hasBusinessInformation: Boolean(supplier?.name && supplier?.country && supplier?.website),
    hasContactDetails: Boolean(supplier?.contact_email || supplier?.contact_phone),
    verificationDocuments: Array.isArray(supplier?.verification_evidence) ? supplier.verification_evidence.length : 0,
    sellerRating: value.sellerRating,
    discrepancies: []
  });
  const { data, error } = await client.rpc('record_sourcing_result', {
    p_request_id: requestId,
    p_task_id: null,
    p_supplier_id: value.supplierId ?? null,
    p_actor_id: actorId,
    p_intelligence_agent_id: null,
    p_listing: {
      name: value.productName,
      source_url: value.sourceUrl,
      supplier_price: value.supplierPrice,
      currency: value.currency,
      brand: value.brand ?? null,
      model: value.model ?? null,
      specifications: value.specifications,
      variant: value.variant ?? null,
      product_condition: value.productCondition ?? null,
      supplier_location: value.supplierLocation ?? supplier?.country ?? null,
      image_url: value.imageUrl ?? null,
      availability_information: value.availabilityInformation ?? null,
      seller_rating: value.sellerRating ?? null
    },
    p_comparison: { ...comparison, duplicate_of: possibleDuplicate?.id ?? null },
    p_risk: risk
  });
  if (error) throw new Error(`Could not save manual sourcing result: ${error.message}`);
  const saved = data?.[0] as { result_id?: string; was_inserted?: boolean } | undefined;
  if (!saved?.result_id) throw new Error('Manual sourcing result was not saved.');
  return { resultId: saved.result_id, wasInserted: saved.was_inserted === true, comparison, risk };
}

async function handleAction(
  action: Action,
  userClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>,
  actorId: string
) {
  switch (action.action) {
    case 'status':
      return await loadStatus(serviceClient);
    case 'run_queue':
      return await processSourcingQueue(serviceClient, action.limit);
    case 'queue_request': {
      const { data, error } = await userClient.rpc('enqueue_sourcing_task', {
        p_request_id: action.requestId,
        p_task_type: 'discover',
        p_idempotency_key: action.idempotencyKey
      });
      if (error) throw new Error(`Could not queue sourcing request: ${error.message}`);
      return { tasks: data ?? [] };
    }
    case 'add_manual_result':
      return await addManualResult(serviceClient, actorId, action.requestId, action.result);
    case 'review_result': {
      const { data, error } = await userClient.rpc('review_sourcing_result', {
        p_result_id: action.resultId,
        p_decision: action.decision,
        p_comments: action.comments ?? null
      });
      if (error) throw new Error(`Could not save sourcing review: ${error.message}`);
      return { result: data };
    }
    case 'manage_request': {
      const { data, error } = await userClient.rpc('update_sourcing_request_management', {
        p_request_id: action.requestId,
        p_priority: action.priority,
        p_assigned_agent_id: action.assignedAgentId,
        p_internal_notes: action.internalNotes
      });
      if (error) throw new Error(`Could not update sourcing request: ${error.message}`);
      return { request: data };
    }
    case 'save_cost': {
      if (action.resultId && action.requestId) {
        const { data: result, error: resultError } = await serviceClient.from('sourcing_results')
          .select('request_id')
          .eq('id', action.resultId)
          .maybeSingle();
        if (resultError) throw new Error(`Could not validate sourcing result: ${resultError.message}`);
          if (!result) throw new SourcingActionError('Sourcing result was not found.', 404);
          if (result.request_id !== action.requestId) throw new SourcingActionError('The sourcing result does not belong to this request.', 400);
      }
      const input = action.input;
      const exchangeRateToKes = input.exchangeRateToKes ?? (input.currency === 'KES' ? 1 : undefined);
      if (exchangeRateToKes === undefined) throw new SourcingActionError('A verified exchange rate is required for non-KES prices.', 400);
      const output = calculateLandedCostValues({ ...input, exchangeRateToKes });
      if (Object.values(output).some(value => typeof value === 'number' && !Number.isFinite(value))) {
        throw new SourcingActionError('Cost calculation exceeds supported numeric limits.', 400);
      }
      const inputSnapshot = {
        ...input,
        exchangeRateToKes,
        evidenceReference: action.evidenceReference ?? null,
        overrideReason: action.overrideReason ?? null
      };
      const { data, error } = await serviceClient.rpc('record_sourcing_cost', {
        p_request_id: action.requestId,
        p_result_id: action.resultId,
        p_actor_id: actorId,
        p_input: inputSnapshot,
        p_output: output,
        p_calculation_status: action.calculationStatus,
        p_evidence_reference: action.evidenceReference ?? null,
        p_override_reason: action.overrideReason ?? null
      });
      if (error) throw new Error(`Could not save sourcing cost calculation: ${error.message}`);
      return { calculationId: data, output, calculationStatus: action.calculationStatus };
    }
    case 'save_integration': {
      if (action.supplierId) {
        const { data: supplier, error: supplierError } = await serviceClient.from('suppliers')
          .select('id').eq('id', action.supplierId).maybeSingle();
        if (supplierError) throw new Error(`Could not validate supplier: ${supplierError.message}`);
        if (!supplier) throw new SourcingActionError('Selected supplier was not found.', 404);
      }
      const configured = Boolean(
        Deno.env.get('SUPPLIER_CATALOG_API_URL')
        && Deno.env.get('SUPPLIER_CATALOG_API_KEY')
        && Deno.env.get('SUPPLIER_CATALOG_ALLOWED_HOSTS')
      );
      const enabled = action.enabled && configured;
      if (enabled) {
        const { data: otherEnabled, error: existingError } = await serviceClient.from('supplier_integrations')
          .select('integration_key')
          .eq('enabled', true)
          .neq('integration_key', action.integrationKey)
          .limit(1)
          .maybeSingle();
        if (existingError) throw new Error(`Could not validate existing supplier integrations: ${existingError.message}`);
        if (otherEnabled) {
          throw new SourcingActionError('This adapter uses one server-configured catalogue endpoint; disable the other integration first.', 409);
        }
      }
      const { data, error } = await serviceClient.from('supplier_integrations').upsert({
        integration_key: action.integrationKey,
        supplier_id: action.supplierId,
        adapter_key: 'json_catalog',
        enabled,
        endpoint_secret_name: 'SUPPLIER_CATALOG_API_URL',
        token_secret_name: 'SUPPLIER_CATALOG_API_KEY',
        last_test_status: configured ? 'not_tested' : 'not_configured',
        last_error_code: configured ? null : 'provider_not_configured'
      }, { onConflict: 'integration_key' }).select('id,integration_key,supplier_id,adapter_key,enabled,last_test_status,last_error_code').single();
      if (error) throw new Error(`Could not save supplier integration: ${error.message}`);
      return { integration: data, providerConfigured: configured };
    }
    case 'test_integration': {
      const { data: integration, error: integrationError } = await serviceClient.from('supplier_integrations')
        .select('id,adapter_key')
        .eq('id', action.integrationId)
        .maybeSingle();
      if (integrationError) throw new Error(`Could not load supplier integration: ${integrationError.message}`);
      if (!integration) throw new Error('Supplier integration was not found.');
      let returnedListings: number;
      try {
        const adapter = createSupplierAdapter(integration.adapter_key);
        const sample = await adapter.search('hopNshop sourcing connection test');
        returnedListings = sample.length;
      } catch (error) {
        const errorCode = error instanceof Error && 'code' in error ? String(error.code) : 'provider_test_failed';
        const status = errorCode === 'provider_not_configured' ? 'not_configured' : 'failed';
        const { error: updateError } = await serviceClient.from('supplier_integrations').update({
          last_tested_at: new Date().toISOString(),
          last_test_status: status,
          last_error_code: errorCode
        }).eq('id', integration.id);
        if (updateError) throw new Error(`Provider test failed and status could not be saved: ${updateError.message}`);
        return { status, errorCode };
      }
      const { error: updateError } = await serviceClient.from('supplier_integrations').update({
        last_tested_at: new Date().toISOString(),
        last_test_status: 'connected',
        last_error_code: null
      }).eq('id', integration.id);
      if (updateError) throw new Error(`Provider responded, but integration status could not be saved: ${updateError.message}`);
      return { status: 'connected', returnedListings };
    }
    case 'set_ai_enabled': {
      const configured = Boolean(
        Deno.env.get('SOURCING_AI_API_BASE_URL')
        && Deno.env.get('SOURCING_AI_API_KEY')
        && Deno.env.get('SOURCING_AI_MODEL')
        && Deno.env.get('SOURCING_AI_ALLOWED_HOSTS')
      );
      if (action.enabled && !configured) throw new SourcingActionError('Configure all server-side AI secrets before enabling AI comparison.', 409);
      const { error } = await serviceClient.from('sourcing_settings').upsert({
        setting_key: 'ai_provider',
        setting_value: { enabled: action.enabled, provider: action.enabled ? 'openai_compatible' : null },
        updated_by: actorId
      }, { onConflict: 'setting_key' });
      if (error) throw new Error(`Could not update AI sourcing setting: ${error.message}`);
      return { enabled: action.enabled, configured };
    }
    case 'set_schedule': {
      if (action.enabled && (Deno.env.get('SOURCING_WORKER_SECRET')?.length ?? 0) < 32) {
        throw new SourcingActionError('Configure a worker secret of at least 32 characters before enabling scheduled sourcing jobs.', 409);
      }
      if (action.enabled && Deno.env.get('SOURCING_SCHEDULER_CONFIGURED') !== 'true') {
        throw new SourcingActionError('Configure and verify the Supabase scheduled invocation before enabling this job.', 409);
      }
      const { data, error } = await serviceClient.from('sourcing_scheduled_jobs').update({
        enabled: action.enabled,
        frequency_minutes: action.frequencyMinutes,
        next_run_at: action.enabled ? new Date(Date.now() + action.frequencyMinutes * 60_000).toISOString() : null,
        last_status: action.enabled ? 'idle' : 'disabled',
        last_error: null
      }).eq('job_key', action.jobKey).select('id,job_key,job_type,enabled,frequency_minutes,next_run_at,last_status').single();
      if (error) throw new Error(`Could not update sourcing schedule: ${error.message}`);
      return { job: data };
    }
  }
}

Deno.serve(async request => {
  const corsHeaders = getCors(request.headers.get('origin'));
  if (!corsHeaders) return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, corsHeaders);

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Authentication required.' }, 401, corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Sourcing server configuration is incomplete.' }, 503, corsHeaders);
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBodyBytes) return jsonResponse({ error: 'Request is too large.' }, 413, corsHeaders);
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ error: 'Request body could not be read.' }, 400, corsHeaders);
  }
  if (new TextEncoder().encode(rawBody).length > maxBodyBytes) {
    return jsonResponse({ error: 'Request is too large.' }, 413, corsHeaders);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, corsHeaders);
  }
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) return jsonResponse({ error: 'Invalid sourcing action.', details: parsed.error.issues }, 400, corsHeaders);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  let staff: Awaited<ReturnType<typeof checkStaff>>;
  try {
    staff = await checkStaff(userClient);
  } catch (error) {
    console.error('Sourcing role verification failed.', error);
    return jsonResponse({ error: 'Could not verify sourcing permissions.' }, 503, corsHeaders);
  }
  if (!staff.user) return jsonResponse({ error: staff.error ?? 'Sourcing staff access required.' }, 403, corsHeaders);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  try {
    const result = await handleAction(parsed.data, userClient, serviceClient, staff.user.id);
    return jsonResponse({ ok: true, result }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected sourcing operation failure.';
    console.error('Sourcing operation failed.', message);
    return jsonResponse({ error: message }, error instanceof SourcingActionError ? error.status : 500, corsHeaders);
  }
});
