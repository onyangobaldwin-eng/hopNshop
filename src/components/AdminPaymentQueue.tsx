import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface PaymentOrder {
  id: string;
  order_number: string;
  business_model: string;
}

interface ManualPayment {
  id: string;
  order_id: string;
  user_id: string;
  transaction_reference: string;
  payer_name: string | null;
  amount: number | string;
  currency: string;
  created_at: string;
  order?: PaymentOrder;
}

function AdminPaymentQueue() {
  const [payments, setPayments] = useState<ManualPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState('');
  const [message, setMessage] = useState('');

  const loadPayments = useCallback(async () => {
    if (!supabase) {
      setMessage('Payment services are not configured.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage('');
    const { data, error } = await supabase
      .from('payments')
      .select('id,order_id,user_id,transaction_reference,payer_name,amount,currency,created_at')
      .eq('provider', 'manual_mpesa')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Manual payment queue could not be loaded.', error.message);
      setMessage('We could not load pending payment submissions.');
      setLoading(false);
      return;
    }

    const rows = (data ?? []).filter((row): row is typeof row & { order_id: string } => Boolean(row.order_id));
    if (rows.length === 0) {
      setPayments([]);
      setLoading(false);
      return;
    }
    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id,order_number,business_model')
      .in('id', rows.map(row => row.order_id));
    if (orderError) {
      console.error('Payment orders could not be loaded.', orderError.message);
      setMessage('We could not load the orders for these payment submissions.');
      setLoading(false);
      return;
    }
    const orderById = new Map(((orders ?? []) as PaymentOrder[]).map(order => [order.id, order]));
    setPayments(rows.map(row => ({ ...row, order: orderById.get(row.order_id) })) as ManualPayment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  const reviewPayment = async (payment: ManualPayment, verified: boolean) => {
    const verb = verified ? 'verify' : 'reject';
    if (!window.confirm(`Are you sure you want to ${verb} M-Pesa reference ${payment.transaction_reference}? Confirm this against the official payment statement first.`)) return;
    if (!supabase) return;
    setReviewingId(payment.id);
    setMessage('');
    const { error } = await supabase.rpc('admin_review_manual_payment', {
      p_payment_id: payment.id,
      p_verified: verified,
      p_review_note: null
    });
    setReviewingId('');
    if (error) {
      console.error('Manual payment could not be reviewed.', error.message);
      setMessage('The payment could not be reviewed. It may have already been handled.');
      return;
    }
    await loadPayments();
  };

  return <section className="admin-queue admin-payment-queue">
    <div className="section-heading"><div><p className="eyebrow">Admin · finance</p><h3>Payment verification</h3></div><button className="text-button" onClick={() => void loadPayments()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {message && <p role="alert">{message}</p>}
    {loading ? <p role="status">Loading payment submissions…</p> : payments.length === 0 ? <p className="account-empty">No manual payments are waiting for verification.</p> : payments.map(payment => <article className="admin-request" key={payment.id}>
      <div className="account-card-heading"><strong>{payment.order?.order_number ?? 'Order unavailable'}</strong><span>pending verification</span></div>
      <p>{payment.order?.business_model === 'sourcing' ? 'Personal sourcing' : 'hopNshop sale'} · {payment.currency.toUpperCase()} {Number(payment.amount).toLocaleString()}</p>
      <p><strong>Transaction reference:</strong> {payment.transaction_reference}</p>
      <p><strong>Payer:</strong> {payment.payer_name ?? 'Not supplied'} · <strong>Submitted:</strong> {new Date(payment.created_at).toLocaleString()}</p>
      <p className="checkout-notice">Verify the transaction, amount and recipient in the official M-Pesa statement before accepting. Customer-submitted details alone are not proof of payment.</p>
      <div className="hero-actions"><button className="button button-dark" disabled={reviewingId === payment.id || !payment.order} onClick={() => void reviewPayment(payment, true)}>{reviewingId === payment.id ? 'Reviewing…' : 'Verify payment'}</button><button className="text-button" disabled={reviewingId === payment.id || !payment.order} onClick={() => void reviewPayment(payment, false)}>Reject submission</button></div>
    </article>)}
  </section>;
}

export default AdminPaymentQueue;
