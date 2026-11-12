import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type CampaignTarget = 'category' | 'collection' | 'product' | 'sourcing';

interface Campaign {
  id: string;
  slug: string;
  title: string;
  description: string;
  image_url: string;
  cta_label: string;
  target_type: CampaignTarget;
  category_id: string | null;
  collection_id: string | null;
  product_id: string | null;
  starts_at: string;
  ends_at: string;
  published: boolean;
}

interface Choice { id: string; name: string; }

const campaignFields = 'id,slug,title,description,image_url,cta_label,target_type,category_id,collection_id,product_id,starts_at,ends_at,published';

function localDateTime(value: string) {
  const date = new Date(value);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function campaignState(campaign: Campaign) {
  const now = Date.now();
  if (!campaign.published) return 'Draft';
  if (new Date(campaign.starts_at).getTime() > now) return 'Scheduled';
  if (new Date(campaign.ends_at).getTime() <= now) return 'Expired';
  return 'Live';
}

function AdminCampaignManager() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [categories, setCategories] = useState<Choice[]>([]);
  const [collections, setCollections] = useState<Choice[]>([]);
  const [products, setProducts] = useState<Choice[]>([]);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [formTarget, setFormTarget] = useState<CampaignTarget>('sourcing');
  const [formTargetId, setFormTargetId] = useState('');

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setMessage('Campaign management is not configured.');
      return;
    }
    setLoading(true);
    const [campaignResult, categoryResult, collectionResult, productResult] = await Promise.all([
      supabase.from('promotional_campaigns').select(campaignFields).order('starts_at', { ascending: false }).limit(100),
      supabase.from('categories').select('id,name').eq('published', true).order('name'),
      supabase.from('collections').select('id,name').eq('published', true).order('name'),
      supabase.from('products').select('id,name').eq('publication_status', 'published').order('name').limit(500)
    ]);
    const error = campaignResult.error ?? categoryResult.error ?? collectionResult.error ?? productResult.error;
    if (error) {
      console.error('Campaign management data could not be loaded.', error.message);
      setMessage('Campaign data could not be loaded. Apply the marketplace campaign migration and check staff access.');
    } else {
      setCampaigns((campaignResult.data ?? []) as Campaign[]);
      setCategories((categoryResult.data ?? []) as Choice[]);
      setCollections((collectionResult.data ?? []) as Choice[]);
      setProducts((productResult.data ?? []) as Choice[]);
      setMessage('');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const slug = String(form.get('slug') ?? '').trim();
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const imageUrl = String(form.get('imageUrl') ?? '').trim();
    const ctaLabel = String(form.get('ctaLabel') ?? '').trim();
    const targetType = String(form.get('targetType') ?? '') as CampaignTarget;
    const targetId = String(form.get('targetId') ?? '');
    const startsAt = new Date(String(form.get('startsAt') ?? ''));
    const endsAt = new Date(String(form.get('endsAt') ?? ''));
    const targetChoices = targetType === 'category' ? categories : targetType === 'collection' ? collections : targetType === 'product' ? products : [];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || title.length < 2 || title.length > 120 || description.length > 1000
      || !/^https:\/\//i.test(imageUrl) || ctaLabel.length < 2 || ctaLabel.length > 40
      || !['category', 'collection', 'product', 'sourcing'].includes(targetType)
      || (targetType !== 'sourcing' && !targetChoices.some(choice => choice.id === targetId))
      || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setMessage('Check the title, slug, HTTPS campaign image, destination and valid start/end dates.');
      return;
    }

    const payload = {
      slug,
      title,
      description,
      image_url: imageUrl,
      cta_label: ctaLabel,
      target_type: targetType,
      category_id: targetType === 'category' ? targetId : null,
      collection_id: targetType === 'collection' ? targetId : null,
      product_id: targetType === 'product' ? targetId : null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      published: form.get('published') === 'on'
    };
    setSaving(true);
    const result = editing
      ? await supabase.from('promotional_campaigns').update(payload).eq('id', editing.id)
      : await supabase.from('promotional_campaigns').insert(payload);
    setSaving(false);
    if (result.error) {
      console.error('Campaign could not be saved.', result.error.message);
      setMessage('Campaign could not be saved. Check that the slug is unique and the destination is still published.');
      return;
    }
    setEditing(null);
    setFormTarget('sourcing');
    setFormTargetId('');
    setFormKey(key => key + 1);
    setMessage('Campaign saved.');
    await load();
  };

  const archive = async (campaign: Campaign) => {
    if (!supabase || !window.confirm(`Unpublish “${campaign.title}”?`)) return;
    const { error } = await supabase.from('promotional_campaigns').update({ published: false }).eq('id', campaign.id);
    if (error) {
      console.error('Campaign could not be unpublished.', error.message);
      setMessage('Campaign could not be unpublished.');
      return;
    }
    await load();
  };

  const selectedTarget = editing?.target_type ?? formTarget;
  const selectedTargetId = editing
    ? editing.category_id ?? editing.collection_id ?? editing.product_id ?? ''
    : formTargetId;
  const options = selectedTarget === 'category' ? categories : selectedTarget === 'collection' ? collections : selectedTarget === 'product' ? products : [];

  return <section className="admin-product-list">
    <h4>Promotional campaigns</h4>
    <p className="account-empty">Only published campaigns within their scheduled dates appear on the storefront. Discounts are not advertised unless independently supported by current product pricing.</p>
    <form key={`${editing?.id ?? 'new'}-${formKey}`} onSubmit={save}>
      <label>Campaign title<input name="title" required minLength={2} maxLength={120} defaultValue={editing?.title ?? ''} /></label>
      <label>URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} defaultValue={editing?.slug ?? ''} /></label>
      <label>Description<textarea name="description" maxLength={1000} defaultValue={editing?.description ?? ''} /></label>
      <label>Campaign image HTTPS URL<input name="imageUrl" type="url" required pattern="https://.+" maxLength={2000} defaultValue={editing?.image_url ?? ''} /></label>
      <label>Button label<input name="ctaLabel" required minLength={2} maxLength={40} defaultValue={editing?.cta_label ?? 'Explore'} /></label>
      <div className="quote-cost-grid">
        <label>Destination type<select name="targetType" value={selectedTarget} onChange={event => {
          const next = event.currentTarget.value as CampaignTarget;
          setFormTarget(next);
          setFormTargetId('');
          setEditing(current => current ? { ...current, target_type: next, category_id: null, collection_id: null, product_id: null } : null);
        }}><option value="sourcing">Personal sourcing</option><option value="category">Category</option><option value="collection">Collection</option><option value="product">Product</option></select></label>
        {selectedTarget !== 'sourcing' && <label>Destination<select name="targetId" required value={selectedTargetId} onChange={event => {
          const value = event.currentTarget.value;
          setFormTargetId(value);
          setEditing(current => current ? {
            ...current,
            category_id: selectedTarget === 'category' ? value : null,
            collection_id: selectedTarget === 'collection' ? value : null,
            product_id: selectedTarget === 'product' ? value : null
          } : null);
        }}><option value="">Choose a destination</option>{options.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>}
      </div>
      <div className="quote-cost-grid">
        <label>Starts<input name="startsAt" type="datetime-local" required defaultValue={editing ? localDateTime(editing.starts_at) : ''} /></label>
        <label>Ends<input name="endsAt" type="datetime-local" required defaultValue={editing ? localDateTime(editing.ends_at) : ''} /></label>
      </div>
      <label><input name="published" type="checkbox" defaultChecked={editing?.published ?? false} /> Publish during the scheduled period</label>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save campaign' : 'Create campaign'}</button>
      {editing && <button className="text-button" type="button" onClick={() => { setEditing(null); setFormTarget('sourcing'); setFormTargetId(''); setFormKey(key => key + 1); setMessage(''); }}>Cancel edit</button>}
    </form>
    {loading ? <p role="status">Loading campaigns…</p> : campaigns.length === 0 ? <p className="account-empty">No campaigns have been created.</p> : campaigns.map(campaign => <article className="admin-request" key={campaign.id}>
      <div className="account-card-heading"><strong>{campaign.title}</strong><span>{campaignState(campaign)}</span></div>
      <p>{new Date(campaign.starts_at).toLocaleString()} – {new Date(campaign.ends_at).toLocaleString()}</p>
      <div className="hero-actions"><button type="button" className="text-button" onClick={() => { setEditing(campaign); setFormTarget(campaign.target_type); setFormTargetId(campaign.category_id ?? campaign.collection_id ?? campaign.product_id ?? ''); setFormKey(key => key + 1); setMessage(''); }}>Edit</button>{campaign.published && <button type="button" className="text-button" onClick={() => void archive(campaign)}>Unpublish</button>}</div>
    </article>)}
  </section>;
}

export default AdminCampaignManager;
