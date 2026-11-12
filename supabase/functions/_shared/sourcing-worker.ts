import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assessSupplierRisk, compareProducts } from './sourcing-domain.ts';
import { createSupplierAdapter, SupplierAdapterError } from './sourcing-adapters.ts';
import { OpenAICompatibleSourcingAIProvider, SourcingAIError } from './sourcing-ai.ts';

interface SourcingTask {
  id: string;
  request_id: string | null;
  task_type: string;
  attempt_count: number;
  created_by: string | null;
}

interface SourcingRequest {
  id: string;
  user_id: string;
  status: string;
  title: string;
  product_name: string | null;
  brand_preference: string | null;
  model_specification: string | null;
  product_condition: string | null;
  variant: string | null;
  category_id: string | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected sourcing task failure.';
const errorCode = (error: unknown) => error instanceof SupplierAdapterError || error instanceof SourcingAIError
  ? error.code
  : 'sourcing_task_failed';

async function writeActivity(
  client: SupabaseClient,
  task: SourcingTask,
  eventType: string,
  metadata: Record<string, unknown>
) {
  const { error } = await client.from('sourcing_activity_logs').insert({
    request_id: task.request_id,
    task_id: task.id,
    actor_id: task.created_by,
    event_type: eventType,
    metadata
  });
  if (error) throw new Error(`Could not record sourcing activity: ${error.message}`);
}

async function updateIntegration(
  client: SupabaseClient,
  integrationId: string,
  status: 'connected' | 'not_configured' | 'failed',
  errorCode: string | null
) {
  const { error } = await client.from('supplier_integrations').update({
    last_tested_at: new Date().toISOString(),
    last_test_status: status,
    last_error_code: errorCode
  }).eq('id', integrationId);
  if (error) throw new Error(`Could not update supplier integration status: ${error.message}`);
}

async function notifyRequestOwner(client: SupabaseClient, task: SourcingTask, request: SourcingRequest, title: string, body: string) {
  const { error } = await client.from('notifications').upsert({
    user_id: request.user_id,
    title,
    body,
    event_type: 'sourcing_task_update',
    sourcing_task_id: task.id
  }, { onConflict: 'sourcing_task_id', ignoreDuplicates: true });
  if (error) throw new Error(`Could not save sourcing notification: ${error.message}`);
}

async function readSourcingRequest(client: SupabaseClient, task: SourcingTask) {
  if (!task.request_id) return null;
  const { data, error } = await client.from('sourcing_requests')
    .select('id,user_id,status,title,product_name,brand_preference,model_specification,product_condition,variant,category_id,budget_min,budget_max')
    .eq('id', task.request_id)
    .maybeSingle();
  if (error) throw new Error(`Could not load sourcing request: ${error.message}`);
  return data as SourcingRequest | null;
}

async function processDiscoveryTask(client: SupabaseClient, task: SourcingTask, request: SourcingRequest) {
  const { data: integrations, error: integrationError } = await client.from('supplier_integrations')
    .select('id,supplier_id,adapter_key,enabled')
    .eq('enabled', true);
  if (integrationError) throw new Error(`Could not load supplier integrations: ${integrationError.message}`);
  if (!integrations?.length) {
    return {
      outcome: 'awaiting_manual_review' as const,
      summary: { reason: 'No permitted supplier catalogue adapter is enabled. Continue with manual sourcing.' },
      errorCode: null,
      errorMessage: null,
      notifyOwner: true
    };
  }

  const query = [
    request.product_name ?? request.title,
    request.brand_preference,
    request.model_specification,
    request.product_condition
  ].filter(Boolean).join(' ').slice(0, 500);
  if (!query.trim()) {
    return {
      outcome: 'awaiting_manual_review' as const,
      summary: { reason: 'The request has no searchable product details.' },
      errorCode: null,
      errorMessage: null,
      notifyOwner: true
    };
  }

  const { data: existingResults, error: existingError } = await client.from('sourcing_results')
    .select('id,product_name,brand,model,specifications,variant,product_condition,source_url')
    .eq('request_id', request.id);
  if (existingError) throw new Error(`Could not load previous sourcing results: ${existingError.message}`);
  const existing = existingResults ?? [];
  let storedCount = 0;
  let duplicateCount = 0;
  let providerCount = 0;
  const settingsResult = await client.from('sourcing_settings')
    .select('setting_value')
    .eq('setting_key', 'ai_provider')
    .maybeSingle();
  if (settingsResult.error) throw new Error(`Could not load AI settings: ${settingsResult.error.message}`);
  const aiEnabled = settingsResult.data?.setting_value?.enabled === true;
  let aiAgent: OpenAICompatibleSourcingAIProvider | null = null;
  if (aiEnabled) {
    try {
      aiAgent = new OpenAICompatibleSourcingAIProvider();
    } catch (error) {
      if (!(error instanceof SourcingAIError)) throw error;
      await writeActivity(client, task, 'ai_evaluation_unavailable', { error_code: error.code });
    }
  }
  const { data: agent, error: agentError } = await client.from('sourcing_agents').select('id').eq('code', 'intelligence').maybeSingle();
  if (agentError) throw new Error(`Could not load sourcing agent: ${agentError.message}`);
  let aiEvaluated = false;

  for (const integration of integrations) {
    try {
      const adapter = createSupplierAdapter(integration.adapter_key);
      const listings = await adapter.search(query);
      providerCount++;
      await updateIntegration(client, integration.id, 'connected', null);

      const supplierResult = integration.supplier_id
        ? await client.from('suppliers')
          .select('id,name,country,website,contact_email,contact_phone,verification_status,verification_evidence')
          .eq('id', integration.supplier_id)
          .maybeSingle()
        : { data: null, error: null };
      if (supplierResult.error) throw new Error(`Could not load supplier evidence: ${supplierResult.error.message}`);

      for (const listing of listings.slice(0, 20)) {
        const exactDuplicate = existing.find((item: Record<string, unknown>) => item.source_url === listing.source_url);
        if (exactDuplicate) {
          duplicateCount++;
          continue;
        }

        const requestedProduct = {
          name: request.product_name ?? request.title,
          brand: request.brand_preference,
          model: request.model_specification,
          variant: request.variant,
          condition: request.product_condition
        };
        const candidateProduct = {
          name: listing.name,
          brand: listing.brand,
          model: listing.model,
          variant: listing.variant,
          condition: listing.product_condition,
          specifications: listing.specifications
        };
        const comparison = compareProducts(requestedProduct, candidateProduct);
        const possibleDuplicate = existing.find((item: Record<string, unknown>) => {
          if (typeof item.product_name !== 'string') return false;
          return compareProducts(
            candidateProduct,
            {
              name: item.product_name,
              brand: typeof item.brand === 'string' ? item.brand : null,
              model: typeof item.model === 'string' ? item.model : null,
              variant: typeof item.variant === 'string' ? item.variant : null,
              condition: typeof item.product_condition === 'string' ? item.product_condition : null,
              specifications: item.specifications && typeof item.specifications === 'object'
                ? item.specifications as Record<string, string | number | null>
                : null
            }
          ).outcome === 'possible_match';
        });
        const supplier = supplierResult.data;
        const evidence = assessSupplierRisk({
          humanVerified: supplier?.verification_status === 'verified',
          hasBusinessInformation: Boolean(supplier?.name && supplier?.country && supplier?.website),
          hasContactDetails: Boolean(supplier?.contact_email || supplier?.contact_phone),
          verificationDocuments: Array.isArray(supplier?.verification_evidence) ? supplier.verification_evidence.length : 0,
          sellerRating: listing.seller_rating,
          discrepancies: []
        });

        const comparisonOutput = { ...comparison, duplicate_of: possibleDuplicate?.id ?? null };
        const { data: savedRows, error: saveError } = await client.rpc('record_sourcing_result', {
          p_request_id: request.id,
          p_task_id: task.id,
          p_supplier_id: integration.supplier_id,
          p_actor_id: task.created_by,
          p_intelligence_agent_id: agent?.id ?? null,
          p_listing: {
            ...listing,
            supplier_location: listing.supplier_location ?? supplier?.country ?? null
          },
          p_comparison: comparisonOutput,
          p_risk: evidence
        });
        if (saveError?.code === '23505') {
          duplicateCount++;
          continue;
        }
        if (saveError) throw new Error(`Could not save sourced product: ${saveError.message}`);
        const savedResult = savedRows?.[0] as { result_id?: string; was_inserted?: boolean } | undefined;
        if (!savedResult?.result_id) throw new Error('Supplier listing was not saved.');
        if (!savedResult.was_inserted) {
          duplicateCount++;
          continue;
        }

        if (aiAgent && !aiEvaluated && comparison.score >= 65) {
          try {
            const aiResult = await aiAgent.evaluate({
              request: {
                productName: request.product_name,
                brand: request.brand_preference,
                model: request.model_specification,
                specifications: {}
              },
              listing: {
                productName: listing.name,
                brand: listing.brand ?? null,
                model: listing.model ?? null,
                specifications: listing.specifications
              }
            });
            const { error: aiError } = await client.from('sourcing_evaluations').insert({
              result_id: savedResult.result_id,
              agent_id: agent?.id ?? null,
              evaluation_type: 'comparison',
              score: aiResult.evaluation.match_score,
              output: aiResult.evaluation,
              provider_key: aiAgent.key,
              model_name: aiAgent.model,
              input_tokens: aiResult.inputTokens ?? null,
              output_tokens: aiResult.outputTokens ?? null,
              requires_human_review: true
            });
            if (aiError) throw new Error(`Could not record AI evaluation: ${aiError.message}`);
            aiEvaluated = true;
          } catch (error) {
            if (!(error instanceof SourcingAIError)) throw error;
            await writeActivity(client, task, 'ai_evaluation_unavailable', { error_code: errorCode(error) });
            aiEvaluated = true;
          }
        }

        existing.push({
          id: savedResult.result_id,
          product_name: listing.name,
          brand: listing.brand,
          model: listing.model,
          specifications: listing.specifications,
          variant: listing.variant,
          product_condition: listing.product_condition,
          source_url: listing.source_url
        });
        storedCount++;
      }
    } catch (error) {
      if (error instanceof SupplierAdapterError && error.code === 'provider_not_configured') {
        await updateIntegration(client, integration.id, 'not_configured', error.code);
        return {
          outcome: 'awaiting_manual_review' as const,
          summary: { reason: 'Supplier adapter credentials are not configured. Continue with manual sourcing.' },
          errorCode: null,
          errorMessage: null
        };
      }
      if (error instanceof SupplierAdapterError && !error.retryable) {
        await updateIntegration(client, integration.id, 'failed', error.code);
        return {
          outcome: 'awaiting_manual_review' as const,
          summary: { reason: 'Supplier adapter configuration needs review.' },
          errorCode: error.code,
          errorMessage: error.message
        };
      }
      throw error;
    }
  }

  if (providerCount === 0 || storedCount === 0) {
    return {
      outcome: 'awaiting_manual_review' as const,
      summary: {
        reason: providerCount === 0 ? 'No supplier adapter completed a search.' : 'No new candidate listings were returned; continue manual review.',
        provider_count: providerCount,
        discovered_count: storedCount,
        duplicate_count: duplicateCount
      },
      errorCode: null,
      errorMessage: null
    };
  }

  await writeActivity(client, task, 'candidates_discovered', { count: storedCount, duplicate_count: duplicateCount });
  return {
    outcome: 'completed' as const,
    summary: {
      provider_count: providerCount,
      discovered_count: storedCount,
      duplicate_count: duplicateCount,
      approval_required: true
    },
    errorCode: null,
    errorMessage: null
  };
}

async function processTask(client: SupabaseClient, task: SourcingTask) {
  const request = await readSourcingRequest(client, task);
  if (task.task_type !== 'discover' || !request) {
    return {
      outcome: 'awaiting_manual_review' as const,
      summary: { reason: 'This task type requires a configured sourcing workflow or an associated request.' },
      errorCode: null,
      errorMessage: null,
      notifyOwner: true
    };
  }
  if (!['submitted', 'reviewing'].includes(request.status)) {
    return {
      outcome: 'awaiting_manual_review' as const,
      summary: { reason: 'The request is no longer open for discovery; no supplier search was run.' },
      errorCode: null,
      errorMessage: null,
      notifyOwner: false
    };
  }
  return processDiscoveryTask(client, task, request);
}

export async function processSourcingQueue(client: SupabaseClient, limit = 2) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Queue limit must be a positive integer.');
  const safeLimit = Math.min(2, limit);
  const { data: tasks, error } = await client.rpc('claim_sourcing_tasks', { p_limit: safeLimit });
  if (error) throw new Error(`Could not claim sourcing tasks: ${error.message}`);

  const outcomes: Array<Record<string, unknown>> = [];
  for (const task of (tasks ?? []) as SourcingTask[]) {
    try {
      const result = await processTask(client, task);
      const { data: finished, error: finishError } = await client.rpc('finish_sourcing_task', {
        p_task_id: task.id,
        p_outcome: result.outcome,
        p_result_summary: result.summary,
        p_error_code: result.errorCode,
        p_error_message: result.errorMessage,
        p_retryable: true
      });
      if (finishError) throw new Error(`Could not finalize sourcing task: ${finishError.message}`);

      if (task.request_id && result.notifyOwner !== false) {
        try {
          const request = await readSourcingRequest(client, task);
          if (request) {
            await notifyRequestOwner(
              client,
              task,
              request,
              'Sourcing request update',
              result.outcome === 'completed'
                ? 'Possible product options have been found and still require staff review. Supplier availability and price are not confirmed; a separate quotation will follow if suitable.'
                : 'We have your request. A sourcing specialist will review possible options. No supplier, availability, or price is confirmed yet.'
            );
          }
        } catch (error) {
          await writeActivity(client, task, 'notification_delivery_failed', { error_code: errorCode(error) });
          outcomes.push({ taskId: task.id, status: finished?.status ?? result.outcome, summary: result.summary, notificationError: true });
          continue;
        }
      }
      outcomes.push({ taskId: task.id, status: finished?.status ?? result.outcome, summary: result.summary });
    } catch (error) {
      const code = errorCode(error);
      const message = errorText(error).slice(0, 1_000);
      const retryable = !(error instanceof SupplierAdapterError || error instanceof SourcingAIError) || error.retryable;
      const { data: finished, error: finishError } = await client.rpc('finish_sourcing_task', {
        p_task_id: task.id,
        p_outcome: 'failed',
        p_result_summary: { reason: 'Sourcing task failed.' },
        p_error_code: code,
        p_error_message: message,
        p_retryable: retryable
      });
      if (finishError) throw new Error(`Sourcing task failed and could not be recorded: ${finishError.message}`);
      if (finished?.status === 'failed' && task.request_id) {
        const request = await readSourcingRequest(client, task);
        if (request) {
          await notifyRequestOwner(
            client,
            task,
            request,
            'Sourcing request update',
            'Automated sourcing could not complete. Our team will continue manually. No supplier, availability, or price has been confirmed.'
          );
        }
      }
      outcomes.push({ taskId: task.id, status: finished?.status ?? 'failed', errorCode: code });
    }
  }

  return { processed: outcomes.length, outcomes };
}
