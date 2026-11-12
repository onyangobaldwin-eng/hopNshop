import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminProductSchema, sourcingReferenceImageSchema, type BusinessModel, type ProductAvailability } from '../lib/domain';
import { supabase } from '../lib/supabase';

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  brand: string | null;
  category_id: string | null;
  business_model: BusinessModel;
  availability: ProductAvailability;
  currency: string;
  original_price: number | string | null;
  local_selling_price: number | string | null;
  source_url: string | null;
  affiliate_tracking_url: string | null;
  publication_status: string;
  verified_at: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  published: boolean;
}

interface ProductMediaRow {
  id: string;
  storage_path: string;
  alt_text: string;
  sort_order: number;
  signedUrl?: string;
}
interface ProductVariantRow { id: string; name: string; sku: string | null; attributes: Record<string, unknown>; price: number | string | null; available: boolean; }

function slugify(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 220);
}

function AdminProductCatalog() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [productImages, setProductImages] = useState<ProductMediaRow[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [variants, setVariants] = useState<ProductVariantRow[]>([]);
  const [variantMessage, setVariantMessage] = useState('');
  const [formVersion, setFormVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadCatalog = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setMessage('Catalogue management is not configured.');
      return;
    }
    setLoading(true);
    setMessage('');
    const [productResult, categoryResult] = await Promise.all([
      supabase.from('products').select('id,name,slug,description,brand,category_id,business_model,availability,currency,original_price,local_selling_price,source_url,affiliate_tracking_url,publication_status,verified_at').order('updated_at', { ascending: false }),
      supabase.from('categories').select('id,name,slug,description,image_url,published').order('name')
    ]);
    if (productResult.error || categoryResult.error) {
      console.error('Catalogue management data could not be loaded.', productResult.error?.message ?? categoryResult.error?.message);
      setMessage('We could not load catalogue data. Check access and try again.');
    } else {
      setProducts((productResult.data ?? []) as ProductRow[]);
      setCategories((categoryResult.data ?? []) as CategoryRow[]);
    }
    setLoading(false);
  }, []);

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('categoryName') ?? '').trim();
    const slug = String(form.get('categorySlug') ?? '').trim();
    const description = String(form.get('categoryDescription') ?? '').trim();
    const imageUrl = String(form.get('categoryImageUrl') ?? '').trim();
    const published = form.get('categoryPublished') === 'on';
    if (name.length < 2 || name.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || description.length > 500 || (imageUrl && !/^https:\/\//i.test(imageUrl))) {
      setMessage('Enter a category name, lower-case slug, description under 500 characters, and an optional public HTTPS image URL.');
      return;
    }
    const { error } = await supabase.from('categories').insert({ name, slug, description: description || null, image_url: imageUrl || null, published });
    if (error) { console.error('Category could not be saved.', error.message); setMessage('The category could not be saved. Check its name and slug.'); return; }
    formElement.reset();
    await loadCatalog();
    setMessage(published ? 'Category published.' : 'Category saved as a draft.');
  };

  const setCategoryPublished = async (category: CategoryRow) => {
    if (!supabase) return;
    const { error } = await supabase.from('categories').update({ published: !category.published }).eq('id', category.id);
    if (error) { console.error('Category publication state could not be changed.', error.message); setMessage('The category could not be updated.'); return; }
    await loadCatalog();
  };

  const setCategoryImage = async (category: CategoryRow, value: string) => {
    if (!supabase) return;
    const imageUrl = value.trim();
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      setMessage('Category images must use a public HTTPS URL.');
      return;
    }
    if ((imageUrl || null) === category.image_url) return;
    const { error } = await supabase.from('categories').update({ image_url: imageUrl || null }).eq('id', category.id);
    if (error) {
      console.error('Category image could not be updated.', error.message);
      setMessage('The category image could not be updated.');
      return;
    }
    await loadCatalog();
  };

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const loadProductImages = useCallback(async (productId: string) => {
    if (!supabase) return;
    const client = supabase;
    const { data, error } = await client.from('product_media').select('id,storage_path,alt_text,sort_order').eq('product_id', productId).order('sort_order');
    if (error) {
      console.error('Product images could not be loaded.', error.message);
      setMessage('Product images could not be loaded. Check Storage access and try again.');
      return;
    }
    const rows = (data ?? []) as ProductMediaRow[];
    const withUrls = await Promise.all(rows.map(async row => {
      const { data: signed, error: signedError } = await client.storage.from('product-media').createSignedUrl(row.storage_path, 3600);
      if (signedError) {
        console.error('A product image could not be opened.', signedError.message);
        return row;
      }
      return { ...row, signedUrl: signed.signedUrl };
    }));
    setProductImages(withUrls);
  }, []);

  useEffect(() => {
    setProductImages([]);
    setVariants([]);
    if (editing) {
      void loadProductImages(editing.id);
      if (supabase) void supabase.from('product_variants').select('id,name,sku,attributes,price,available').eq('product_id', editing.id).order('name').then(({ data, error }) => {
        if (error) { console.error('Product variants could not be loaded.', error.message); setVariantMessage('Variants could not be loaded. Check access and try again.'); }
        else setVariants((data ?? []) as ProductVariantRow[]);
      });
    }
  }, [editing, loadProductImages]);

  const saveVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !editing) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let attributes: Record<string, unknown>;
    try { attributes = JSON.parse(String(form.get('attributes') || '{}')) as Record<string, unknown>; if (!attributes || Array.isArray(attributes) || typeof attributes !== 'object') throw new Error(); }
    catch { setVariantMessage('Enter variant attributes as a JSON object, for example {"size":"M","colour":"Blue"}.'); return; }
    const name = String(form.get('variantName') ?? '').trim();
    const sku = String(form.get('variantSku') ?? '').trim() || null;
    const rawPrice = String(form.get('variantPrice') ?? '').trim();
    const price = rawPrice ? Number(rawPrice) : null;
    if (name.length < 1 || name.length > 120 || (price !== null && (!Number.isFinite(price) || price <= 0 || price > 100000000))) { setVariantMessage('Enter a variant name and a valid optional positive price.'); return; }
    const { data, error } = await supabase.from('product_variants').insert({ product_id: editing.id, name, sku, attributes, price, available: form.get('variantAvailable') === 'on' }).select('id,name,sku,attributes,price,available').single();
    if (error) { console.error('Product variant could not be saved.', error.message); setVariantMessage('The variant could not be saved. Check your access and try again.'); return; }
    setVariants(current => [...current, data as ProductVariantRow].sort((a, b) => a.name.localeCompare(b.name)));
    formElement.reset();
    setVariantMessage('Variant saved.');
  };

  const removeVariant = async (variant: ProductVariantRow) => {
    if (!supabase || !editing || !window.confirm(`Remove ${variant.name}?`)) return;
    const { error } = await supabase.from('product_variants').delete().eq('id', variant.id).eq('product_id', editing.id);
    if (error) { console.error('Product variant could not be removed.', error.message); setVariantMessage('The variant could not be removed.'); return; }
    setVariants(current => current.filter(item => item.id !== variant.id));
  };

  const uploadProductImage = async () => {
    if (!supabase || !editing || !imageFile) return;
    if (!sourcingReferenceImageSchema.safeParse(imageFile).success || imageAlt.trim().length < 2 || imageAlt.trim().length > 300) {
      setMessage('Choose a JPG, PNG or WebP up to 5 MB and add descriptive alt text.');
      return;
    }
    setImageBusy(true);
    setMessage('');
    const extension = imageFile.type === 'image/jpeg' ? 'jpg' : imageFile.type === 'image/png' ? 'png' : 'webp';
    const storagePath = `${editing.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('product-media').upload(storagePath, imageFile, { contentType: imageFile.type, upsert: false });
    if (uploadError) {
      console.error('Product image upload failed.', uploadError.message);
      setMessage('The image could not be uploaded. Check the private product-media bucket and try again.');
      setImageBusy(false);
      return;
    }
    const { error: rowError } = await supabase.from('product_media').insert({
      product_id: editing.id,
      storage_path: storagePath,
      alt_text: imageAlt.trim(),
      sort_order: Math.max(-1, ...productImages.map(media => media.sort_order)) + 1
    });
    if (rowError) {
      console.error('Product image metadata could not be saved.', rowError.message);
      await supabase.storage.from('product-media').remove([storagePath]);
      setMessage('The image uploaded but its catalogue record could not be saved. Please try again.');
      setImageBusy(false);
      return;
    }
    setImageFile(null);
    setImageAlt('');
    await loadProductImages(editing.id);
    setImageBusy(false);
  };

  const removeProductImage = async (media: ProductMediaRow) => {
    if (!supabase || !editing || !window.confirm('Remove this product image?')) return;
    setImageBusy(true);
    const { error: rowError } = await supabase.from('product_media').delete().eq('id', media.id).eq('product_id', editing.id);
    if (rowError) {
      console.error('Product image record could not be removed.', rowError.message);
      setMessage('The product image could not be removed.');
      setImageBusy(false);
      return;
    }
    const { error: objectError } = await supabase.storage.from('product-media').remove([media.storage_path]);
    if (objectError) console.error('Orphaned product image storage object could not be removed.', objectError.message);
    await loadProductImages(editing.id);
    setImageBusy(false);
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const asNumberOrNull = (key: string) => String(form.get(key) ?? '').trim() ? Number(form.get(key)) : null;
    const publicationStatus = String(form.get('publicationStatus')) as ProductRow['publication_status'];
    const parsed = adminProductSchema.safeParse({
      name: form.get('name'),
      slug: String(form.get('slug') || slugify(String(form.get('name') ?? ''))),
      description: form.get('description'),
      brand: String(form.get('brand') ?? '').trim() || null,
      categoryId: String(form.get('categoryId') ?? '') || null,
      businessModel: form.get('businessModel'),
      availability: form.get('availability'),
      currency: String(form.get('currency') ?? '').trim().toUpperCase(),
      sourcePrice: asNumberOrNull('sourcePrice'),
      localPrice: asNumberOrNull('localPrice'),
      sourceUrl: String(form.get('sourceUrl') ?? '').trim() || null,
      affiliateUrl: String(form.get('affiliateUrl') ?? '').trim() || null,
      publicationStatus
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Check the product details and try again.');
      return;
    }
    if (publicationStatus === 'published' && form.get('confirmVerified') !== 'on') {
      setMessage('Confirm the source, price, availability and permissions before publishing.');
      return;
    }

    const product = {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      brand: parsed.data.brand,
      category_id: parsed.data.categoryId,
      business_model: parsed.data.businessModel,
      availability: parsed.data.availability,
      currency: parsed.data.currency,
      original_price: parsed.data.sourcePrice,
      local_selling_price: parsed.data.localPrice,
      source_url: parsed.data.sourceUrl,
      affiliate_tracking_url: parsed.data.affiliateUrl,
      publication_status: parsed.data.publicationStatus,
      verified_at: parsed.data.publicationStatus === 'published' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };

    setSaving(true);
    setMessage('');
    const result = editing
      ? await supabase.from('products').update(product).eq('id', editing.id)
      : await supabase.from('products').insert(product);
    setSaving(false);
    if (result.error) {
      console.error('Product could not be saved.', result.error.message);
      setMessage('We could not save the product. Check the slug and publication requirements.');
      return;
    }
    setEditing(null);
    setFormVersion(version => version + 1);
    await loadCatalog();
    setMessage(publicationStatus === 'published' ? 'Product published.' : 'Product saved.');
  };

  const archiveProduct = async (product: ProductRow) => {
    if (!supabase || product.publication_status === 'archived' || !window.confirm(`Archive “${product.name}”? Existing order records will remain intact.`)) return;
    const { error } = await supabase.from('products').update({
      publication_status: 'archived',
      updated_at: new Date().toISOString()
    }).eq('id', product.id);
    if (error) {
      console.error('Product could not be archived.', error.message);
      setMessage('The product could not be archived.');
      return;
    }
    if (editing?.id === product.id) setEditing(null);
    await loadCatalog();
    setMessage('Product archived. Existing order history was preserved.');
  };

  return <section className="admin-queue admin-catalog">
    <div className="section-heading"><div><p className="eyebrow">Admin | catalogue</p><h3>Products</h3></div><button className="text-button" onClick={() => { setEditing(null); setFormVersion(version => version + 1); setMessage(''); }} disabled={saving}>New product</button></div>
    <form key={editing?.id ?? `new-product-${formVersion}`} className="admin-product-form" onSubmit={saveProduct}>
      <h4>{editing ? `Edit ${editing.name}` : 'Create a product'}</h4>
      <label>Product name<input name="name" required minLength={2} maxLength={200} defaultValue={editing?.name ?? ''} onChange={event => { const slug = event.currentTarget.form?.elements.namedItem('slug') as HTMLInputElement | null; if (!editing && slug) slug.value = slugify(event.currentTarget.value); }} /></label>
      <label>Slug<input name="slug" required maxLength={220} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={editing?.slug ?? ''} /></label>
      <label>Description<textarea name="description" maxLength={5000} defaultValue={editing?.description ?? ''} /></label>
      <div className="quote-cost-grid"><label>Brand<input name="brand" maxLength={120} defaultValue={editing?.brand ?? ''} /></label><label>Category<select name="categoryId" defaultValue={editing?.category_id ?? ''}><option value="">Uncategorized</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label></div>
      <div className="quote-cost-grid"><label>Business model<select name="businessModel" defaultValue={editing?.business_model ?? 'resale'}><option value="resale">Resale</option><option value="affiliate">Affiliate</option><option value="sourcing">Sourcing</option></select></label><label>Availability<select name="availability" defaultValue={editing?.availability ?? 'local_inventory'}><option value="local_inventory">Local inventory</option><option value="pre_order">Pre-order</option><option value="affiliate">Affiliate</option><option value="sourcing_only">Sourcing only</option></select></label><label>Currency<input name="currency" required minLength={3} maxLength={3} defaultValue={editing?.currency ?? 'KES'} /></label></div>
      <div className="quote-cost-grid"><label>Source price (optional)<input name="sourcePrice" type="number" min="0.01" max="100000000" step="0.01" defaultValue={editing?.original_price ?? ''} /></label><label>Local selling price (optional)<input name="localPrice" type="number" min="0.01" max="100000000" step="0.01" defaultValue={editing?.local_selling_price ?? ''} /></label></div>
      <label>Source URL<input name="sourceUrl" type="url" maxLength={2000} defaultValue={editing?.source_url ?? ''} /></label>
      <label>Approved affiliate tracking URL<input name="affiliateUrl" type="url" maxLength={2000} defaultValue={editing?.affiliate_tracking_url ?? ''} /></label>
      <label>Publication status<select name="publicationStatus" defaultValue={editing?.publication_status ?? 'draft'}><option value="draft">Draft</option><option value="review">Review</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
      <label className="product-publish-confirm"><input name="confirmVerified" type="checkbox" /> I verified the source, price, availability, disclosure and supplier/program permissions.</label>
      {message && <p className="form-message" role="status">{message}</p>}
      <div className="hero-actions"><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save product' : 'Create product'}</button>{editing && <button className="text-button" type="button" onClick={() => { setEditing(null); setFormVersion(version => version + 1); }}>Cancel edit</button>}</div>
    </form>
    {editing && <><section className="product-media-manager"><h4>Variants and options</h4><p className="account-empty">Add available sizes, colours or other options with optional attributes and price override.</p>{variants.map(variant => <article className="admin-request" key={variant.id}><div className="account-card-heading"><strong>{variant.name}</strong><span>{variant.available ? 'Available' : 'Unavailable'}</span></div><p>{Object.entries(variant.attributes).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}{variant.price !== null && ` · ${editing.currency} ${Number(variant.price).toLocaleString()}`}</p><button className="text-button" type="button" onClick={() => void removeVariant(variant)}>Remove variant</button></article>)}<form onSubmit={saveVariant}><label>Variant name<input name="variantName" required maxLength={120} placeholder="Medium · Blue" /></label><div className="quote-cost-grid"><label>SKU (optional)<input name="variantSku" maxLength={120} /></label><label>Override price (optional)<input name="variantPrice" type="number" min="0.01" max="100000000" step="0.01" /></label></div><label>Attributes (JSON object)<input name="attributes" defaultValue="{}" maxLength={1000} /></label><label><input name="variantAvailable" type="checkbox" defaultChecked /> Available to customers</label>{variantMessage && <p className="form-message" role="status">{variantMessage}</p>}<button className="button button-dark" type="submit">Add variant</button></form></section><section className="product-media-manager"><h4>Product images</h4><p className="account-empty">The bucket is private; customers see images only on published products through short-lived links.</p><div className="product-media-grid">{productImages.map(media => <article key={media.id}>{media.signedUrl ? <img src={media.signedUrl} alt={media.alt_text} /> : <p>Image preview unavailable</p>}<small>{media.alt_text}</small><button className="text-button" type="button" disabled={imageBusy} onClick={() => void removeProductImage(media)}>Remove image</button></article>)}</div><label>Image (JPG, PNG or WebP, up to 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setImageFile(event.currentTarget.files?.[0] ?? null)} /></label><label>Alternative text<input value={imageAlt} maxLength={300} onChange={event => setImageAlt(event.target.value)} placeholder="Describe the product image" /></label><button className="button button-dark" type="button" disabled={imageBusy || !imageFile} onClick={() => void uploadProductImage()}>{imageBusy ? 'Uploading...' : 'Upload image'}</button></section></>}
    <section className="admin-product-list"><h4>Categories</h4><form onSubmit={saveCategory}><label>Category name<input name="categoryName" required minLength={2} maxLength={120} /></label><label>URL slug<input name="categorySlug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} /></label><label>Description<textarea name="categoryDescription" maxLength={500} /></label><label>Category image HTTPS URL (optional)<input name="categoryImageUrl" type="url" pattern="https://.+" maxLength={2000} /></label><label><input name="categoryPublished" type="checkbox" /> Publish category</label><button className="button button-dark" type="submit">Add category</button></form>{categories.map(category => <article className="admin-request" key={category.id}><div className="account-card-heading"><strong>{category.name}</strong><span>{category.published ? "Published" : "Draft"}</span></div><p>/{category.slug}{category.description ? ` | ${category.description}` : ""}</p><label>Category image HTTPS URL<input type="url" pattern="https://.+" maxLength={2000} defaultValue={category.image_url ?? ''} onBlur={event => void setCategoryImage(category, event.currentTarget.value)} /></label><button className="text-button" type="button" onClick={() => void setCategoryPublished(category)}>{category.published ? "Unpublish" : "Publish"}</button></article>)}</section><div className="admin-product-list"><h4>Catalogue</h4><button className="text-button" onClick={() => void loadCatalog()} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
      {loading ? <p role="status">Loading products...</p> : products.length === 0 ? <p className="account-empty">No products have been entered.</p> : products.map(product => <article className="admin-request" key={product.id}><div className="account-card-heading"><strong>{product.name}</strong><span>{product.publication_status}</span></div><p>{product.business_model} | {product.availability} | {product.currency} {product.local_selling_price ?? '—'}</p><button className="text-button" onClick={() => { setEditing(product); setMessage(''); }}>Edit</button>{product.publication_status !== 'archived' && <button className="text-button" type="button" onClick={() => void archiveProduct(product)}>Archive</button>}</article>)}
    </div>
  </section>;
}

export default AdminProductCatalog;



