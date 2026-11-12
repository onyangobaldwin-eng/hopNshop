import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Partner { id: string; name: string; programme_status: string; }
interface Product { id: string; name: string; publication_status: string; business_model: string; }
interface Link { id: string; partner_id: string; product_id: string | null; tracking_url: string; campaign: string | null; active: boolean; clickCount: number; partner?: Partner; product?: Product; }

function AdminAffiliateLinks() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const [partnerResult, productResult, linkResult, clickResult] = await Promise.all([
      supabase.from('affiliate_partners').select('id,name,programme_status').order('name'),
      supabase.from('products').select('id,name,publication_status,business_model').eq('business_model', 'affiliate').order('name'),
      supabase.from('affiliate_links').select('id,partner_id,product_id,tracking_url,campaign,active').order('campaign'),
      supabase.from('affiliate_click_events').select('affiliate_link_id').range(0, 9999)
    ]);
    const err = partnerResult.error ?? productResult.error ?? linkResult.error ?? clickResult.error;
    if (err) { console.error('Affiliate links could not be loaded.', err.message); setMessage('Affiliate links could not be loaded. Check admin access.'); return; }
    const partnerRows = (partnerResult.data ?? []) as Partner[];
    const productRows = (productResult.data ?? []) as Product[];
    setPartners(partnerRows); setProducts(productRows);
    const clickCounts = new Map<string, number>();
    (clickResult.data ?? []).forEach(row => clickCounts.set(row.affiliate_link_id, (clickCounts.get(row.affiliate_link_id) ?? 0) + 1));
    setLinks((linkResult.data ?? []).map(row => ({ ...row, clickCount: clickCounts.get(row.id) ?? 0, partner: partnerRows.find(partner => partner.id === row.partner_id), product: productRows.find(product => product.id === row.product_id) })) as Link[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const partnerId = String(form.get('partnerId') ?? '');
    const productId = String(form.get('productId') ?? '');
    const trackingUrl = String(form.get('trackingUrl') ?? '').trim();
    const campaign = String(form.get('campaign') ?? '').trim();
    const partner = partners.find(item => item.id === partnerId);
    const product = products.find(item => item.id === productId);
    if (!partner || !product || !/^https:\/\//i.test(trackingUrl) || trackingUrl.length > 2000 || campaign.length > 120) { setMessage('Choose a partner and affiliate product, enter an HTTPS tracking URL and a short campaign name.'); return; }
    const active = partner.programme_status === 'approved' && product.publication_status === 'published' && form.get('activate') === 'on';
    const { error } = await supabase.from('affiliate_links').insert({ partner_id: partnerId, product_id: productId, tracking_url: trackingUrl, campaign: campaign || null, active });
    if (error) { console.error('Affiliate link could not be saved.', error.message); setMessage('Affiliate link could not be saved. Check approval, product state and duplicate active links.'); return; }
    if (active) {
      const { error: productError } = await supabase.from('products').update({ affiliate_tracking_url: trackingUrl }).eq('id', productId);
      if (productError) { console.error('Affiliate product URL could not be updated.', productError.message); setMessage('Link saved, but the product URL could not be synced. Review the product before activating.'); }
    }
    formElement.reset(); await load();
    if (!active) setMessage('Link saved inactive. Both the partner and product must be approved/published before activation.');
  };

  const toggle = async (link: Link) => {
    if (!supabase) return;
    const canActivate = link.partner?.programme_status === 'approved' && link.product?.publication_status === 'published';
    if (!link.active && !canActivate) { setMessage('Approve the partner programme and publish the product before activation.'); return; }
    if (!link.active && !window.confirm('Confirm partner approval and tracking terms have been reviewed?')) return;
    const { error } = await supabase.from('affiliate_links').update({ active: !link.active }).eq('id', link.id);
    if (error) { console.error('Affiliate link status could not be updated.', error.message); setMessage('Affiliate link status could not be changed.'); return; }
    if (link.product_id) {
      const { error: productError } = await supabase.from('products').update({ affiliate_tracking_url: link.active ? null : link.tracking_url }).eq('id', link.product_id);
      if (productError) console.error('Affiliate product URL could not be synced.', productError.message);
    }
    await load();
  };

  return <section className="admin-product-list"><h4>Affiliate links and campaigns</h4><form onSubmit={create}><label>Approved programme<select name="partnerId" required defaultValue=""><option value="" disabled>Choose a programme</option>{partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name} ({partner.programme_status})</option>)}</select></label><label>Affiliate product<select name="productId" required defaultValue=""><option value="" disabled>Choose a product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} ({product.publication_status})</option>)}</select></label><label>Tracking URL<input name="trackingUrl" type="url" required maxLength={2000} /></label><label>Campaign name<input name="campaign" maxLength={120} /></label><label><input name="activate" type="checkbox" /> Activate now only if approved and published</label><button className="button button-dark" type="submit">Save affiliate link</button></form>{links.map(link => <article className="admin-request" key={link.id}><div className="account-card-heading"><strong>{link.product?.name ?? 'Product removed'}</strong><span>{link.active ? 'Active' : 'Inactive'}</span></div><p>{link.partner?.name ?? 'Programme'}{link.campaign ? ` | ${link.campaign}` : ''} | {link.clickCount} tracked clicks</p><p className="request-url">{link.tracking_url}</p><button className="text-button" type="button" onClick={() => void toggle(link)}>{link.active ? 'Pause link' : 'Activate link'}</button></article>)}{message && <p className="form-message" role="status">{message}</p>}</section>;
}

export default AdminAffiliateLinks;
