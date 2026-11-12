import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { sourcingQuoteSchema } from '../lib/domain';
import { supabase } from '../lib/supabase';

interface SourcingQueueItem {
  id: string;
  product_url: string;
  product_name: string | null;
  quantity: number;
  variant: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  media?: { storage_path: string }[];
  mediaUrls?: string[];
}

interface QuoteFormProps {
  request: SourcingQueueItem;
  onQuoted: () => Promise<void>;
}

function QuoteForm({ request, onQuoted }: QuoteFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const parsed = sourcingQuoteSchema.safeParse({
      description: formData.get('description'),
      unitAmount: Number(formData.get('unitAmount')),
      shipping: Number(formData.get('shipping')),
      duties: Number(formData.get('duties')),
      taxes: Number(formData.get('taxes')),
      serviceFee: Number(formData.get('serviceFee')),
      markup: Number(formData.get('markup')),
      discount: Number(formData.get('discount')),
      expiryDate: formData.get('expiryDate') || undefined,
      deliveryWindow: formData.get('deliveryWindow') || undefined
    });
    if (!parsed.success) {
      setMessage('Check the item description and all quotation amounts.');
      return;
    }
    if (!supabase) {
      setMessage('Admin services are not configured.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc('admin_create_sourcing_quotation', {
      p_request_id: request.id,
      p_description: parsed.data.description,
      p_unit_amount: parsed.data.unitAmount,
      p_shipping: parsed.data.shipping,
      p_duties: parsed.data.duties,
      p_taxes: parsed.data.taxes,
      p_service_fee: parsed.data.serviceFee,
      p_markup: parsed.data.markup,
      p_discount: parsed.data.discount,
      p_expiry_date: parsed.data.expiryDate ?? null,
      p_delivery_window: parsed.data.deliveryWindow ?? null
    });
    setSubmitting(false);
    if (error) {
      console.error('Sourcing quotation could not be created.', error.message);
      setMessage('The quotation could not be sent. Check the request status and try again.');
      return;
    }
    setSuccess(true);
    setMessage('Quotation sent to the customer.');
    await onQuoted();
  };

  return <form className="admin-quote-form" onSubmit={submit}>
    <h4>Prepare KES quotation · {request.quantity} item(s)</h4>
    <label>Item description<input name="description" required minLength={2} maxLength={300} defaultValue="Sourced product" /></label>
    <label>Unit price<input name="unitAmount" required type="number" min="0.01" max="100000000" step="0.01" /></label>
    <div className="quote-cost-grid">
      <label>Shipping<input name="shipping" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
      <label>Duties<input name="duties" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
      <label>Taxes<input name="taxes" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
      <label>Service fee<input name="serviceFee" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
      <label>Markup<input name="markup" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
      <label>Discount<input name="discount" type="number" min="0" max="100000000" step="0.01" defaultValue="0" /></label>
    </div>
    <label>Delivery estimate<input name="deliveryWindow" maxLength={100} placeholder="e.g. 2–3 weeks" /></label>
    <label>Quotation expiry<input name="expiryDate" type="date" min={new Date().toISOString().slice(0, 10)} /></label>
    {message && <p className={success ? 'form-message success' : 'form-message'} role="status">{message}</p>}
    <button className="button button-dark" type="submit" disabled={submitting || success}>{submitting ? 'Sending…' : success ? 'Quotation sent' : 'Send quotation'}</button>
  </form>;
}

function AdminSourcingQueue() {
  const [requests, setRequests] = useState<SourcingQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRequests = useCallback(async () => {
    if (!supabase) {
      setError('Admin services are not configured.');
      setLoading(false);
      return;
    }
    const client = supabase;
    setLoading(true);
    setError('');
    const { data, error: queryError } = await client
      .from('sourcing_requests')
      .select('id,product_url,product_name,quantity,variant,notes,status,created_at,media:sourcing_request_media(storage_path)')
      .in('status', ['submitted', 'reviewing'])
      .order('created_at', { ascending: true });
    if (queryError) {
      console.error('Sourcing queue could not be loaded.', queryError.message);
      setError('We could not load sourcing requests. Please try again.');
    } else {
      const requestsWithMedia = await Promise.all(((data ?? []) as SourcingQueueItem[]).map(async request => {
        const mediaUrls = await Promise.all((request.media ?? []).map(async media => {
          const { data: signed, error: signedError } = await client.storage.from('sourcing-request-media').createSignedUrl(media.storage_path, 3600);
          if (signedError) {
            console.error('A sourcing reference image could not be opened.', signedError.message);
            return '';
          }
          return signed.signedUrl;
        }));
        return { ...request, mediaUrls: mediaUrls.filter(Boolean) };
      }));
      setRequests(requestsWithMedia);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  return <section className="admin-queue"><div className="section-heading"><div><p className="eyebrow">Admin · sourcing desk</p><h3>Open requests</h3></div><button className="text-button" onClick={() => void loadRequests()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {loading ? <p role="status">Loading sourcing requests…</p> : error ? <div role="alert"><p>{error}</p><button className="button button-dark" onClick={() => void loadRequests()}>Try again</button></div> : requests.length === 0 ? <p className="account-empty">No requests are waiting for review.</p> : requests.map(request => <article className="admin-request" key={request.id}><div className="account-card-heading"><strong>{request.product_name || new Date(request.created_at).toLocaleString()}</strong><span>{request.status}</span></div><p><strong>Product:</strong> <a href={request.product_url} target="_blank" rel="noopener noreferrer">{request.product_url}</a></p><p><strong>Quantity:</strong> {request.quantity}{request.variant && ` · ${request.variant}`}</p>{request.notes && <p><strong>Customer notes:</strong> {request.notes}</p>}{request.mediaUrls?.map((url, index) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Open reference image {index + 1}</a></p>)}<QuoteForm request={request} onQuoted={loadRequests} /></article>)}
  </section>;
}

export default AdminSourcingQueue;
