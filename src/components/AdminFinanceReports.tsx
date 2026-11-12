import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface OrderRow { id: string; order_number: string; business_model: string; status: string; currency: string; total: number | string; created_at: string; }
interface PaymentRow { id: string; order_id: string | null; quotation_id: string | null; provider: string; status: string; currency: string; amount: number | string; created_at: string; }
interface ExpenseRow { id: string; description: string; category: string; currency: string; amount: number | string; incurred_on: string; }

function firstOfMonth() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); }
function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

function AdminFinanceReports() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [model, setModel] = useState('all');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || from > to) { setMessage('Choose a valid date range.'); return; }
    setLoading(true); setMessage('');
    const after = `${from}T00:00:00.000Z`;
    const before = new Date(`${to}T00:00:00.000Z`); before.setUTCDate(before.getUTCDate() + 1);
    const [orderResult, paymentResult, expenseResult] = await Promise.all([
      supabase.from('orders').select('id,order_number,business_model,status,currency,total,created_at').gte('created_at', after).lt('created_at', before.toISOString()).order('created_at', { ascending: false }).range(0, 4999),
      supabase.from('payments').select('id,order_id,quotation_id,provider,status,currency,amount,created_at').gte('created_at', after).lt('created_at', before.toISOString()).order('created_at', { ascending: false }).range(0, 4999),
      supabase.from('operating_expenses').select('id,description,category,currency,amount,incurred_on').gte('incurred_on', from).lte('incurred_on', to).order('incurred_on', { ascending: false }).range(0, 4999)
    ]);
    const error = orderResult.error ?? paymentResult.error ?? expenseResult.error;
    if (error) { console.error('Finance report data could not be loaded.', error.message); setMessage('Reports could not be loaded. Check finance role and database access.'); }
    else { setOrders((orderResult.data ?? []) as OrderRow[]); setPayments((paymentResult.data ?? []) as PaymentRow[]); setExpenses((expenseResult.data ?? []) as ExpenseRow[]); }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const addExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const description = String(form.get('description') ?? '').trim();
    const amount = Number(form.get('amount'));
    const currency = String(form.get('currency') ?? '').trim().toUpperCase();
    const category = String(form.get('category') ?? '').trim();
    const incurredOn = String(form.get('incurredOn') ?? '');
    if (description.length < 2 || description.length > 240 || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !/^[A-Z]{3}$/.test(currency) || category.length < 2 || category.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) { setMessage('Enter valid expense details, a positive amount, ISO currency, category and date.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('operating_expenses').insert({ description, amount, currency, category, incurred_on: incurredOn, created_by: user?.id });
    if (error) { console.error('Operating expense could not be saved.', error.message); setMessage('Expense could not be saved. Check finance permissions.'); return; }
    formElement.reset(); setMessage('Expense recorded.'); await load();
  };

  const exportCsv = () => {
    const rows = [
      ['record_type', 'date', 'reference', 'business_model_or_provider', 'status', 'currency', 'amount'],
      ...orders.filter(row => model === 'all' || row.business_model === model).map(row => ['order', row.created_at.slice(0, 10), row.order_number, row.business_model, row.status, row.currency, row.total]),
      ...selectedPayments.map(row => ['payment', row.created_at.slice(0, 10), row.id, row.provider, row.status, row.currency, row.amount]),
      ...expenses.map(row => ['expense', row.incurred_on, row.description, row.category, 'recorded', row.currency, row.amount])
    ];
    const content = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `hopnshop-finance-${from}-${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const selectedOrders = orders.filter(row => model === 'all' || row.business_model === model);
  const selectedOrderIds = new Set(selectedOrders.map(row => row.id));
  const selectedPayments = payments.filter(row => model === 'all' || (row.order_id ? selectedOrderIds.has(row.order_id) : model === 'sourcing' && Boolean(row.quotation_id)));
  const confirmedStatuses = new Set(['payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing', 'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection', 'delivered']);
  const confirmedOrders = selectedOrders.filter(row => confirmedStatuses.has(row.status));
  const verifiedPayments = selectedPayments.filter(row => row.status === 'verified');
  const groupedSum = (rows: { currency: string; amount: number | string }[]) => Array.from(rows.reduce((map, row) => map.set(row.currency, (map.get(row.currency) ?? 0) + Number(row.amount)), new Map<string, number>()).entries());

  return <section className="admin-product-list"><h4>Financial reports</h4><div className="quote-cost-grid"><label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Through<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>Business model<select value={model} onChange={event => setModel(event.target.value)}><option value="all">All models</option><option value="resale">Resale</option><option value="sourcing">Sourcing</option><option value="affiliate">Affiliate</option></select></label></div><button type="button" className="text-button" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh report'}</button> <button type="button" className="text-button" onClick={exportCsv}>Export CSV</button>{message && <p className="form-message" role="status">{message}</p>}
    <div className="quote-cost-grid"><article className="account-card"><strong>Orders in range</strong><p>{selectedOrders.length}</p></article><article className="account-card"><strong>Confirmed order value (by currency)</strong>{groupedSum(confirmedOrders.map(row => ({ currency: row.currency, amount: row.total }))).map(([currency, amount]) => <p key={currency}>{currency} {amount.toLocaleString()}</p>)}</article><article className="account-card"><strong>Verified payments (by currency)</strong>{groupedSum(verifiedPayments).map(([currency, amount]) => <p key={currency}>{currency} {amount.toLocaleString()}</p>)}</article><article className="account-card"><strong>Recorded expenses (by currency)</strong>{groupedSum(expenses).map(([currency, amount]) => <p key={currency}>{currency} {amount.toLocaleString()}</p>)}</article></div>
    <h5>Record operating expense</h5><form onSubmit={addExpense}><label>Description<input name="description" required maxLength={240} /></label><div className="quote-cost-grid"><label>Amount<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required /></label><label>Currency<input name="currency" defaultValue="KES" minLength={3} maxLength={3} required /></label><label>Category<input name="category" required maxLength={80} /></label><label>Date<input name="incurredOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label></div><button className="button button-dark" type="submit">Save expense</button></form>
    <h5>Orders</h5>{selectedOrders.map(order => <article className="admin-request" key={order.id}><div className="account-card-heading"><strong>{order.order_number}</strong><span>{order.status.replaceAll('_', ' ')}</span></div><p>{order.business_model} | {order.currency} {Number(order.total).toLocaleString()} | {new Date(order.created_at).toLocaleDateString()}</p></article>)}
  </section>;
}

export default AdminFinanceReports;
