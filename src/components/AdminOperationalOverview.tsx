import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface OverviewCounts {
  published_products: number;
  products_in_review: number;
  sourcing_requests_open: number;
  quotations_waiting_customer: number;
  orders_awaiting_payment: number;
  orders_awaiting_payment_review: number;
  orders_in_fulfilment: number;
  payments_awaiting_review: number;
  support_cases_open: number;
}

const metrics: { key: keyof OverviewCounts; label: string }[] = [
  { key: 'published_products', label: 'Published products' },
  { key: 'products_in_review', label: 'Products in review' },
  { key: 'sourcing_requests_open', label: 'Open sourcing requests' },
  { key: 'quotations_waiting_customer', label: 'Quotes awaiting customer' },
  { key: 'orders_awaiting_payment', label: 'Orders awaiting payment' },
  { key: 'orders_awaiting_payment_review', label: 'Payments awaiting review' },
  { key: 'orders_in_fulfilment', label: 'Orders in fulfilment' },
  { key: 'payments_awaiting_review', label: 'Payment submissions to verify' },
  { key: 'support_cases_open', label: 'Open support cases' }
];

function AdminOperationalOverview() {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError('Admin services are not configured.');
      return;
    }

    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.rpc('admin_operational_overview');
    if (queryError) {
      console.error('Operational overview could not be loaded.', queryError.message);
      setError('We could not load operational counts. Confirm the latest database migration is applied and retry.');
      setCounts(null);
    } else {
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        setError('The operational overview returned no data.');
        setCounts(null);
      } else {
        setCounts(row as OverviewCounts);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return <section className="admin-operational-overview" aria-labelledby="operational-overview-title">
    <div className="section-heading">
      <div><p className="eyebrow">Admin · operations</p><h3 id="operational-overview-title">Operational overview</h3></div>
      <button className="text-button" onClick={() => void loadOverview()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh counts'}</button>
    </div>
    {loading ? <p role="status">Loading current operational counts…</p> : error ? <div role="alert"><p>{error}</p><button className="button button-dark" onClick={() => void loadOverview()}>Try again</button></div> : counts && <><p className="overview-note">Current database counts. These are workflow totals, not sales or profit statistics.</p><div className="overview-grid">{metrics.map(metric => <article className="overview-metric" key={metric.key}><span>{metric.label}</span><strong>{counts[metric.key].toLocaleString()}</strong></article>)}</div></>}
  </section>;
}

export default AdminOperationalOverview;
