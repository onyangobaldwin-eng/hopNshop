import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Collection { id: string; name: string; slug: string; description: string | null; image_url: string | null; published: boolean; }
interface ProductChoice { id: string; name: string; publication_status: string; }
interface Member { collection_id: string; product_id: string; product?: ProductChoice; }

function AdminCollectionManager() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [products, setProducts] = useState<ProductChoice[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    const [collectionResult, productResult, memberResult] = await Promise.all([
      supabase.from('collections').select('id,name,slug,description,image_url,published').order('name'),
      supabase.from('products').select('id,name,publication_status').order('name'),
      supabase.from('collection_products').select('collection_id,product_id')
    ]);
    if (collectionResult.error || productResult.error || memberResult.error) {
      console.error('Collection data could not be loaded.', collectionResult.error?.message ?? productResult.error?.message ?? memberResult.error?.message);
      setMessage('Collection data could not be loaded. Apply the collection migration and check staff access.');
      return;
    }
    const productRows = (productResult.data ?? []) as ProductChoice[];
    setCollections((collectionResult.data ?? []) as Collection[]);
    setProducts(productRows);
    setMembers((memberResult.data ?? []).map(row => ({ ...row, product: productRows.find(product => product.id === row.product_id) })) as Member[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') ?? '').trim();
    const slug = String(form.get('slug') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const imageUrl = String(form.get('imageUrl') ?? '').trim();
    if (name.length < 2 || name.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || description.length > 1000 || (imageUrl && !/^https:\/\//i.test(imageUrl))) {
      setMessage('Check the collection name, lower-case slug, description and optional HTTPS image URL.');
      return;
    }
    const { error } = await supabase.from('collections').insert({ name, slug, description: description || null, image_url: imageUrl || null, published: false });
    if (error) { console.error('Collection could not be created.', error.message); setMessage('Collection could not be created. Check that its slug is unique.'); return; }
    formElement.reset();
    setMessage('Collection saved as a draft. Add products before publishing.');
    await load();
  };

  const update = async (collection: Collection, patch: Partial<Collection>) => {
    if (!supabase) return;
    const { error } = await supabase.from('collections').update(patch).eq('id', collection.id);
    if (error) { console.error('Collection could not be updated.', error.message); setMessage('Collection could not be updated.'); return; }
    await load();
  };

  const addProduct = async (collection: Collection, productId: string) => {
    if (!supabase || !productId || members.some(member => member.collection_id === collection.id && member.product_id === productId)) return;
    const { error } = await supabase.from('collection_products').insert({ collection_id: collection.id, product_id: productId, sort_order: members.filter(member => member.collection_id === collection.id).length });
    if (error) { console.error('Product could not be added to collection.', error.message); setMessage('Product could not be added to this collection. Apply the latest collection migration.'); return; }
    await load();
  };

  const removeProduct = async (collectionId: string, productId: string) => {
    if (!supabase) return;
    const { error } = await supabase.from('collection_products').delete().eq('collection_id', collectionId).eq('product_id', productId);
    if (error) { console.error('Product could not be removed from collection.', error.message); setMessage('Product could not be removed from this collection.'); return; }
    await load();
  };

  return <section className="admin-product-list"><h4>Curated collections</h4>
    <form onSubmit={create}><label>Collection name<input name="name" required minLength={2} maxLength={120} /></label><label>URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} /></label><label>Description<textarea name="description" maxLength={1000} /></label><label>Cover image HTTPS URL (optional)<input name="imageUrl" type="url" maxLength={2000} /></label><button className="button button-dark" type="submit">Create draft collection</button></form>
    {message && <p className="form-message" role="status">{message}</p>}
    {collections.map(collection => { const collectionMembers = members.filter(member => member.collection_id === collection.id); const available = products.filter(product => !collectionMembers.some(member => member.product_id === product.id)); return <article className="admin-request" key={collection.id}><div className="account-card-heading"><strong>{collection.name}</strong><span>{collection.published ? 'Published' : 'Draft'}</span></div><p>/{collection.slug}{collection.description ? ` | ${collection.description}` : ''}</p><label>Edit description<textarea maxLength={1000} defaultValue={collection.description ?? ''} onBlur={event => { const value = event.currentTarget.value.trim() || null; if (value !== collection.description) void update(collection, { description: value }); }} /></label><label>Add product<select value="" onChange={event => void addProduct(collection, event.target.value)}><option value="">Choose a product</option>{available.map(product => <option key={product.id} value={product.id}>{product.name} ({product.publication_status})</option>)}</select></label>{collectionMembers.map(member => <p key={member.product_id}>{member.product?.name ?? member.product_id} <button type="button" className="text-button" onClick={() => void removeProduct(collection.id, member.product_id)}>Remove</button></p>)}<button type="button" className="text-button" onClick={() => void update(collection, { published: !collection.published })}>{collection.published ? 'Unpublish' : 'Publish'}</button></article>; })}
  </section>;
}

export default AdminCollectionManager;
