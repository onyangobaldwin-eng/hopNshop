import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Supplier { id: string; name: string; country: string | null; supplier_type: string | null; marketplace: string | null; verification_status: string; notes: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; return_terms: string | null; payment_terms: string | null; shipping_permissions: string | null; sample_status: string | null; }
interface Partner { id: string; name: string; programme_status: string; disclosure_text: string | null; commission_rate: number | string | null; terms_url: string | null; }

function AdminCommercialSetup() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const [supplierResult, partnerResult] = await Promise.all([
      supabase.from('suppliers').select('id,name,country,supplier_type,marketplace,verification_status,notes,contact_name,contact_email,contact_phone,return_terms,payment_terms,shipping_permissions,sample_status').order('name'),
      supabase.from('affiliate_partners').select('id,name,programme_status,disclosure_text,commission_rate,terms_url').order('name')
    ]);
    if (supplierResult.error || partnerResult.error) {
      console.error('Commercial setup records could not be loaded.', supplierResult.error?.message ?? partnerResult.error?.message);
      setMessage('Supplier or affiliate records could not be loaded. Check admin access and try again.');
      return;
    }
    setSuppliers((supplierResult.data ?? []) as Supplier[]);
    setPartners((partnerResult.data ?? []) as Partner[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const createSupplier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('supplierName') ?? '').trim();
    if (name.length < 2 || name.length > 160) { setMessage('Supplier name must be between 2 and 160 characters.'); return; }
    const { error } = await supabase.from('suppliers').insert({ name, country: String(form.get('country') ?? '').trim() || null, supplier_type: String(form.get('supplierType') ?? '').trim() || null, marketplace: String(form.get('marketplace') ?? '').trim() || null, contact_name: String(form.get('contactName') ?? '').trim() || null, contact_email: String(form.get('contactEmail') ?? '').trim() || null, contact_phone: String(form.get('contactPhone') ?? '').trim() || null, verification_status: 'unverified' });
    if (error) { console.error('Supplier could not be saved.', error.message); setMessage('Supplier could not be saved.'); return; }
    formElement.reset(); await load(); setMessage('Supplier saved as unverified. Record evidence before marking verified.');
  };

  const updateSupplier = async (supplier: Supplier, patch: Partial<Supplier>) => {
    if (!supabase) return;
    const { error } = await supabase.from('suppliers').update(patch).eq('id', supplier.id);
    if (error) { console.error('Supplier record could not be updated.', error.message); setMessage('Supplier record could not be updated.'); return; }
    await load();
  };

  const createPartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('partnerName') ?? '').trim();
    const rateText = String(form.get('commissionRate') ?? '').trim();
    const rate = rateText ? Number(rateText) : null;
    const termsUrl = String(form.get('termsUrl') ?? '').trim();
    if (name.length < 2 || name.length > 160 || (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) || (termsUrl && !/^https:\/\//i.test(termsUrl))) { setMessage('Check the partner name, optional 0–100 commission rate and HTTPS terms URL.'); return; }
    const { error } = await supabase.from('affiliate_partners').insert({ name, commission_rate: rate, terms_url: termsUrl || null, disclosure_text: String(form.get('disclosure') ?? '').trim() || null, programme_status: 'pending_approval' });
    if (error) { console.error('Affiliate partner could not be saved.', error.message); setMessage('Affiliate partner could not be saved.'); return; }
    formElement.reset(); await load(); setMessage('Partner saved as pending approval. Do not activate affiliate links before programme approval.');
  };

  return <section className="admin-product-list"><h4>Supplier and affiliate setup</h4>
    <h5>Suppliers</h5><form onSubmit={createSupplier}><label>Supplier name<input name="supplierName" required minLength={2} maxLength={160} /></label><div className="quote-cost-grid"><label>Country<input name="country" maxLength={100} /></label><label>Supplier type<input name="supplierType" maxLength={80} /></label></div><label>Marketplace<input name="marketplace" maxLength={160} /></label><label>Contact person<input name="contactName" maxLength={120} /></label><div className="quote-cost-grid"><label>Contact email<input name="contactEmail" type="email" maxLength={254} /></label><label>Contact phone<input name="contactPhone" maxLength={40} /></label></div><button className="button button-dark" type="submit">Add unverified supplier</button></form>
    {suppliers.map(supplier => <article className="admin-request" key={supplier.id}><div className="account-card-heading"><strong>{supplier.name}</strong><span>{supplier.verification_status}</span></div><p>{[supplier.country, supplier.supplier_type, supplier.marketplace].filter(Boolean).join(' | ')}</p><label>Contact person<input defaultValue={supplier.contact_name ?? ''} maxLength={120} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.contact_name) void updateSupplier(supplier, { contact_name: value }); }} /></label><div className="quote-cost-grid"><label>Contact email<input type="email" defaultValue={supplier.contact_email ?? ''} maxLength={254} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.contact_email) void updateSupplier(supplier, { contact_email: value }); }} /></label><label>Contact phone<input defaultValue={supplier.contact_phone ?? ''} maxLength={40} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.contact_phone) void updateSupplier(supplier, { contact_phone: value }); }} /></label></div><label>Sample status<input defaultValue={supplier.sample_status ?? ''} maxLength={120} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.sample_status) void updateSupplier(supplier, { sample_status: value }); }} /></label><label>Return terms<textarea maxLength={1000} defaultValue={supplier.return_terms ?? ''} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.return_terms) void updateSupplier(supplier, { return_terms: value }); }} /></label><label>Payment terms<textarea maxLength={1000} defaultValue={supplier.payment_terms ?? ''} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.payment_terms) void updateSupplier(supplier, { payment_terms: value }); }} /></label><label>Shipping permissions<textarea maxLength={1000} defaultValue={supplier.shipping_permissions ?? ''} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.shipping_permissions) void updateSupplier(supplier, { shipping_permissions: value }); }} /></label><label>Verification evidence / notes<textarea maxLength={2000} defaultValue={supplier.notes ?? ''} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== supplier.notes) void updateSupplier(supplier, { notes: value }); }} /></label><label>Verification status<select value={supplier.verification_status} onChange={event => void updateSupplier(supplier, { verification_status: event.target.value })}><option value="unverified">Unverified</option><option value="under_review">Under review</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></label></article>)}
    <h5>Affiliate programmes</h5><form onSubmit={createPartner}><label>Programme name<input name="partnerName" required minLength={2} maxLength={160} /></label><div className="quote-cost-grid"><label>Commission rate (%)<input name="commissionRate" type="number" min="0" max="100" step="0.0001" /></label><label>Programme terms URL<input name="termsUrl" type="url" maxLength={2000} /></label></div><label>Required disclosure text<textarea name="disclosure" maxLength={500} /></label><button className="button button-dark" type="submit">Add pending programme</button></form>
    {partners.map(partner => <article className="admin-request" key={partner.id}><div className="account-card-heading"><strong>{partner.name}</strong><span>{partner.programme_status.replaceAll('_', ' ')}</span></div><p>{partner.commission_rate === null ? 'Rate not recorded' : `${partner.commission_rate}%`}{partner.terms_url ? ` | ${partner.terms_url}` : ''}</p>{partner.disclosure_text && <p>{partner.disclosure_text}</p>}<label>Programme status<select value={partner.programme_status} onChange={event => { if (event.target.value === 'approved' && !window.confirm('Confirm this programme has approved hopNshop and the terms have been reviewed?')) return; void supabase?.from('affiliate_partners').update({ programme_status: event.target.value }).eq('id', partner.id).then(({ error }) => { if (error) { console.error('Affiliate programme could not be updated.', error.message); setMessage('Affiliate programme could not be updated.'); } else void load(); }); }}><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="paused">Paused</option><option value="rejected">Rejected</option></select></label></article>)}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}

export default AdminCommercialSetup;

