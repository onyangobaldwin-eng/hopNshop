import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { OrderStatus } from '../lib/domain';

interface OrderQueueItem {
  id: string;
  order_number: string;
  business_model: string;
  status: OrderStatus;
  currency: string;
  total: number | string;
  created_at: string;
}

const transitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  payment_confirmed: ['procurement_approved', 'refund_pending'],
  procurement_approved: ['ordered_from_supplier'],
  ordered_from_supplier: ['supplier_processing'],
  supplier_processing: ['dispatched'],
  dispatched: ['international_transit', 'local_courier'],
  international_transit: ['customs_processing'],
  customs_processing: ['local_courier'],
  local_courier: ['ready_for_collection', 'delivered'],
  ready_for_collection: ['delivered'],
  delivered: [],
  exception: []
};

interface OrderUpdateFormProps {
  order: OrderQueueItem;
  onUpdated: () => Promise<void>;
}

function OrderUpdateForm({ order, onUpdated }: OrderUpdateFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const allowedStatuses = order.status === 'payment_verification' ? [] : [...(transitions[order.status] ?? [])];
  if (!['payment_verification', 'delivered', 'cancelled', 'refunded', 'exception'].includes(order.status)) {
    allowedStatuses.push('cancelled', 'exception');
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const status = String(form.get('status')) as OrderStatus;
    const customerMessage = String(form.get('customerMessage') ?? '').trim();
    const courier = String(form.get('courier') ?? '').trim();
    const tracking = String(form.get('tracking') ?? '').trim();
    if (!allowedStatuses.includes(status) || customerMessage.length < 2 || customerMessage.length > 1000) {
      setMessage('Choose an allowed next status and enter a customer update.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    const { error } = await supabase.rpc('admin_update_order_status', {
      p_order_id: order.id,
      p_new_status: status,
      p_customer_message: customerMessage,
      p_courier_name: courier || null,
      p_tracking_reference: tracking || null
    });
    setSubmitting(false);
    if (error) {
      console.error('Order status could not be updated.', error.message);
      setMessage('We could not update this order. It may have changed; refresh and try again.');
      return;
    }
    await onUpdated();
  };

  if (allowedStatuses.length === 0) return <small>{order.status === 'payment_verification' ? 'Review or reject the pending payment submission before changing this order.' : 'No further fulfilment action is available here.'}</small>;

  return <form className="admin-order-form" onSubmit={submit}>
    <label>Next status<select name="status" defaultValue={allowedStatuses[0]}>{allowedStatuses.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
    <label>Customer update<textarea name="customerMessage" required minLength={2} maxLength={1000} placeholder="Share a factual order update" /></label>
    <div className="quote-cost-grid"><label>Courier<input name="courier" maxLength={120} /></label><label>Tracking reference<input name="tracking" maxLength={200} /></label></div>
    {message && <p className="form-message" role="alert">{message}</p>}
    <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save order update'}</button>
  </form>;
}

function AdminOrderQueue() {
  const [orders, setOrders] = useState<OrderQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    if (!supabase) {
      setError('Order services are not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('orders')
      .select('id,order_number,business_model,status,currency,total,created_at')
      .order('created_at', { ascending: false });
    if (queryError) {
      console.error('Order queue could not be loaded.', queryError.message);
      setError('We could not load orders. Please try again.');
    } else {
      setOrders(((data ?? []) as OrderQueueItem[]).filter(order => order.business_model !== 'affiliate'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  return <section className="admin-queue admin-order-queue">
    <div className="section-heading"><div><p className="eyebrow">Admin · fulfilment</p><h3>Orders</h3></div><button className="text-button" onClick={() => void loadOrders()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {loading ? <p role="status">Loading orders…</p> : error ? <div role="alert"><p>{error}</p><button className="button button-dark" onClick={() => void loadOrders()}>Try again</button></div> : orders.length === 0 ? <p className="account-empty">No hopNshop orders are available.</p> : orders.map(order => <article className="admin-request" key={order.id}>
      <div className="account-card-heading"><strong>{order.order_number}</strong><span>{order.status.replaceAll('_', ' ')}</span></div>
      <p>{order.business_model === 'sourcing' ? 'Personal sourcing' : 'hopNshop sale'} · {order.currency.toUpperCase()} {Number(order.total).toLocaleString()} · {new Date(order.created_at).toLocaleString()}</p>
      <OrderUpdateForm order={order} onUpdated={loadOrders} />
    </article>)}
  </section>;
}

export default AdminOrderQueue;
