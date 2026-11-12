import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { manualPaymentSchema, manualRefundRequestSchema } from '../lib/domain';
import AdminSourcingQueue from './AdminSourcingQueue';
import AdminSourcingWorkbench from './AdminSourcingWorkbench';
import AdminPaymentQueue from './AdminPaymentQueue';
import AdminOrderQueue from './AdminOrderQueue';
import AdminProductCatalog from './AdminProductCatalog';
import AdminCollectionManager from './AdminCollectionManager';
import AdminCampaignManager from './AdminCampaignManager';
import AdminCommercialSetup from './AdminCommercialSetup';
import CustomerHelpdesk from './CustomerHelpdesk';
import AdminAffiliateLinks from './AdminAffiliateLinks';
import AdminFinanceReports from './AdminFinanceReports';
import AdminOperationalOverview from './AdminOperationalOverview';
import AdminRefundQueue from './AdminRefundQueue';
import CustomerProfile from './CustomerProfile';
import CustomerNotificationCentre from './CustomerNotificationCentre';
import AdminNotificationCentre from './AdminNotificationCentre';
import CustomerDeliveryTracking from './CustomerDeliveryTracking';
import AdminDeliveryManagement from './AdminDeliveryManagement';

interface SourcingRequest {
  id: string;
  product_url: string;
  product_name: string | null;
  status: string;
  created_at: string;
}

interface Quotation {
  id: string;
  quotation_number: string;
  currency: string;
  total: number | string;
  status: string;
  expiry_date: string | null;
  delivery_window: string | null;
  items: { description: string; quantity: number; unit_amount: number | string }[];
}

interface CustomerOrder {
  id: string;
  order_number: string;
  business_model: string;
  status: string;
  currency: string;
  total: number | string;
  created_at: string;
  order_items: { description: string; quantity: number; unit_amount: number | string }[];
}

interface PaymentRecord {
  id: string;
  order_id: string | null;
  provider: string;
  transaction_reference: string | null;
  payer_name: string | null;
  amount: number | string;
  currency: string;
  status: string;
  created_at: string;
  refunds?: RefundRecord[];
}

interface RefundRecord {
  id: string;
  amount: number | string;
  reason: string;
  status: string;
  provider_reference: string | null;
  created_at: string;
}

interface FulfilmentEvent {
  id: string;
  order_id: string;
  status: string;
  message: string;
  courier_name: string | null;
  tracking_reference: string | null;
  created_at: string;
}

interface WishlistProduct {
  id: string;
  name: string;
  description: string;
  business_model: string;
  currency: string;
  local_selling_price: number | string | null;
}

interface CustomerAccountProps {
  userId: string;
  email: string;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}

function formatMoney(currency: string, value: number | string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${currency.toUpperCase()} ${amount.toLocaleString()}` : `${currency.toUpperCase()} —`;
}

interface ManualPaymentFormProps {
  order: CustomerOrder;
  onSubmitted: () => Promise<void>;
}

function ManualPaymentForm({ order, onSubmitted }: ManualPaymentFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = manualPaymentSchema.safeParse({
      transactionReference: data.get('transactionReference'),
      payerName: data.get('payerName'),
      amount: Number(data.get('amount'))
    });
    if (!parsed.success) {
      setMessage('Enter the M-Pesa transaction code, payer name and exact order total.');
      return;
    }
    if (!supabase) {
      setMessage('Payment services are not configured.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    const { error } = await supabase.rpc('submit_manual_payment', {
      p_order_id: order.id,
      p_transaction_reference: parsed.data.transactionReference,
      p_payer_name: parsed.data.payerName,
      p_amount: parsed.data.amount
    });
    setSubmitting(false);
    if (error) {
      console.error('Manual payment details could not be submitted.', error.message);
      setMessage('We could not submit these details. Check the reference and amount, then try again.');
      return;
    }
    setMessage('Payment details submitted. Your order remains unpaid until our team verifies the transaction.');
    await onSubmitted();
  };

  return <form className="manual-payment-form" onSubmit={submit}>
    <h4>Submit M-Pesa payment details</h4>
    <p className="checkout-notice">Only pay using verified hopNshop instructions. Submitting a transaction code is not proof of payment.</p>
    <label>M-Pesa transaction code<input name="transactionReference" required minLength={6} maxLength={20} autoComplete="off" /></label>
    <label>Payer name<input name="payerName" required minLength={2} maxLength={120} autoComplete="name" /></label>
    <label>Amount paid ({order.currency.toUpperCase()})<input name="amount" required type="number" min="0.01" max="100000000" step="0.01" defaultValue={Number(order.total)} /></label>
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit for verification'}</button>
  </form>;
}

interface ManualRefundFormProps {
  payment: PaymentRecord;
  availableAmount: number;
  onSubmitted: () => Promise<void>;
}

function ManualRefundForm({ payment, availableAmount, onSubmitted }: ManualRefundFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = manualRefundRequestSchema.safeParse({
      amount: Number(form.get('amount')),
      reason: form.get('reason')
    });
    if (!parsed.success || parsed.data.amount > availableAmount) {
      setMessage(`Enter a valid reason and an amount no greater than ${formatMoney(payment.currency, availableAmount)}.`);
      return;
    }
    if (!supabase) {
      setMessage('Refund services are not configured.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    const { error } = await supabase.rpc('request_manual_refund', {
      p_payment_id: payment.id,
      p_amount: parsed.data.amount,
      p_reason: parsed.data.reason
    });
    setSubmitting(false);
    if (error) {
      console.error('Refund request could not be submitted.', error.message);
      setMessage('We could not submit your refund request. Check the amount and contact support if needed.');
      return;
    }
    setMessage('Your refund request was submitted for review. No refund has been issued yet.');
    await onSubmitted();
  };

  return <form className="manual-payment-form" onSubmit={submit}>
    <h4>Request a refund</h4>
    <p className="checkout-notice">Requests are reviewed by hopNshop. An approved request is not complete until the actual refund transfer is made.</p>
    <label>Amount ({payment.currency.toUpperCase()})<input name="amount" required type="number" min="0.01" max={availableAmount} step="0.01" defaultValue={availableAmount} /></label>
    <label>Reason<textarea name="reason" required minLength={10} maxLength={1000} /></label>
    {message && <p className="form-message" role="status">{message}</p>}
    <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit refund request'}</button>
  </form>;
}

function CustomerAccount({ userId, email, onClose, onSignOut }: CustomerAccountProps) {
  const [requests, setRequests] = useState<SourcingRequest[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [pendingDeliveryFeeOrderIds, setPendingDeliveryFeeOrderIds] = useState<string[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [fulfilmentEvents, setFulfilmentEvents] = useState<FulfilmentEvent[]>([]);
  const [wishlistId, setWishlistId] = useState('');
  const [wishlistProducts, setWishlistProducts] = useState<WishlistProduct[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acceptingId, setAcceptingId] = useState('');
  const [message, setMessage] = useState('');
  const [notifCentreOpen, setNotifCentreOpen] = useState(false);

  const loadAccount = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Account services are not configured.');
      return;
    }

    setLoading(true);
    setError('');
    const [requestResult, quoteResult, orderResult, roleResult, paymentResult, wishlistResult] = await Promise.all([
      supabase.from('sourcing_requests').select('id,product_url,product_name,status,created_at').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('quotations').select('id,quotation_number,currency,total,status,expiry_date,delivery_window,items:quotation_items(description,quantity,unit_amount)').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('orders').select('id,order_number,business_model,status,currency,total,created_at,order_items(description,quantity,unit_amount)').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.rpc('current_app_roles'),
      supabase.from('payments').select('id,order_id,provider,transaction_reference,payer_name,amount,currency,status,created_at').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('wishlists').select('id,wishlist_items(product_id)').eq('user_id', userId).maybeSingle()
    ]);

    const firstError = requestResult.error ?? quoteResult.error ?? orderResult.error ?? paymentResult.error ?? wishlistResult.error;
    if (firstError) {
      console.error('Customer account data could not be loaded.', firstError.message);
      setError('We could not load your account right now. Please try again.');
      setLoading(false);
      return;
    }

    const accountOrders = (orderResult.data ?? []) as CustomerOrder[];
    const deliveryFeeResult = accountOrders.length > 0
      ? await supabase.from('delivery_fee_adjustments')
        .select('order_id')
        .in('order_id', accountOrders.map(order => order.id))
        .eq('status', 'pending_customer_approval')
      : { data: [], error: null };
    if (deliveryFeeResult.error) console.error('Pending delivery fee approvals could not be loaded.', deliveryFeeResult.error.message);
    const paymentRows = (paymentResult.data ?? []) as PaymentRecord[];
    const refundsResult = paymentRows.length > 0
      ? await supabase.from('refunds').select('id,payment_id,amount,reason,status,provider_reference,created_at').in('payment_id', paymentRows.map(payment => payment.id)).order('created_at', { ascending: false })
      : { data: [], error: null };
    if (refundsResult.error) console.error('Refund requests could not be loaded.', refundsResult.error.message);
    const refundsByPayment = new Map<string, RefundRecord[]>();
    for (const refund of refundsResult.data ?? []) {
      const current = refundsByPayment.get(refund.payment_id) ?? [];
      current.push(refund as RefundRecord);
      refundsByPayment.set(refund.payment_id, current);
    }
    const paymentsWithRefunds = paymentRows.map(payment => ({ ...payment, refunds: refundsByPayment.get(payment.id) ?? [] }));
    const eventResult = accountOrders.length > 0
      ? await supabase.from('fulfilment_events')
        .select('id,order_id,status,message,courier_name,tracking_reference,created_at')
        .in('order_id', accountOrders.map(order => order.id))
        .order('created_at', { ascending: true })
      : { data: [], error: null };
    const wishlistData = wishlistResult.data as { id: string; wishlist_items: { product_id: string }[] } | null;
    const wishlistProductIds = (wishlistData?.wishlist_items ?? []).map(item => item.product_id);
    const wishlistProductResult = wishlistProductIds.length > 0
      ? await supabase.from('products').select('id,name,description,business_model,currency,local_selling_price').in('id', wishlistProductIds)
      : { data: [], error: null };

    setRequests((requestResult.data ?? []) as SourcingRequest[]);
    setQuotations((quoteResult.data ?? []) as Quotation[]);
    setOrders(accountOrders);
    setPendingDeliveryFeeOrderIds([...new Set((deliveryFeeResult.data ?? []).map((adjustment: { order_id: string }) => adjustment.order_id))]);
    setPayments(paymentsWithRefunds);
    setWishlistId(wishlistData?.id ?? '');
    if (wishlistProductResult.error) console.error('Wishlist products could not be loaded.', wishlistProductResult.error.message);
    setWishlistProducts((wishlistProductResult.data ?? []) as WishlistProduct[]);
    if (eventResult.error) console.error('Order timeline could not be loaded.', eventResult.error.message);
    setFulfilmentEvents((eventResult.data ?? []) as FulfilmentEvent[]);
    if (roleResult.error) console.error('Application roles could not be loaded.', roleResult.error.message);
    setRoles(Array.isArray(roleResult.data) ? roleResult.data as string[] : []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const acceptQuotation = async (quotationId: string) => {
    if (!supabase) return;
    setAcceptingId(quotationId);
    setMessage('');
    const quote = quotations.find(q => q.id === quotationId);
    const { error: acceptError } = await supabase.rpc('accept_sourcing_quotation', { p_quotation_id: quotationId });
    if (acceptError) {
      console.error('Sourcing quotation could not be accepted.', acceptError.message);
      setMessage('We could not accept this quotation. It may have expired or already been accepted.');
      setAcceptingId('');
      return;
    }
    setMessage('Quotation accepted. Your order is awaiting payment; payment initiation is not enabled yet.');
    await loadAccount();
    setAcceptingId('');
    if (quote) {
      void notificationEvents.quotationAccepted(userId, quotationId, quote.quotation_number).catch(() => {});
    }
  };

  const removeWishlistProduct = async (productId: string) => {
    if (!supabase || !wishlistId) return;
    const { error: removeError } = await supabase.from('wishlist_items').delete().eq('wishlist_id', wishlistId).eq('product_id', productId);
    if (removeError) {
      console.error('Wishlist item could not be removed.', removeError.message);
      setMessage('We could not remove that item from your wishlist.');
      return;
    }
    setWishlistProducts(items => items.filter(item => item.id !== productId));
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={event => event.stopPropagation()}>
      <div className="account-heading"><div><p className="eyebrow">Customer account</p><h2 id="account-title">Your hopNshop</h2><p>{email}</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div>
      {loading ? <p role="status">Loading your account…</p> : error ? <div className="empty-state" role="alert"><p>{error}</p><button className="button button-dark" onClick={() => void loadAccount()}>Try again</button></div> : <>
        {message && <p className="form-message success" role="status">{message}</p>}
        <section className="account-section"><h3>Your wishlist</h3>{wishlistProducts.length === 0 ? <p className="account-empty">Your wishlist is empty.</p> : wishlistProducts.map(product => <article className="account-card" key={product.id}><div className="account-card-heading"><strong>{product.name}</strong><button className="text-button" onClick={() => void removeWishlistProduct(product.id)}>Remove</button></div><p>{product.business_model === 'affiliate' ? 'Affiliate find' : product.business_model === 'resale' ? 'hopNshop sale' : 'Personal sourcing'}{product.local_selling_price !== null ? ` · ${formatMoney(product.currency, product.local_selling_price)}` : ''}</p><p>{product.description}</p></article>)}</section>
        <CustomerProfile userId={userId} />
        <section className="account-section"><h3>Your orders</h3>{orders.length === 0 ? <p className="account-empty">No orders yet.</p> : orders.map(order => {
          const orderPayments = payments.filter(payment => payment.order_id === order.id);
          const awaitingReview = orderPayments.some(payment => payment.status === 'pending');
          return <article className="account-card" key={order.id}><div className="account-card-heading"><strong>{order.order_number}</strong><span>{order.status.replaceAll('_', ' ')}</span></div><p>{order.business_model === 'affiliate' ? 'Affiliate' : order.business_model === 'sourcing' ? 'Personal sourcing' : 'hopNshop sale'} · {formatMoney(order.currency, order.total)}</p><ul>{order.order_items.map((item, index) => <li key={`${order.id}-${index}`}>{item.quantity} × {item.description}</li>)}</ul>
            {orderPayments.map(payment => {
              const refundableStatuses = ['payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing', 'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection', 'delivered', 'exception'];
              const reservedRefunds = (payment.refunds ?? []).filter(refund => ['requested', 'processing', 'completed'].includes(refund.status)).reduce((sum, refund) => sum + Number(refund.amount), 0);
              const availableRefund = Math.max(0, Number(payment.amount) - reservedRefunds);
              return <div key={payment.id}><p className="payment-history">M-Pesa · {formatMoney(payment.currency, payment.amount)} · {payment.status.replaceAll('_', ' ')}{payment.transaction_reference ? ` · ${payment.transaction_reference}` : ''}</p>{payment.refunds?.map(refund => <p className="payment-history" key={refund.id}>Refund · {formatMoney(payment.currency, refund.amount)} · {refund.status.replaceAll('_', ' ')}{refund.provider_reference ? ` · ${refund.provider_reference}` : ''}</p>)}{payment.status === 'verified' && order.business_model !== 'affiliate' && refundableStatuses.includes(order.status) && availableRefund > 0 && <ManualRefundForm payment={payment} availableAmount={availableRefund} onSubmitted={loadAccount} />}</div>;
            })}
            {fulfilmentEvents.filter(event => event.order_id === order.id).map(event => <div className="fulfilment-event" key={event.id}><strong>{event.status.replaceAll('_', ' ')} · {new Date(event.created_at).toLocaleString()}</strong><p>{event.message}</p>{(event.courier_name || event.tracking_reference) && <small>{[event.courier_name, event.tracking_reference].filter(Boolean).join(' · ')}</small>}</div>)}
            {order.business_model !== 'affiliate' && <CustomerDeliveryTracking orderId={order.id} currency={order.currency} orderStatus={order.status} onChanged={loadAccount} />}
            {awaitingReview && <p className="checkout-notice">Your payment details are awaiting administrator verification. The order is not yet marked paid.</p>}
            {pendingDeliveryFeeOrderIds.includes(order.id) && <p className="checkout-notice">Review the delivery charge request above before submitting payment. Do not pay the previous order total.</p>}
            {!awaitingReview && !pendingDeliveryFeeOrderIds.includes(order.id) && order.business_model !== 'affiliate' && ['awaiting_payment', 'payment_verification'].includes(order.status) && <ManualPaymentForm order={order} onSubmitted={loadAccount} />}
          </article>;
        })}</section>
        <section className="account-section"><h3>Your quotations</h3>{quotations.length === 0 ? <p className="account-empty">No quotations are available yet.</p> : quotations.map(quote => {
          const expired = quote.expiry_date !== null && quote.expiry_date < new Date().toISOString().slice(0, 10);
          return <article className="account-card" key={quote.id}><div className="account-card-heading"><strong>{quote.quotation_number}</strong><span>{expired ? 'expired' : quote.status.replaceAll('_', ' ')}</span></div><p>{formatMoney(quote.currency, quote.total)}{quote.delivery_window ? ` · ${quote.delivery_window}` : ''}</p><ul>{quote.items.map((item, index) => <li key={`${quote.id}-${index}`}>{item.quantity} × {item.description}</li>)}</ul>{quote.status === 'sent' && !expired && <button className="button button-dark" disabled={acceptingId === quote.id} onClick={() => void acceptQuotation(quote.id)}>{acceptingId === quote.id ? 'Accepting…' : 'Accept quotation'}</button>}</article>;
        })}</section>
        <section className="account-section"><h3>Your sourcing requests</h3>{requests.length === 0 ? <p className="account-empty">No sourcing requests yet.</p> : requests.map(request => <article className="account-card" key={request.id}><div className="account-card-heading"><strong>{request.product_name || new Date(request.created_at).toLocaleDateString()}</strong><span>{request.status.replaceAll('_', ' ')}</span></div>{request.product_name && <p>{new Date(request.created_at).toLocaleDateString()}</p>}<p className="request-url">{request.product_url}</p></article>)}</section>
        <section className="account-section"><h3>Notification Centre</h3><button className="button button-dark" onClick={() => setNotifCentreOpen(true)}>View Notification Centre</button>{notifCentreOpen && <CustomerNotificationCentre userId={userId} onClose={() => setNotifCentreOpen(false)} />}</section>
        <CustomerHelpdesk userId={userId} isStaff={roles.includes('admin') || roles.includes('fulfilment')} />
        {roles.includes('admin') && <AdminOperationalOverview />}
        {(roles.includes('admin') || roles.includes('editor')) && <><AdminProductCatalog /><AdminCollectionManager /><AdminCampaignManager /></>}
        {roles.includes('admin') && <><AdminCommercialSetup /><AdminAffiliateLinks /></>}
        {(roles.includes('admin') || roles.includes('editor')) && <><AdminSourcingQueue /><AdminSourcingWorkbench /></>}
        {(roles.includes('admin') || roles.includes('finance')) && <AdminPaymentQueue />}
        {(roles.includes('admin') || roles.includes('finance')) && <AdminRefundQueue />}
        {(roles.includes('admin') || roles.includes('fulfilment')) && <AdminDeliveryManagement canManageConfiguration={roles.includes('admin')} />}
        {(roles.includes('admin') || roles.includes('fulfilment')) && <AdminOrderQueue />}
        {(roles.includes('admin') || roles.includes('finance')) && <AdminFinanceReports />}
      </>}
      <div className="account-actions"><button className="text-button" onClick={() => void onSignOut()}>Sign out</button><button className="button button-dark" onClick={onClose}>Continue shopping</button></div>
    </section>
  </div>;
}

export default CustomerAccount;
