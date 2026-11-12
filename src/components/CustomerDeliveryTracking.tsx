import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface DeliveryParcel {
  id: string;
  status: string;
  courier_name: string;
  service_type: string;
  tracking_reference: string | null;
  estimated_delivery_start: string | null;
  estimated_delivery_end: string | null;
  created_at: string;
}

interface DeliveryEvent {
  id: string;
  parcel_id: string;
  status: string;
  notes: string | null;
  happened_at: string;
}

interface DeliveryReturn {
  id: string;
  parcel_id: string;
  status: string;
  reason: string;
  notes: string;
  created_at: string;
}

interface DeliveryFeeAdjustment {
  id: string;
  previous_fee: number | string;
  requested_fee: number | string;
  reason: string;
  status: string;
  created_at: string;
}

interface CustomerDeliveryTrackingProps {
  orderId: string;
  currency: string;
  orderStatus: string;
  onChanged: () => Promise<void>;
}

function CustomerDeliveryTracking({ orderId, currency, orderStatus, onChanged }: CustomerDeliveryTrackingProps) {
  const [parcels, setParcels] = useState<DeliveryParcel[]>([]);
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [returns, setReturns] = useState<DeliveryReturn[]>([]);
  const [adjustments, setAdjustments] = useState<DeliveryFeeAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState('');

  const loadTracking = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Delivery tracking is not configured.');
      return;
    }
    setLoading(true);
    setError('');
    const [parcelResult, adjustmentResult] = await Promise.all([
      supabase.from('delivery_parcels')
        .select('id,status,courier_name,service_type,tracking_reference,estimated_delivery_start,estimated_delivery_end,created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true }),
      supabase.from('delivery_fee_adjustments')
        .select('id,previous_fee,requested_fee,reason,status,created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
    ]);
    if (parcelResult.error || adjustmentResult.error) {
      const requestError = parcelResult.error ?? adjustmentResult.error;
      console.error('Delivery tracking could not be loaded.', requestError?.message);
      setError('We could not load parcel updates right now.');
      setLoading(false);
      return;
    }
    const nextParcels = (parcelResult.data ?? []) as DeliveryParcel[];
    const parcelIds = nextParcels.map(parcel => parcel.id);
    const [eventResult, returnResult] = parcelIds.length > 0
      ? await Promise.all([
        supabase.from('delivery_tracking_events')
          .select('id,parcel_id,status,notes,happened_at')
          .in('parcel_id', parcelIds)
          .order('happened_at', { ascending: true }),
        supabase.from('delivery_returns')
          .select('id,parcel_id,status,reason,notes,created_at')
          .in('parcel_id', parcelIds)
          .order('created_at', { ascending: false })
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (eventResult.error || returnResult.error) {
      const requestError = eventResult.error ?? returnResult.error;
      console.error('Parcel event history could not be loaded.', requestError?.message);
      setError('Parcel details loaded, but some tracking updates are unavailable.');
    }
    setParcels(nextParcels);
    setEvents((eventResult.data ?? []) as DeliveryEvent[]);
    setReturns((returnResult.data ?? []) as DeliveryReturn[]);
    setAdjustments((adjustmentResult.data ?? []) as DeliveryFeeAdjustment[]);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    void loadTracking();
  }, [loadTracking]);

  const respondToFeeChange = async (adjustmentId: string, approved: boolean) => {
    if (!supabase) return;
    setSubmitting(adjustmentId);
    setMessage('');
    const { error: responseError } = await supabase.rpc('customer_respond_delivery_fee_change', {
      p_adjustment_id: adjustmentId,
      p_approved: approved
    });
    setSubmitting('');
    if (responseError) {
      console.error('Delivery fee decision could not be saved.', responseError.message);
      setMessage('We could not save your decision. The request may have changed; refresh and try again.');
      return;
    }
    setMessage(approved ? 'Delivery charge approved. The updated order total is ready for payment.' : 'Delivery charge declined. The unpaid order has been cancelled.');
    await loadTracking();
    await onChanged();
  };

  const requestReturn = async (event: FormEvent<HTMLFormElement>, parcelId: string) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const reason = String(form.get('reason') ?? '');
    const notes = String(form.get('notes') ?? '').trim();
    setSubmitting(parcelId);
    setMessage('');
    const { error: requestError } = await supabase.rpc('customer_request_delivery_return', {
      p_parcel_id: parcelId,
      p_reason: reason,
      p_notes: notes
    });
    setSubmitting('');
    if (requestError) {
      console.error('Delivery return could not be requested.', requestError.message);
      setMessage('We could not send your request. Check the parcel status or contact customer support.');
      return;
    }
    setMessage('Your delivery support request has been received.');
    formElement.reset();
    await loadTracking();
  };

  if (loading) return <p className="checkout-address-status" role="status">Loading parcel tracking…</p>;
  if (error && parcels.length === 0 && adjustments.length === 0) {
    return <div className="checkout-address-status" role="alert"><p>{error}</p><button className="text-button" onClick={() => void loadTracking()}>Try again</button></div>;
  }
  if (parcels.length === 0 && adjustments.length === 0) return null;

  return <section className="account-section delivery-tracking">
    <div className="section-heading">
      <div><p className="eyebrow">Delivery</p><h4>Parcel tracking</h4></div>
      <button className="text-button" onClick={() => void loadTracking()} disabled={loading}>Refresh</button>
    </div>
    {error && <p className="checkout-address-status" role="status">{error}</p>}
    {message && <p className="form-message success" role="status">{message}</p>}
    {adjustments.map(adjustment => <article className="account-card" key={adjustment.id}>
      <div className="account-card-heading">
        <strong>Delivery charge update</strong>
        <span>{adjustment.status.replaceAll('_', ' ')}</span>
      </div>
      <p>{currency.toUpperCase()} {Number(adjustment.previous_fee).toLocaleString()} → {currency.toUpperCase()} {Number(adjustment.requested_fee).toLocaleString()}</p>
      <p>{adjustment.reason}</p>
      {adjustment.status === 'pending_customer_approval' && orderStatus === 'awaiting_payment' && <div className="account-actions">
        <button className="button button-dark" disabled={submitting === adjustment.id} onClick={() => void respondToFeeChange(adjustment.id, true)}>Approve charge</button>
        <button className="text-button" disabled={submitting === adjustment.id} onClick={() => void respondToFeeChange(adjustment.id, false)}>Decline and cancel unpaid order</button>
      </div>}
      {adjustment.status === 'pending_customer_approval' && orderStatus !== 'awaiting_payment' && <p className="checkout-address-status">Payment activity has started on this order. Contact support before paying; do not make a payment against an outdated total.</p>}
    </article>)}
    {parcels.length === 0 && <p className="account-empty">No courier parcel has been registered yet.</p>}
    {parcels.map((parcel, index) => {
      const parcelEvents = events.filter(item => item.parcel_id === parcel.id);
      const parcelReturns = returns.filter(item => item.parcel_id === parcel.id);
      const canRequestReturn = ['delivered', 'delivery_failed', 'returned_to_sender'].includes(parcel.status)
        && !parcelReturns.some(item => !['rejected', 'refunded'].includes(item.status));
      return <article className="account-card" key={parcel.id}>
        <div className="account-card-heading">
          <strong>Parcel {index + 1}</strong>
          <span>{parcel.status.replaceAll('_', ' ')}</span>
        </div>
        <p>{parcel.courier_name} · {parcel.service_type === 'pickup_point' ? 'Pickup point' : 'Doorstep delivery'}</p>
        {parcel.tracking_reference && <p>Tracking reference: <strong>{parcel.tracking_reference}</strong></p>}
        {(parcel.estimated_delivery_start || parcel.estimated_delivery_end) && <p>Estimated delivery: {[parcel.estimated_delivery_start, parcel.estimated_delivery_end].filter(Boolean).join(' – ')}</p>}
        {parcelEvents.length === 0 ? <p className="account-empty">The delivery team has not posted a tracking event yet.</p> : <ol className="delivery-event-list">
          {parcelEvents.map(item => <li key={item.id}>
            <strong>{item.status.replaceAll('_', ' ')} · {new Date(item.happened_at).toLocaleString()}</strong>
            {item.notes && <p>{item.notes}</p>}
          </li>)}
        </ol>}
        {parcelReturns.map(item => <p className="checkout-address-status" key={item.id}>Support request · {item.status.replaceAll('_', ' ')} · {item.notes}</p>)}
        {canRequestReturn && <form className="manual-payment-form" onSubmit={event => void requestReturn(event, parcel.id)}>
          <h5>Report a parcel issue</h5>
          <label>Reason<select name="reason" required defaultValue="damaged">
            <option value="damaged">Damaged</option>
            <option value="missing_items">Missing items</option>
            <option value="failed_delivery">Failed delivery</option>
            <option value="customer_request">Other return request</option>
            <option value="other">Other</option>
          </select></label>
          <label>Details<textarea name="notes" required minLength={2} maxLength={2000} /></label>
          <button className="button button-dark" type="submit" disabled={submitting === parcel.id}>{submitting === parcel.id ? 'Sending…' : 'Contact delivery support'}</button>
        </form>}
      </article>;
    })}
  </section>;
}

export default CustomerDeliveryTracking;
