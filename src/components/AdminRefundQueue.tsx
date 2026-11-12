import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { manualRefundCompletionSchema } from '../lib/domain';
import { supabase } from '../lib/supabase';

interface RefundRecord {
  id: string;
  payment_id: string;
  amount: number | string;
  reason: string;
  status: string;
  created_at: string;
  provider_reference: string | null;
}

function AdminRefundQueue() {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  const loadRefunds = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setMessage('Refund services are not configured.');
      return;
    }
    setLoading(true);
    setMessage('');
    const { data, error } = await supabase.from('refunds')
      .select('id,payment_id,amount,reason,status,created_at,provider_reference')
      .in('status', ['requested', 'processing'])
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Refund queue could not be loaded.', error.message);
      setMessage('We could not load refund requests. Check administrator or finance permissions.');
    } else {
      setRefunds((data ?? []) as RefundRecord[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadRefunds(); }, [loadRefunds]);

  const review = async (refund: RefundRecord, approved: boolean) => {
    if (!supabase) return;
    const decision = approved ? 'approve' : 'reject';
    if (!window.confirm(`Are you sure you want to ${decision} this refund request?`)) return;
    setBusyId(refund.id);
    setMessage('');
    const { error } = await supabase.rpc('admin_review_manual_refund', {
      p_refund_id: refund.id,
      p_approved: approved,
      p_review_note: null
    });
    if (error) {
      console.error('Refund request could not be reviewed.', error.message);
      setMessage('The refund request could not be reviewed. It may have already been handled.');
    }
    setBusyId('');
    if (!error) await loadRefunds();
  };

  const complete = async (event: FormEvent<HTMLFormElement>, refund: RefundRecord) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = manualRefundCompletionSchema.safeParse({ providerReference: form.get('providerReference') });
    if (!parsed.success) {
      setMessage('Enter the transaction reference from the actual completed refund.');
      return;
    }
    if (!supabase || !window.confirm('Confirm that the refund was actually sent and verify this reference against the payment statement?')) return;
    setBusyId(refund.id);
    setMessage('');
    const { error } = await supabase.rpc('admin_complete_manual_refund', {
      p_refund_id: refund.id,
      p_provider_reference: parsed.data.providerReference
    });
    if (error) {
      console.error('Refund completion could not be recorded.', error.message);
      setMessage('Refund completion could not be recorded. Verify the request state and reference.');
    }
    setBusyId('');
    if (!error) await loadRefunds();
  };

  return <section className="admin-queue">
    <div className="section-heading"><div><p className="eyebrow">Admin · finance</p><h3>Refund processing</h3></div><button className="text-button" onClick={() => void loadRefunds()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    <p className="checkout-notice">Refunds are processed manually outside the app. Mark a refund complete only after confirming the real transfer in the official payment statement.</p>
    {message && <p role="alert">{message}</p>}
    {loading ? <p role="status">Loading refund requests…</p> : refunds.length === 0 ? <p className="account-empty">No refund requests need processing.</p> : refunds.map(refund => <article className="admin-request" key={refund.id}>
      <div className="account-card-heading"><strong>{Number(refund.amount).toLocaleString()} · {refund.status}</strong><span>{new Date(refund.created_at).toLocaleString()}</span></div>
      <p><strong>Customer reason:</strong> {refund.reason}</p>
      <p><strong>Payment:</strong> {refund.payment_id}</p>
      {refund.status === 'requested'
        ? <div className="hero-actions"><button className="button button-dark" disabled={busyId === refund.id} onClick={() => void review(refund, true)}>{busyId === refund.id ? 'Reviewing…' : 'Approve for processing'}</button><button className="text-button" disabled={busyId === refund.id} onClick={() => void review(refund, false)}>Reject request</button></div>
        : <form className="manual-payment-form" onSubmit={event => void complete(event, refund)}><label>Completed refund transaction reference<input name="providerReference" required minLength={6} maxLength={30} pattern="[A-Za-z0-9]{6,30}" /></label><button className="button button-dark" type="submit" disabled={busyId === refund.id}>{busyId === refund.id ? 'Recording…' : 'Record completed refund'}</button></form>}
    </article>)}
  </section>;
}

export default AdminRefundQueue;
