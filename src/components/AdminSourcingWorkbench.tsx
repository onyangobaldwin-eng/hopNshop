import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { isValidPublicProductUrl } from '../lib/domain';
import { supabase } from '../lib/supabase';

interface SourcingRequest {
  id: string;
  title: string;
  product_url: string;
  product_name: string | null;
  quantity: number;
  variant: string | null;
  notes: string | null;
  customer_requirements: string | null;
  brand_preference: string | null;
  model_specification: string | null;
  product_condition: string | null;
  preferred_location: string | null;
  priority: string;
  status: string;
  assigned_agent_id: string | null;
  internal_notes: string | null;
  created_at: string;
}

interface SourcingResult {
  id: string;
  request_id: string;
  product_name: string;
  brand: string | null;
  model: string | null;
  source_url: string;
  supplier_price: number | string;
  currency: string;
  availability_information: string | null;
  seller_rating: number | string | null;
  risk_classification: string;
  risk_reasons: string[];
  intelligence_score: number | null;
  status: string;
  supplier_id: string | null;
  verification_status: string;
  duplicate_of: string | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface WorkbenchStatus {
  suppliers: Supplier[];
  integrations: {
    id: string;
    integration_key: string;
    supplier_id: string | null;
    enabled: boolean;
    last_tested_at: string | null;
    last_test_status: string;
    last_error_code: string | null;
  }[];
  agents: { id: string; code: string; name: string; enabled: boolean; execution_status: string }[];
  scheduledJobs: { job_key: string; enabled: boolean; frequency_minutes: number; next_run_at: string | null; last_status: string }[];
  providers: { supplierCatalog: boolean; ai: boolean; workerSecret: boolean; scheduler: boolean };
  aiEnabled: boolean;
  volume: { queued: number; running: number; awaitingReview: number; failed: number; totalResults: number };
}

interface TaskRecord {
  id: string;
  request_id: string | null;
  task_type: string;
  status: string;
  attempt_count: number;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

interface LandedCostSummary {
  supplierCostKes: number;
  totalCostKes: number;
  sellingPriceKes: number;
  grossProfitKes: number;
  grossMarginPercent: number;
}

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not run';

function ManualResultForm({
  request,
  suppliers,
  onSave
}: {
  request: SourcingRequest;
  suppliers: Supplier[];
  onSave: (requestId: string, value: Record<string, unknown>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const sourceUrl = String(data.get('sourceUrl') ?? '').trim();
    const supplierPrice = Number(data.get('supplierPrice'));
    const currency = String(data.get('currency') ?? '').trim().toUpperCase();
    if (!isValidPublicProductUrl(sourceUrl) || !Number.isFinite(supplierPrice) || supplierPrice <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      setMessage('Enter a public HTTPS product link, positive supplier price and three-letter currency.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      await onSave(request.id, {
        productName: String(data.get('productName') ?? '').trim(),
        sourceUrl,
        supplierPrice,
        currency,
        supplierId: String(data.get('supplierId') ?? '') || null,
        brand: String(data.get('brand') ?? '').trim() || null,
        model: String(data.get('model') ?? '').trim() || null,
        variant: String(data.get('variant') ?? '').trim() || null,
        productCondition: String(data.get('productCondition') ?? '').trim() || null,
        supplierLocation: String(data.get('supplierLocation') ?? '').trim() || null,
        availabilityInformation: String(data.get('availabilityInformation') ?? '').trim() || null,
        sellerRating: String(data.get('sellerRating') ?? '') ? Number(data.get('sellerRating')) : null,
        specifications: {}
      });
      form.reset();
      setMessage('Candidate saved for human review. It is not a quotation or confirmed offer.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Candidate could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <details className="sourcing-tool">
    <summary>Add a candidate manually</summary>
    <form className="sourcing-admin-form" onSubmit={submit}>
      <label>Candidate name<input name="productName" required minLength={1} maxLength={300} /></label>
      <label>Public product URL<input name="sourceUrl" required type="url" maxLength={2000} placeholder="https://" /></label>
      <div className="sourcing-admin-grid">
        <label>Supplier<select name="supplierId" defaultValue=""><option value="">Not linked to a supplier</option>{suppliers.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Brand<input name="brand" maxLength={200} /></label>
        <label>Model<input name="model" maxLength={200} /></label>
        <label>Variant<input name="variant" maxLength={200} /></label>
        <label>Condition<input name="productCondition" maxLength={100} /></label>
        <label>Supplier location<input name="supplierLocation" maxLength={200} /></label>
        <label>Supplier price<input name="supplierPrice" required type="number" min="0.01" max="999999999999.99" step="0.01" /></label>
        <label>Currency<input name="currency" required minLength={3} maxLength={3} defaultValue="KES" /></label>
        <label>Seller rating<input name="sellerRating" type="number" min="0" max="5" step="0.01" /></label>
      </div>
      <label>Availability notes<input name="availabilityInformation" maxLength={500} /></label>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save review candidate'}</button>
    </form>
  </details>;
}

function SourcingResultCard({
  result,
  onReview,
  onSaveCost
}: {
  result: SourcingResult;
  onReview: (resultId: string, decision: string, comments: string) => Promise<void>;
  onSaveCost: (requestId: string, resultId: string, values: Record<string, unknown>) => Promise<LandedCostSummary>;
}) {
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [costSummary, setCostSummary] = useState<LandedCostSummary | null>(null);
  const [costStatus, setCostStatus] = useState('');
  const [priceMethod, setPriceMethod] = useState<'markup' | 'target'>('markup');

  const review = async (decision: string) => {
    setSaving(true);
    setMessage('');
    try {
      await onReview(result.id, decision, comments);
      setMessage(`Candidate marked ${decision.replaceAll('_', ' ')}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveCost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currency = result.currency.toUpperCase();
    const input: Record<string, unknown> = {
      supplierPrice: Number(result.supplier_price),
      currency,
      shippingKes: Number(data.get('shippingKes')),
      insuranceKes: Number(data.get('insuranceKes')),
      importCostsKes: Number(data.get('importCostsKes')),
      otherExpensesKes: Number(data.get('otherExpensesKes'))
    };
    if (currency !== 'KES') input.exchangeRateToKes = Number(data.get('exchangeRateToKes'));
    if (priceMethod === 'target') {
      input.targetSellingPriceKes = Number(data.get('targetSellingPriceKes'));
    } else {
      input.markupPercent = Number(data.get('markupPercent'));
    }
    const status = String(data.get('calculationStatus'));
    const evidenceReference = String(data.get('evidenceReference') ?? '').trim();
    const overrideReason = String(data.get('overrideReason') ?? '').trim();
    if (status === 'confirmed' && evidenceReference.length < 3) {
      setMessage('Add an invoice, supplier quote or other evidence reference to confirm these costs.');
      return;
    }
    if (priceMethod === 'target' && overrideReason.length < 3) {
      setMessage('Add a reason for using a target selling price.');
      return;
    }
    setSaving(true);
    try {
      const summary = await onSaveCost(result.request_id, result.id, {
        input,
        calculationStatus: status,
        evidenceReference: evidenceReference || undefined,
        overrideReason: overrideReason || undefined
      });
      setCostSummary(summary);
      setCostStatus(status);
      setMessage('Landed-cost calculation saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cost calculation could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <article className="sourcing-result-card">
    <div className="account-card-heading"><strong>{result.product_name}</strong><span>{result.status.replaceAll('_', ' ')}</span></div>
    <p>{result.brand}{result.model ? ` · ${result.model}` : ''} · {Number(result.supplier_price).toLocaleString()} {result.currency}</p>
    <p><a href={result.source_url} target="_blank" rel="noopener noreferrer">Open supplier listing</a> · Supplier review: {result.verification_status} · Risk: <strong>{result.risk_classification}</strong>{result.intelligence_score !== null ? ` · Match score ${result.intelligence_score}/100` : ''}</p>
    {result.availability_information && <p>Availability: {result.availability_information}</p>}
    {result.risk_reasons.length > 0 && <ul>{result.risk_reasons.map((reason, index) => <li key={`${result.id}-risk-${index}`}>{reason}</li>)}</ul>}
    {result.duplicate_of && <p className="checkout-notice">Potential duplicate of an earlier candidate; review before quotation.</p>}
    {['discovered', 'verification_pending', 'awaiting_approval', 'research_required'].includes(result.status) && <>
      <label>Review notes<textarea value={comments} onChange={event => setComments(event.target.value)} maxLength={5000} placeholder={result.risk_classification === 'high' ? 'A detailed reason is required to approve a high-risk result.' : 'Optional review notes'} /></label>
      <div className="sourcing-actions">
        <button className="button button-dark" type="button" disabled={saving || (result.risk_classification === 'high' && comments.trim().length < 20)} onClick={() => void review('approved')}>Approve for quotation review</button>
        <button className="text-button" type="button" disabled={saving} onClick={() => void review('research_required')}>Needs more research</button>
        <button className="text-button" type="button" disabled={saving} onClick={() => void review('rejected')}>Reject candidate</button>
      </div>
    </>}
    {result.status !== 'rejected' && <details className="sourcing-tool">
      <summary>Calculate landed-cost estimate</summary>
      <form className="sourcing-admin-form" onSubmit={saveCost}>
        <p>Supplier price: {Number(result.supplier_price).toLocaleString()} {result.currency}. The exchange rate and local charges must be entered explicitly.</p>
        {result.currency.toUpperCase() !== 'KES' && <label>Exchange rate to KES<input name="exchangeRateToKes" required type="number" min="0.000001" step="0.000001" /></label>}
        <div className="sourcing-admin-grid">
          <label>Shipping (KES)<input name="shippingKes" required type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Insurance (KES)<input name="insuranceKes" required type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Import costs (KES)<input name="importCostsKes" required type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Other expenses (KES)<input name="otherExpensesKes" required type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Pricing method<select value={priceMethod} onChange={event => setPriceMethod(event.target.value as typeof priceMethod)}><option value="markup">Markup percentage</option><option value="target">Target selling price override</option></select></label>
          {priceMethod === 'markup'
            ? <label>Markup (%)<input name="markupPercent" required type="number" min="0" max="10000" step="0.01" defaultValue="0" /></label>
            : <label>Target selling price (KES)<input name="targetSellingPriceKes" required type="number" min="0.01" step="0.01" /></label>}
          <label>Record as<select name="calculationStatus" defaultValue="estimated"><option value="estimated">Estimate</option><option value="confirmed">Confirmed with evidence</option></select></label>
        </div>
        {priceMethod === 'target' && <label>Override reason (required)<input name="overrideReason" required minLength={3} maxLength={1000} /></label>}
        <label>Evidence reference (required for confirmed costs)<input name="evidenceReference" maxLength={500} placeholder="Invoice or supplier quotation reference" /></label>
        <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save cost calculation'}</button>
      </form>
      {costSummary && <dl className="sourcing-cost-summary">
        <div><dt>Supplier cost (KES)</dt><dd>{costSummary.supplierCostKes.toLocaleString()}</dd></div>
        <div><dt>Total landed cost</dt><dd>{costSummary.totalCostKes.toLocaleString()}</dd></div>
        <div><dt>Indicative selling price</dt><dd>{costSummary.sellingPriceKes.toLocaleString()}</dd></div>
        <div><dt>Gross profit / margin</dt><dd>{costSummary.grossProfitKes.toLocaleString()} · {costSummary.grossMarginPercent.toFixed(2)}%</dd></div>
        <p>Calculation is saved as {costStatus}; it does not create a customer quotation.</p>
      </dl>}
    </details>}
    {message && <p className="form-message" role="status">{message}</p>}
  </article>;
}

function AdminSourcingWorkbench() {
  const [requests, setRequests] = useState<SourcingRequest[]>([]);
  const [results, setResults] = useState<SourcingResult[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [status, setStatus] = useState<WorkbenchStatus | null>(null);
  const hasLoaded = useRef(false);
  const [integrationKey, setIntegrationKey] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [integrationEnabled, setIntegrationEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error('Sourcing services are not configured.');
    const { data, error: invokeError } = await supabase.functions.invoke('sourcing-orchestrator', { body });
    if (invokeError) throw new Error(invokeError.message || 'Sourcing service could not be reached.');
    if (!data?.ok) throw new Error(data?.error ?? 'Sourcing action failed.');
    return data.result as Record<string, unknown>;
  }, []);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Sourcing services are not configured.');
      return;
    }
    if (!hasLoaded.current) setLoading(true);
    setError('');
    try {
      const [statusResult, requestResult, resultResult, taskResult] = await Promise.all([
        invoke({ action: 'status' }),
        supabase.from('sourcing_requests')
          .select('id,title,product_url,product_name,quantity,variant,notes,customer_requirements,brand_preference,model_specification,product_condition,preferred_location,priority,status,assigned_agent_id,internal_notes,created_at')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('sourcing_results')
          .select('id,request_id,product_name,brand,model,source_url,supplier_price,currency,availability_information,seller_rating,verification_status,risk_classification,risk_reasons,intelligence_score,status,supplier_id,duplicate_of,created_at')
          .order('created_at', { ascending: false }).limit(100),
        supabase.from('sourcing_tasks')
          .select('id,request_id,task_type,status,attempt_count,error_code,created_at,completed_at')
          .order('created_at', { ascending: false }).limit(50)
      ]);
      const queryError = requestResult.error ?? resultResult.error ?? taskResult.error;
      if (queryError) throw new Error(queryError.message);
      setStatus(statusResult as unknown as WorkbenchStatus);
      setRequests((requestResult.data ?? []) as SourcingRequest[]);
      setResults((resultResult.data ?? []) as SourcingResult[]);
      setSuppliers((statusResult as unknown as WorkbenchStatus).suppliers);
      setTasks((taskResult.data ?? []) as TaskRecord[]);
      const firstIntegration = (statusResult as unknown as WorkbenchStatus).integrations[0];
      if (firstIntegration) {
        setIntegrationKey(firstIntegration.integration_key);
        setSelectedSupplierId(firstIntegration.supplier_id ?? '');
        setIntegrationEnabled(firstIntegration.enabled);
      }
    } catch (loadError) {
      console.error('Sourcing workbench could not be loaded.', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Sourcing workbench could not be loaded.');
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, body: Record<string, unknown>, successMessage: string) => {
    setBusy(key);
    setError('');
    setMessage('');
    try {
      await invoke(body);
      setMessage(successMessage);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Sourcing action failed.');
    } finally {
      setBusy('');
    }
  };

  const addManualResult = async (requestId: string, result: Record<string, unknown>) => {
    await invoke({ action: 'add_manual_result', requestId, result });
    await load();
  };

  const reviewResult = async (resultId: string, decision: string, comments: string) => {
    const key = `review-${resultId}`;
    setBusy(key);
    try {
      await invoke({ action: 'review_result', resultId, decision, comments });
      setMessage('Review decision saved.');
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Review decision could not be saved.');
      throw actionError;
    } finally {
      setBusy('');
    }
  };

  const saveCost = async (requestId: string, resultId: string, values: Record<string, unknown>) => {
    const key = `cost-${resultId}`;
    setBusy(key);
    try {
      const response = await invoke({ action: 'save_cost', requestId, resultId, ...values });
      const summary = response.output as LandedCostSummary;
      setMessage('Cost calculation saved.');
      await load();
      return summary;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Cost calculation could not be saved.');
      throw actionError;
    } finally {
      setBusy('');
    }
  };

  const saveIntegration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await act('integration', {
      action: 'save_integration',
      integrationKey: integrationKey.trim(),
      supplierId: selectedSupplierId || null,
      enabled: integrationEnabled
    }, 'Supplier integration settings saved.');
  };

  if (loading) return <section className="admin-sourcing-workbench"><p role="status">Loading sourcing workbench…</p></section>;

  return <section className="admin-sourcing-workbench" aria-labelledby="sourcing-workbench-title">
    <div className="section-heading">
      <div><p className="eyebrow">Admin · sourcing intelligence</p><h3 id="sourcing-workbench-title">Sourcing workbench</h3></div>
      <button className="text-button" type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>Refresh</button>
    </div>
    {error && <div className="form-message" role="alert">{error}</div>}
    {message && <p className="form-message success" role="status">{message}</p>}
    {status && <>
      <div className="sourcing-metrics">
        <article><span>Queued</span><strong>{status.volume.queued}</strong></article>
        <article><span>Running</span><strong>{status.volume.running}</strong></article>
        <article><span>Awaiting review</span><strong>{status.volume.awaitingReview}</strong></article>
        <article><span>Failed tasks</span><strong>{status.volume.failed}</strong></article>
        <article><span>Recorded candidates</span><strong>{status.volume.totalResults}</strong></article>
      </div>
      <div className="sourcing-provider-grid">
        <p>Supplier catalogue: <strong>{status.providers.supplierCatalog ? 'Credentials configured' : 'Not configured'}</strong></p>
        <p>AI comparison: <strong>{status.providers.ai ? 'Credentials configured' : 'Not configured'}</strong></p>
        <p>Worker secret: <strong>{status.providers.workerSecret ? 'Configured' : 'Not configured'}</strong></p>
        <p>Scheduler: <strong>{status.providers.scheduler ? 'Configured' : 'Not configured'}</strong></p>
      </div>
      <div className="sourcing-actions">
        <button className="button button-dark" type="button" disabled={Boolean(busy)} onClick={() => void act('run-queue', { action: 'run_queue', limit: 2 }, 'Queue processing finished. Check task history for per-task outcomes.')}>{busy === 'run-queue' ? 'Processing…' : 'Process up to 2 queued tasks'}</button>
        <label className="sourcing-toggle"><input type="checkbox" checked={status.aiEnabled} disabled={!status.providers.ai || Boolean(busy)} onChange={event => void act('ai-setting', { action: 'set_ai_enabled', enabled: event.target.checked }, 'AI comparison setting updated.')} /> Optional AI comparison</label>
      </div>
      <details className="sourcing-tool">
        <summary>Supplier catalogue integration</summary>
        <form className="sourcing-admin-form" onSubmit={saveIntegration}>
          <label>Integration key<input required maxLength={100} value={integrationKey} onChange={event => setIntegrationKey(event.target.value)} placeholder="supplier-catalog-main" /></label>
          <label>Supplier record<select value={selectedSupplierId} onChange={event => setSelectedSupplierId(event.target.value)}><option value="">No linked supplier</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label className="sourcing-toggle"><input type="checkbox" checked={integrationEnabled} onChange={event => setIntegrationEnabled(event.target.checked)} /> Enable catalogue adapter</label>
          {!status.providers.supplierCatalog && <p className="checkout-notice">Server credentials are missing. Saving cannot enable or test real supplier delivery.</p>}
          <button className="button button-dark" type="submit" disabled={Boolean(busy) || !integrationKey.trim()}>{busy === 'integration' ? 'Saving…' : 'Save integration'}</button>
        </form>
        {status.integrations.map(integration => <div className="sourcing-integration-status" key={integration.id}>
          <span>{integration.integration_key} · {integration.last_test_status}{integration.last_error_code ? ` · ${integration.last_error_code}` : ''}</span>
          <small>Last tested: {formatDate(integration.last_tested_at)}</small>
          <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => void act(`test-${integration.id}`, { action: 'test_integration', integrationId: integration.id }, 'Integration test finished; inspect its provider status below.')}>{busy === `test-${integration.id}` ? 'Testing…' : 'Test catalogue connection'}</button>
        </div>)}
      </details>
      <details className="sourcing-tool">
        <summary>Daily queue schedule</summary>
        {status.scheduledJobs.filter(job => job.job_key === 'daily-sourcing-review').map(job => <div className="sourcing-schedule" key={job.job_key}>
          <label className="sourcing-toggle"><input type="checkbox" checked={job.enabled} disabled={!status.providers.workerSecret || !status.providers.scheduler || Boolean(busy)} onChange={event => void act('schedule', { action: 'set_schedule', jobKey: job.job_key, enabled: event.target.checked, frequencyMinutes: Math.max(1440, job.frequency_minutes) }, 'Daily sourcing schedule updated.')} /> Enable daily queue processing</label>
          <p>Status: {job.last_status} · Every {Math.round(job.frequency_minutes / 60)} hours · Next run: {formatDate(job.next_run_at)}</p>
          {(!status.providers.workerSecret || !status.providers.scheduler) && <p className="checkout-notice">Configure the worker secret and verify the Supabase scheduled invocation before enabling this job.</p>}
        </div>)}
      </details>
    </>}

    <section className="sourcing-workbench-section">
      <h4>Customer requests</h4>
      {requests.length === 0 ? <p className="account-empty">No sourcing requests have been submitted.</p> : requests.map(request => <article className="sourcing-request-card" key={request.id}>
        <div className="account-card-heading"><strong>{request.product_name || request.title}</strong><span>{request.status.replaceAll('_', ' ')} · {request.priority} · {new Date(request.created_at).toLocaleDateString()}</span></div>
        <p><a href={request.product_url} target="_blank" rel="noopener noreferrer">Open customer reference</a> · Quantity {request.quantity}{request.variant ? ` · ${request.variant}` : ''}</p>
        <p>{[request.brand_preference, request.model_specification, request.product_condition, request.preferred_location].filter(Boolean).join(' · ') || 'No additional structured product details.'}</p>
        {(request.customer_requirements || request.notes) && <p>{request.customer_requirements || request.notes}</p>}
        {['submitted', 'reviewing'].includes(request.status) && <button className="text-button" type="button" disabled={Boolean(busy) || tasks.some(task => task.request_id === request.id && ['queued', 'running', 'retrying'].includes(task.status))} onClick={() => void act(`queue-${request.id}`, {
          action: 'queue_request',
          requestId: request.id,
          idempotencyKey: `manual:${request.id}:${crypto.randomUUID()}`
        }, 'Sourcing discovery task queued.')}>{busy === `queue-${request.id}` ? 'Queueing…' : 'Queue another discovery run'}</button>}
        <form className="sourcing-admin-form" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void act(`manage-${request.id}`, {
            action: 'manage_request',
            requestId: request.id,
            priority: String(form.get('priority')),
            assignedAgentId: String(form.get('assignedAgentId') ?? '') || null,
            internalNotes: String(form.get('internalNotes') ?? '')
          }, 'Request assignment and priority saved.');
        }}>
          <div className="sourcing-admin-grid">
            <label>Priority<select name="priority" defaultValue={request.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            <label>Assigned sourcing agent<select name="assignedAgentId" defaultValue={request.assigned_agent_id ?? ''}><option value="">Unassigned</option>{(status?.agents ?? []).map(agent => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></label>
            <label>Internal notes<textarea name="internalNotes" maxLength={10_000} defaultValue={request.internal_notes ?? ''} /></label>
          </div>
          <button className="text-button" type="submit" disabled={Boolean(busy)}>{busy === `manage-${request.id}` ? 'Saving…' : 'Save request management'}</button>
        </form>
        {['submitted', 'reviewing'].includes(request.status) && <ManualResultForm request={request} suppliers={suppliers} onSave={addManualResult} />}
      </article>)}
    </section>

    <section className="sourcing-workbench-section">
      <h4>Product candidates · human review required</h4>
      {results.length === 0 ? <p className="account-empty">No product candidates have been recorded yet.</p> : results.map(result => <SourcingResultCard key={result.id} result={result} onReview={reviewResult} onSaveCost={saveCost} />)}
    </section>

    <section className="sourcing-workbench-section">
      <h4>Recent task history</h4>
      {tasks.length === 0 ? <p className="account-empty">No sourcing tasks have run.</p> : <div className="sourcing-task-list">{tasks.map(task => <article key={task.id}>
        <strong>{task.task_type.replaceAll('_', ' ')}</strong><span>{task.status.replaceAll('_', ' ')}</span>
        <small>{formatDate(task.created_at)} · attempt {task.attempt_count}{task.error_code ? ` · ${task.error_code}` : ''}</small>
      </article>)}</div>}
    </section>
  </section>;
}

export default AdminSourcingWorkbench;
