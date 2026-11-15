import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { IonApp, IonContent, IonIcon, IonPage } from '@ionic/react';
import { bagHandleOutline, heart, heartOutline, menuOutline, searchOutline, shieldCheckmarkOutline, sparklesOutline, arrowForwardOutline } from 'ionicons/icons';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { canPurchaseResaleProduct, filterProducts, isValidPublicProductUrl, resaleOrderSchema, sourcingReferenceImageSchema, sourcingRequestSchema, type BusinessModel, type Product, type ProductAvailability, type ProductVariant } from './lib/domain';
import CustomerAccount from './components/CustomerAccount';

const nav = ['Discover', 'Source a product'];
const modelLabels: Record<BusinessModel, string> = {
  affiliate: 'Affiliate find',
  resale: 'hopNshop sale',
  sourcing: 'Personal sourcing'
};

interface ProductRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  brand: string | null;
  availability: ProductAvailability;
  business_model: BusinessModel;
  category: { name: string } | { name: string }[] | null;
  currency: string;
  local_selling_price: number | string | null;
  estimated_shipping: number | string | null;
  estimated_duties: number | string | null;
  source_url: string | null;
  affiliate_tracking_url: string | null;
  verified_at: string | null;
  created_at: string;
  product_media: { storage_path: string; sort_order: number }[];
  product_variants: ProductVariant[];
}

interface CollectionRecord { id: string; name: string; description: string | null; collection_products: { sort_order: number; product: { id: string } | { id: string }[] | null }[]; }
interface DiscoveryCollection { id: string; name: string; description?: string; products: Product[]; }

interface CartLine {
  product: Product;
  quantity: number;
  variant?: ProductVariant;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<ProductAvailability | ''>('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'name'>('newest');
  const [visibleCount, setVisibleCount] = useState(12);
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<DiscoveryCollection[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState(false);
  const [sourcingOpen, setSourcingOpen] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [productName, setProductName] = useState('');
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [variant, setVariant] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceMessage, setSourceMessage] = useState('');
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [sourceSubmitted, setSourceSubmitted] = useState(false);
  const [userId, setUserId] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState<'sign_in' | 'sign_up' | 'forgot_password' | 'recovery'>('sign_in');
  const [authPassword, setAuthPassword] = useState('');
  const [wishlistProductIds, setWishlistProductIds] = useState<string[]>([]);
  const [wishlistBusyId, setWishlistBusyId] = useState('');
  const [wishlistMessage, setWishlistMessage] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartMessage, setCartMessage] = useState('');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [delivery, setDelivery] = useState({ recipientName: '', phone: '', addressLine: '', city: '', county: '' });
  const filtered = useMemo(() => filterProducts(products, {
    search,
    category: categoryFilter,
    brand: brandFilter,
    availability: availabilityFilter,
    currency: currencyFilter,
    minimumPrice: minimumPrice ? Number(minimumPrice) : undefined,
    maximumPrice: maximumPrice ? Number(maximumPrice) : undefined,
    sortBy
  }), [products, search, categoryFilter, brandFilter, availabilityFilter, currencyFilter, minimumPrice, maximumPrice, sortBy]);
  const categories = useMemo(() => Array.from(new Set(products.map(product => product.category).filter((value): value is string => Boolean(value)))).sort(), [products]);
  const brands = useMemo(() => Array.from(new Set(products.map(product => product.brand).filter((value): value is string => Boolean(value)))).sort(), [products]);
  const currencies = useMemo(() => Array.from(new Set(products.map(product => product.currency.toUpperCase()))).sort(), [products]);
  const visibleProducts = filtered.slice(0, visibleCount);

  useEffect(() => {
    document.title = search ? `Search · ${search} · hopNshop` : 'hopNshop — curated, sourced, yours';
  }, [search]);

  useEffect(() => {
    setVisibleCount(12);
  }, [search, categoryFilter, brandFilter, availabilityFilter, currencyFilter, minimumPrice, maximumPrice, sortBy]);

  useEffect(() => {
    if (!supabase || !userId) {
      setWishlistProductIds([]);
      return;
    }
    let active = true;
    void supabase.from('wishlists').select('wishlist_items(product_id)').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error('Wishlist could not be loaded.', error.message);
          return;
        }
        const wishlist = data as { wishlist_items: { product_id: string }[] } | null;
        setWishlistProductIds((wishlist?.wishlist_items ?? []).map(item => item.product_id));
      });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setProductsLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (active) {
        setCustomerEmail(session?.user.email ?? '');
        setUserId(session?.user.id ?? '');
        if (event === 'PASSWORD_RECOVERY') {
          setAuthMode('recovery');
          setAuthMessage('Choose a new password for your account.');
          setAuthOpen(true);
        } else if (session) setAuthOpen(false);
      }
    });

    const loadProducts = async () => {
      const { data, error } = await client
        .from('products')
        .select('id,name,slug,description,brand,availability,business_model,category:categories(name),currency,local_selling_price,estimated_shipping,estimated_duties,source_url,affiliate_tracking_url,verified_at,created_at,product_media(storage_path,sort_order),product_variants(id,name,sku,attributes,price,available)')
        .eq('publication_status', 'published')
        .order('created_at', { ascending: false });

      if (!active) return;
      if (error) {
        console.error('Published catalogue could not be loaded.', error.message);
        setCatalogueError(true);
        setProductsLoading(false);
        return;
      }

      const records = (data ?? []) as ProductRecord[];
      const mappedProducts = await Promise.all(records.map(async record => {
        const price = record.local_selling_price === null ? undefined : Number(record.local_selling_price);
        const imageUrls = (await Promise.all((record.product_media ?? []).sort((left, right) => left.sort_order - right.sort_order).map(async media => {
          const { data: signed, error: imageError } = await client.storage.from('product-media').createSignedUrl(media.storage_path, 3600);
          if (imageError) {
            console.error('A published product image could not be loaded.', imageError.message);
            return '';
          }
          return signed.signedUrl;
        }))).filter(Boolean);
        return {
          id: record.id,
          name: record.name,
          slug: record.slug,
          description: record.description,
          brand: record.brand ?? undefined,
          category: Array.isArray(record.category) ? record.category[0]?.name : record.category?.name,
          availability: record.availability,
          businessModel: record.business_model,
          currency: record.currency,
          localPrice: price !== undefined && Number.isFinite(price) ? price : undefined,
          imageUrl: imageUrls[0],
          imageUrls,
          variants: (record.product_variants ?? []).filter(variant => variant.available),
          estimatedShipping: record.estimated_shipping === null ? undefined : Number(record.estimated_shipping),
          estimatedDuties: record.estimated_duties === null ? undefined : Number(record.estimated_duties),
          sourceUrl: record.source_url ?? undefined,
          affiliateTrackingUrl: record.affiliate_tracking_url ?? undefined,
          verifiedAt: record.verified_at ?? undefined,
          publishedAt: record.created_at
        };
      }));
      if (!active) return;
      setProducts(mappedProducts);
      const { data: collectionData, error: collectionError } = await client.from('collections')
        .select('id,name,description,collection_products(sort_order,product:products(id))')
        .eq('published', true).order('name');
      if (!active) return;
      if (collectionError) console.error('Published collections could not be loaded.', collectionError.message);
      else {
        const byId = new Map(mappedProducts.map(product => [product.id, product]));
        setCollections(((collectionData ?? []) as CollectionRecord[]).map(collection => ({
          id: collection.id,
          name: collection.name,
          description: collection.description ?? undefined,
          products: collection.collection_products.sort((a, b) => a.sort_order - b.sort_order)
            .flatMap(item => {
              const id = Array.isArray(item.product) ? item.product[0]?.id : item.product?.id;
              const product = id ? byId.get(id) : undefined;
              return product ? [product] : [];
            })
        })).filter(collection => collection.products.length > 0));
      }
      setProductsLoading(false);
    };

    void loadProducts();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const openSourcingDesk = () => {
    setSourceMessage('');
    setSourceSubmitted(false);
    setSourcingOpen(true);
  };

  const sendSignInLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthMessage('Account services are not configured yet.');
      return;
    }
    setAuthSubmitting(true);
    setAuthMessage('');
    const { error } = await supabase.auth.signInWithOtp({
      email: customerEmail.trim(),
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) {
      console.error('Could not send the customer sign-in link.', error.message);
      setAuthMessage('We could not send a sign-in link. Check your email address and try again.');
    } else {
      setAuthMessage('Check your email for a secure sign-in link, then return here to continue.');
    }
    setAuthSubmitting(false);
  };

  const submitPasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthMessage('Account services are not configured yet.');
      return;
    }
    setAuthSubmitting(true);
    setAuthMessage('');
    const result = authMode === 'sign_up'
      ? await supabase.auth.signUp({ email: customerEmail.trim(), password: authPassword })
      : await supabase.auth.signInWithPassword({ email: customerEmail.trim(), password: authPassword });
    if (result.error) {
      console.error('Password authentication failed.', result.error.message);
      setAuthMessage(authMode === 'sign_up'
        ? 'We could not create your account. Check your details and try again.'
        : 'We could not sign you in. Check your email and password and try again.');
    } else if (authMode === 'sign_up' && !result.data.session) {
      setAuthMessage('Check your email to confirm your account, then sign in.');
    } else if (authMode === 'sign_up') {
      setAuthMessage('Your account is ready.');
    }
    setAuthSubmitting(false);
  };

  const sendPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setAuthMessage('Account services are not configured yet.');
      return;
    }
    setAuthSubmitting(true);
    setAuthMessage('');
    const { error } = await supabase.auth.resetPasswordForEmail(customerEmail.trim(), {
      redirectTo: window.location.origin
    });
    if (error) {
      console.error('Password reset email could not be sent.', error.message);
      setAuthMessage('We could not send a reset link. Check your email address and try again.');
    } else {
      setAuthMessage('If an account exists for that email, a password reset link is on its way.');
    }
    setAuthSubmitting(false);
  };

  const saveNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage('');
    const { error } = await supabase.auth.updateUser({ password: authPassword });
    if (error) {
      console.error('The account password could not be updated.', error.message);
      setAuthMessage('We could not update your password. Request a new reset link and try again.');
    } else {
      setAuthMessage('Your password has been updated.');
      setAuthMode('sign_in');
      setAuthPassword('');
    }
    setAuthSubmitting(false);
  };

  const addToCart = (product: Product, variant?: ProductVariant) => {
    if (!canPurchaseResaleProduct(product)) return;
    setCartMessage('');
    if (cart[0] && cart[0].product.currency !== product.currency) {
      setCartMessage('Products in different currencies need separate orders.');
      setCartOpen(true);
      return;
    }
    const existing = cart.find(line => line.product.id === product.id && line.variant?.id === variant?.id);
    if (existing) setCart(cart.map(line => line.product.id === product.id && line.variant?.id === variant?.id ? { ...line, quantity: Math.min(100, line.quantity + 1) } : line));
    else setCart([...cart, { product, variant, quantity: 1 }]);
    setCartOpen(true);
  };

  const toggleWishlist = async (product: Product) => {
    if (!supabase || !userId) {
      setAuthOpen(true);
      return;
    }
    if (wishlistBusyId) return;
    setWishlistMessage('');
    setWishlistBusyId(product.id);
    let wishlistId: string | null = null;
    const { data: existingWishlist, error: lookupError } = await supabase
      .from('wishlists').select('id').eq('user_id', userId).maybeSingle();
    if (lookupError) {
      console.error('Wishlist could not be checked.', lookupError.message);
      setWishlistMessage('We could not update your wishlist. Please try again.');
      setWishlistBusyId('');
      return;
    }
    wishlistId = existingWishlist?.id ?? null;
    if (!wishlistId) {
      const { data, error } = await supabase.from('wishlists').upsert({ user_id: userId }, { onConflict: 'user_id' }).select('id').single();
      if (error) {
        console.error('Wishlist could not be created.', error.message);
        setWishlistMessage('We could not update your wishlist. Please try again.');
        setWishlistBusyId('');
        return;
      }
      wishlistId = data.id;
    }
    if (wishlistProductIds.includes(product.id)) {
      const { error } = await supabase.from('wishlist_items').delete().eq('wishlist_id', wishlistId).eq('product_id', product.id);
      if (error) {
        console.error('Product could not be removed from the wishlist.', error.message);
        setWishlistMessage('We could not update your wishlist. Please try again.');
      }
      else setWishlistProductIds(ids => ids.filter(id => id !== product.id));
    } else {
      const { error } = await supabase.from('wishlist_items').insert({ wishlist_id: wishlistId, product_id: product.id });
      if (error) {
        console.error('Product could not be saved to the wishlist.', error.message);
        setWishlistMessage('We could not update your wishlist. Please try again.');
      }
      else setWishlistProductIds(ids => [...ids, product.id]);
    }
    setWishlistBusyId('');
  };

  const placeResaleOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCartMessage('');
    const input = {
      items: cart.map(line => ({ productId: line.product.id, variantId: line.variant?.id, quantity: line.quantity })),
      ...delivery,
      county: delivery.county.trim() || undefined
    };
    const parsed = resaleOrderSchema.safeParse(input);
    if (!parsed.success) {
      setCartMessage('Check your delivery details and product quantities.');
      return;
    }
    if (!supabase || !userId) {
      setCartMessage('Sign in before placing your order.');
      setAuthOpen(true);
      return;
    }

    setCheckoutSubmitting(true);
    const { error } = await supabase.rpc('create_resale_order', {
      p_items: parsed.data.items.map(item => ({ product_id: item.productId, variant_id: item.variantId, quantity: item.quantity })),
      p_recipient_name: parsed.data.recipientName,
      p_phone: parsed.data.phone,
      p_address_line: parsed.data.addressLine,
      p_city: parsed.data.city,
      p_county: parsed.data.county ?? null
    });
    setCheckoutSubmitting(false);
    if (error) {
      console.error('Resale order could not be created.', error.message);
      setCartMessage('We could not place this order. A product may have changed; refresh the catalogue and try again.');
      return;
    }
    setCart([]);
    setCartOpen(false);
    setDelivery({ recipientName: '', phone: '', addressLine: '', city: '', county: '' });
    setAccountOpen(true);
  };

  const submitSourcingRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSourceMessage('');

    const parsed = sourcingRequestSchema.safeParse({
      productUrl,
      productName: productName.trim() || undefined,
      quantity: Number(quantity),
      variant: variant.trim() || undefined,
      notes: notes.trim() || undefined
    });
    if (!parsed.success || !isValidPublicProductUrl(productUrl)) {
      setSourceMessage('Enter a public HTTPS product link and a quantity between 1 and 100.');
      return;
    }
    if (referenceImage && !sourcingReferenceImageSchema.safeParse(referenceImage).success) {
      setSourceMessage('Choose a JPG, PNG or WebP reference image up to 5 MB.');
      return;
    }
    if (!supabase) {
      setSourceMessage('Secure request submission is not configured yet. Please try again later.');
      return;
    }

    setSourceSubmitting(true);
    let requestStored = false;
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        console.error('Could not check the customer session.', sessionError.message);
        setSourceMessage('We could not verify your sign-in. Please try again.');
        return;
      }

      if (!session) {
        const { error } = await supabase.auth.signInWithOtp({
          email: customerEmail.trim(),
          options: { emailRedirectTo: window.location.origin }
        });
        if (error) {
          console.error('Could not send the customer sign-in link.', error.message);
          setSourceMessage('We could not send a sign-in link. Check your email address and try again.');
          return;
        }
        setSourceMessage('Check your email for a secure sign-in link. Open it in this browser, then submit your request again.');
        return;
      }

      const { data: requestData, error } = await supabase.from('sourcing_requests').insert({
        user_id: session.user.id,
        product_url: parsed.data.productUrl,
        product_name: parsed.data.productName ?? null,
        quantity: parsed.data.quantity,
        variant: parsed.data.variant ?? null,
        notes: parsed.data.notes ?? null
      }).select('id').single();
      if (error) {
        console.error('The sourcing request could not be saved.', error.message);
        setSourceMessage('We could not save your request. Please try again.');
        return;
      }

      requestStored = true;
      setSourceSubmitted(true);
      if (referenceImage) {
        const extension = referenceImage.type === 'image/jpeg' ? 'jpg' : referenceImage.type === 'image/png' ? 'png' : 'webp';
        const storagePath = `${session.user.id}/${requestData.id}/${crypto.randomUUID()}.${extension}`;
        try {
          const { error: uploadError } = await supabase.storage.from('sourcing-request-media').upload(storagePath, referenceImage, {
            contentType: referenceImage.type,
            cacheControl: '3600',
            upsert: false
          });
          if (uploadError) throw uploadError;
          const { error: mediaError } = await supabase.from('sourcing_request_media').insert({ request_id: requestData.id, storage_path: storagePath });
          if (mediaError) {
            await supabase.storage.from('sourcing-request-media').remove([storagePath]);
            throw mediaError;
          }
          setSourceMessage('Your request and reference image were submitted securely. Our team will review the source before preparing a quotation.');
        } catch (error) {
          console.error('The sourcing request was saved but its reference image could not be attached.', error);
          setSourceMessage('Your request was submitted, but the reference image could not be attached. The team can still review your product link.');
        }
      } else {
        setSourceMessage('Your request was submitted securely. Our team will review the source before preparing a quotation.');
      }
      setProductUrl('');
      setProductName('');
      setReferenceImage(null);
      setQuantity('1');
      setVariant('');
      setNotes('');
    } catch (error) {
      console.error('Unexpected sourcing request failure.', error);
      if (requestStored) {
        setSourceSubmitted(true);
        setSourceMessage('Your request was submitted, but we could not attach the reference image. The team can still review your product link.');
      } else {
        setSourceMessage('Something went wrong while submitting your request. Please try again.');
      }
    } finally {
      setSourceSubmitting(false);
    }
  };

  return <IonApp><IonPage><IonContent fullscreen>
    <header className="topbar"><button className="icon-button mobile-only" onClick={() => setMenuOpen(value => !value)} aria-label="Open navigation"><IonIcon icon={menuOutline} /></button><a className="wordmark" href="#top" aria-label="hopNshop home"><span>hop</span><b>N</b><span>shop</span></a><nav className={menuOpen ? 'nav open' : 'nav'}>{nav.map(item => <a href={item === 'Source a product' ? '#source' : '#discover'} key={item} onClick={() => setMenuOpen(false)}>{item}</a>)}</nav><div className="top-actions"><label className="search"><IonIcon icon={searchOutline} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search curated finds" aria-label="Search products" /></label><button className="icon-button" aria-label={userId ? 'Open account' : 'Sign in'} onClick={() => userId ? setAccountOpen(true) : setAuthOpen(true)}>{userId ? 'Account' : 'Sign in'}</button><button className="icon-button" aria-label={`Open bag, ${cart.length} products`} onClick={() => setCartOpen(true)}><IonIcon icon={bagHandleOutline} />{cart.length > 0 && <span className="cart-count">{cart.length}</span>}</button></div></header>
    <main id="top">
      <section className="hero" id="hero"><div className="hero-copy"><p className="eyebrow">Curated commerce · Kenya</p><h1>Find the things<br /><em>worth bringing home.</em></h1><p className="hero-lede">A considered edit of products from trusted sources — plus a human team for the things you cannot find locally.</p><div className="hero-actions"><a className="button button-dark" href="#discover">Explore the edit <IonIcon icon={arrowForwardOutline} /></a><button className="text-button" type="button" onClick={openSourcingDesk}>Need something specific? <u>Ask us to source it</u></button></div></div><div className="hero-art" aria-hidden="true"><img className="hero-art-image" src="/images/hero-reference.jpg" alt="" /></div></section>
      <section className="trust-strip"><div><IonIcon icon={shieldCheckmarkOutline} /><span>Curated with care</span></div><div><IonIcon icon={sparklesOutline} /><span>Transparent sourcing</span></div><div><IonIcon icon={heartOutline} /><span>Made for your life</span></div></section>
      {collections.length > 0 && <section className="section curated-collections"><div className="section-heading"><div><p className="eyebrow">Curated collections</p><h2>Thoughtful <em>little edits.</em></h2></div><p className="muted">A few good things, gathered around an idea.</p></div><div className="collection-grid">{collections.map(collection => <article className="collection-card" key={collection.id}><h3>{collection.name}</h3>{collection.description && <p>{collection.description}</p>}<div className="collection-products">{collection.products.map(product => <button type="button" key={product.id} onClick={() => { setSelectedVariantId(product.variants?.[0]?.id ?? ''); setDetailProduct(product); }}>{product.imageUrl && <img src={product.imageUrl} alt="" />}<span>{product.name}</span></button>)}</div></article>)}</div></section>}
      <section className="section" id="discover"><div className="section-heading"><div><p className="eyebrow">The edit</p><h2>Good things, <em>in season.</em></h2></div><p className="muted">Freshly reviewed finds, approved sources and a little bit of serendipity.</p></div>{wishlistMessage && <p className="form-message" role="alert">{wishlistMessage}</p>}
        <div className="discovery-filters" aria-label="Filter and sort products"><label>Category<select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">All categories</option>{categories.map(category => <option value={category} key={category}>{category}</option>)}</select></label><label>Brand<select value={brandFilter} onChange={event => setBrandFilter(event.target.value)}><option value="">All brands</option>{brands.map(brand => <option value={brand} key={brand}>{brand}</option>)}</select></label><label>Availability<select value={availabilityFilter} onChange={event => setAvailabilityFilter(event.target.value as ProductAvailability | '')}><option value="">All availability</option><option value="local_inventory">Local inventory</option><option value="pre_order">Pre-order</option><option value="affiliate">Affiliate</option><option value="sourcing_only">Sourcing only</option></select></label><label>Currency<select value={currencyFilter} onChange={event => setCurrencyFilter(event.target.value)}><option value="">All currencies</option>{currencies.map(currency => <option value={currency} key={currency}>{currency}</option>)}</select></label><label>Min price<input type="number" min="0" step="1" value={minimumPrice} onChange={event => setMinimumPrice(event.target.value)} /></label><label>Max price<input type="number" min="0" step="1" value={maximumPrice} onChange={event => setMaximumPrice(event.target.value)} /></label><label>Sort<select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option></select></label><button className="text-button" type="button" onClick={() => { setSearch(''); setCategoryFilter(''); setBrandFilter(''); setAvailabilityFilter(''); setCurrencyFilter(''); setMinimumPrice(''); setMaximumPrice(''); setSortBy('newest'); }}>Clear filters</button></div>{(minimumPrice || maximumPrice) && !currencyFilter && <p className="availability-note" role="status">Choose a currency before applying price limits.</p>}{!currencyFilter && currencies.length > 1 && (sortBy === 'price_asc' || sortBy === 'price_desc') && <p className="availability-note" role="status">Prices are grouped by currency; select one currency for a direct price comparison.</p>}
        {productsLoading ? <div className="empty-state" role="status"><p>Loading the latest edit…</p></div>
          : catalogueError ? <div className="empty-state" role="alert"><h3>The shelves are temporarily unavailable.</h3><p>Please try again shortly, or tell us what you are looking for and our team can help.</p><button className="button button-dark" onClick={openSourcingDesk}>Request a product <IonIcon icon={arrowForwardOutline} /></button></div>
          : visibleProducts.length ? <><div className="product-grid">{visibleProducts.map(product => { const saved = wishlistProductIds.includes(product.id); return <article className="product-card" key={product.id}><div className="product-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : '✦'}</div><p className="eyebrow">{product.category ?? modelLabels[product.businessModel]}</p><div className="product-card-heading"><h3>{product.name}</h3><button className="wishlist-toggle" type="button" aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`} aria-pressed={saved} disabled={wishlistBusyId === product.id} onClick={() => void toggleWishlist(product)}><IonIcon icon={saved ? heart : heartOutline} /></button></div><p>{product.description}</p><button className="text-button product-details-link" type="button" onClick={() => { setSelectedVariantId(product.variants?.[0]?.id ?? ''); setDetailProduct(product); }}>Product details</button>{product.localPrice !== undefined && <p className="product-price">{product.currency.toUpperCase()} {product.localPrice.toLocaleString()}</p>}{product.businessModel === 'affiliate' && product.affiliateTrackingUrl && isValidPublicProductUrl(product.affiliateTrackingUrl) && <a className="button button-dark" href={product.affiliateTrackingUrl} target="_blank" rel="noopener noreferrer">Visit retailer <IonIcon icon={arrowForwardOutline} /></a>}{canPurchaseResaleProduct(product) && <button className="button button-dark" onClick={() => product.variants?.length ? (setSelectedVariantId(product.variants[0].id), setDetailProduct(product)) : addToCart(product)}>Add to bag <IonIcon icon={bagHandleOutline} /></button>}{product.businessModel === 'resale' && !canPurchaseResaleProduct(product) && <small className="availability-note">Price or availability needs confirmation.</small>}</article>; })}</div>{visibleCount < filtered.length && <button className="button button-dark load-more" onClick={() => setVisibleCount(count => count + 12)}>Load more products</button>}</>
            : products.length ? <div className="empty-state"><h3>No products match your filters.</h3><p>Clear a filter or ask our sourcing team to find it.</p><button className="button button-dark" onClick={() => { setSearch(''); setCategoryFilter(''); setBrandFilter(''); setAvailabilityFilter(''); setCurrencyFilter(''); setMinimumPrice(''); setMaximumPrice(''); setSortBy('newest'); }}>Clear filters</button></div>
              : <div className="empty-state"><div className="empty-mark">✦</div><h3>The shelves are being set.</h3><p>Our team is reviewing the next edit. In the meantime, tell us what you are looking for and we will help you find it.</p><button className="button button-dark" onClick={openSourcingDesk}>Request a product <IonIcon icon={arrowForwardOutline} /></button></div>}
      </section>
      <section className="source-band" id="source"><div><p className="eyebrow">The sourcing desk</p><h2>Some things are<br /><em>worth the search.</em></h2><p>Send us a product link from a supported marketplace. We will check the source, work out an estimated landed cost and send you a clear quotation before anything is ordered.</p><button className="button button-light" onClick={openSourcingDesk}>Start a sourcing request <IonIcon icon={arrowForwardOutline} /></button></div><div className="source-stamp">SOURCE<br /><b>WITH</b><br />CONFIDENCE</div></section>
      <section className="footer-cta"><p className="eyebrow">Keep in the loop</p><h2>Good finds, <em>occasionally.</em></h2><p>New edits, sourcing notes and useful guides. No noise.</p><p className="checkout-notice">Newsletter signup is not connected yet, so we are not collecting email addresses here.</p><small>{isSupabaseConfigured ? 'Updates will be available when a delivery provider is configured.' : 'Updates need Supabase and an email provider before signup can be enabled.'}</small></section>
    </main>
    {sourcingOpen && <div className="modal-backdrop" role="presentation" onClick={() => setSourcingOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="source-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSourcingOpen(false)} aria-label="Close">×</button><p className="eyebrow">The sourcing desk</p><h2 id="source-title">What are you looking for?</h2><p>Share a link and our team will review it. No payment is taken at this stage.</p><form onSubmit={submitSourcingRequest}><label>Email for secure sign-in<input required type="email" autoComplete="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="you@example.com" /></label><label>Product link<input required type="url" value={productUrl} onChange={event => setProductUrl(event.target.value)} placeholder="https://… product link" /></label><label>Product name, if known<input maxLength={200} value={productName} onChange={event => setProductName(event.target.value)} placeholder="Product or listing name" /></label><label>Reference image (JPG, PNG or WebP, up to 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setReferenceImage(event.currentTarget.files?.[0] ?? null)} /></label>{referenceImage && <small>{referenceImage.name}</small>}<label>Quantity<input required type="number" min="1" max="100" value={quantity} onChange={event => setQuantity(event.target.value)} /></label><label>Size or colour<input maxLength={200} value={variant} onChange={event => setVariant(event.target.value)} placeholder="Variant" /></label><label>Additional product notes<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anything else we should know" /></label>{sourceMessage && <p className={sourceSubmitted ? 'form-message success' : 'form-message'} role="status">{sourceMessage}</p>}<button className="button button-dark" type="submit" disabled={sourceSubmitting || sourceSubmitted}>{sourceSubmitting ? 'Submitting…' : sourceSubmitted ? 'Request submitted' : 'Continue securely'} <IonIcon icon={arrowForwardOutline} /></button></form></div></div>}
    {detailProduct && <div className="modal-backdrop" role="presentation" onClick={() => setDetailProduct(null)}><section className="modal product-detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-detail-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setDetailProduct(null)} aria-label="Close product details">×</button><p className="eyebrow">{modelLabels[detailProduct.businessModel]}</p><h2 id="product-detail-title">{detailProduct.name}</h2>{detailProduct.imageUrls && detailProduct.imageUrls.length > 0 && <div className="product-gallery">{detailProduct.imageUrls.map((url, index) => <img key={url} src={url} alt={`${detailProduct.name}, image ${index + 1}`} />)}</div>}<p>{detailProduct.description}</p>{detailProduct.variants && detailProduct.variants.length > 0 && <label>Choose an option<select value={selectedVariantId} onChange={event => setSelectedVariantId(event.target.value)}>{detailProduct.variants.map(option => <option key={option.id} value={option.id}>{option.name}{option.price !== null && option.price !== undefined ? ` | ${detailProduct.currency} ${Number(option.price).toLocaleString()}` : ''}</option>)}</select></label>}<dl className="product-detail-list"><div><dt>Availability</dt><dd>{detailProduct.availability.replaceAll('_', ' ')}</dd></div>{detailProduct.brand && <div><dt>Brand</dt><dd>{detailProduct.brand}</dd></div>}{detailProduct.category && <div><dt>Category</dt><dd>{detailProduct.category}</dd></div>}{detailProduct.localPrice !== undefined && <div><dt>Current listed price</dt><dd>{detailProduct.currency.toUpperCase()} {detailProduct.localPrice.toLocaleString()}</dd></div>}{detailProduct.estimatedShipping !== undefined && <div><dt>Estimated shipping</dt><dd>{detailProduct.currency.toUpperCase()} {detailProduct.estimatedShipping.toLocaleString()} · estimate</dd></div>}{detailProduct.estimatedDuties !== undefined && <div><dt>Estimated duties</dt><dd>{detailProduct.currency.toUpperCase()} {detailProduct.estimatedDuties.toLocaleString()} · estimate</dd></div>}{detailProduct.verifiedAt && <div><dt>Last source check</dt><dd>{new Date(detailProduct.verifiedAt).toLocaleDateString()}</dd></div>}</dl>{detailProduct.businessModel === 'affiliate' && <p className="checkout-notice">This link takes you to an external retailer. hopNshop does not process its payment, delivery, returns or customer support.</p>}{detailProduct.businessModel === 'resale' && <p className="checkout-notice">The displayed item price is not a payment receipt. Delivery costs and fulfillment details are confirmed separately.</p>}{detailProduct.businessModel === 'sourcing' && <p className="checkout-notice">Sourcing costs are estimates until a reviewed quotation is accepted. No procurement begins before verified payment.</p>}{detailProduct.sourceUrl && isValidPublicProductUrl(detailProduct.sourceUrl) && <p><a href={detailProduct.sourceUrl} target="_blank" rel="noopener noreferrer">View source information</a></p>}{detailProduct.businessModel === 'affiliate' && detailProduct.affiliateTrackingUrl && isValidPublicProductUrl(detailProduct.affiliateTrackingUrl) && <a className="button button-dark" href={detailProduct.affiliateTrackingUrl} target="_blank" rel="noopener noreferrer">Visit retailer <IonIcon icon={arrowForwardOutline} /></a>}{canPurchaseResaleProduct(detailProduct) && <button className="button button-dark" onClick={() => { addToCart(detailProduct, detailProduct.variants?.find(option => option.id === selectedVariantId)); setDetailProduct(null); }}>Add to bag <IonIcon icon={bagHandleOutline} /></button>}</section></div>}
    {authOpen && <div className="modal-backdrop" role="presentation" onClick={() => setAuthOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button><p className="eyebrow">Secure account</p><h2 id="signin-title">{authMode === 'sign_up' ? 'Create your account.' : authMode === 'forgot_password' ? 'Reset your password.' : authMode === 'recovery' ? 'Choose a new password.' : 'Your account, your orders.'}</h2><p>{authMode === 'forgot_password' ? 'We will email a secure reset link if an account exists for that address.' : authMode === 'recovery' ? 'Use at least 8 characters for your new password.' : 'Use your email and password, or get a secure one-time sign-in link.'}</p>
      {authMode === 'forgot_password' ? <form onSubmit={sendPasswordReset}><label>Email address<input required type="email" autoComplete="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="you@example.com" /></label>{authMessage && <p className="form-message" role="status">{authMessage}</p>}<button className="button button-dark" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Sending…' : 'Send reset link'}</button></form>
        : authMode === 'recovery' ? <form onSubmit={saveNewPassword}><label>New password<input required type="password" minLength={8} autoComplete="new-password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} /></label>{authMessage && <p className="form-message" role="status">{authMessage}</p>}<button className="button button-dark" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Updating…' : 'Update password'}</button></form>
          : <><form onSubmit={submitPasswordAuth}><label>Email address<input required type="email" autoComplete="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="you@example.com" /></label><label>Password<input required type="password" minLength={8} autoComplete={authMode === 'sign_up' ? 'new-password' : 'current-password'} value={authPassword} onChange={event => setAuthPassword(event.target.value)} /></label>{authMessage && <p className="form-message" role="status">{authMessage}</p>}<button className="button button-dark" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Please wait…' : authMode === 'sign_up' ? 'Create account' : 'Sign in'}</button></form><button className="text-button" onClick={() => { setAuthMode(authMode === 'sign_up' ? 'sign_in' : 'sign_up'); setAuthMessage(''); }}>{authMode === 'sign_up' ? 'Already have an account? Sign in' : 'New to hopNshop? Create an account'}</button>{authMode === 'sign_in' && <><button className="text-button" onClick={() => { setAuthMode('forgot_password'); setAuthMessage(''); }}>Forgot password?</button><form onSubmit={sendSignInLink}><label>Email address<input required type="email" autoComplete="email" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="you@example.com" /></label><button className="text-button" type="submit" disabled={authSubmitting}>{authSubmitting ? 'Sending…' : 'Email me a one-time sign-in link'}</button></form></>}</>}
    </div></div>}
    {cartOpen && <div className="modal-backdrop" role="presentation" onClick={() => setCartOpen(false)}><div className="modal cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setCartOpen(false)} aria-label="Close">×</button><p className="eyebrow">Resale order</p><h2 id="cart-title">Your bag</h2>{cart.length === 0 ? <div className="empty-state"><p>Your bag is empty. Affiliate purchases happen with the retailer and are not added to hopNshop orders.</p><button className="button button-dark" onClick={() => setCartOpen(false)}>Continue browsing</button></div> : <><div className="cart-items">{cart.map(line => <article className="cart-item" key={`${line.product.id}-${line.variant?.id ?? "base"}`}><div><strong>{line.product.name}{line.variant ? ` | ${line.variant.name}` : ''}</strong><p>{line.product.currency.toUpperCase()} {(line.variant?.price ?? line.product.localPrice)?.toLocaleString()}</p></div><label>Qty<input type="number" min="1" max="100" value={line.quantity} onChange={event => { const next = Number(event.target.value); setCart(current => current.map(item => item.product.id === line.product.id && item.variant?.id === line.variant?.id ? { ...item, quantity: next } : item)); }} /></label><button className="text-button" onClick={() => setCart(current => current.filter(item => item.product.id !== line.product.id || item.variant?.id !== line.variant?.id))}>Remove</button></article>)}</div><p className="cart-total">Items total <strong>{cart[0]?.product.currency.toUpperCase()} {cart.reduce((sum, line) => sum + (line.variant?.price ?? line.product.localPrice ?? 0) * line.quantity, 0).toLocaleString()}</strong></p><p className="checkout-notice">Delivery charges are not included. Order creation does not take payment; payment initiation is not enabled. Do not send money until verified payment instructions are available.</p>{!userId && <button className="button button-dark" onClick={() => setAuthOpen(true)}>Sign in to place this order</button>}<form onSubmit={placeResaleOrder}><h3>Delivery details</h3><label>Recipient name<input required minLength={2} maxLength={120} value={delivery.recipientName} onChange={event => setDelivery(current => ({ ...current, recipientName: event.target.value }))} /></label><label>Phone<input required type="tel" minLength={8} maxLength={24} pattern="[0-9+() -]{8,24}" value={delivery.phone} onChange={event => setDelivery(current => ({ ...current, phone: event.target.value }))} /></label><label>Address<input required minLength={5} maxLength={300} value={delivery.addressLine} onChange={event => setDelivery(current => ({ ...current, addressLine: event.target.value }))} /></label><label>Town / city<input required minLength={2} maxLength={100} value={delivery.city} onChange={event => setDelivery(current => ({ ...current, city: event.target.value }))} /></label><label>County (optional)<input maxLength={100} value={delivery.county} onChange={event => setDelivery(current => ({ ...current, county: event.target.value }))} /></label>{cartMessage && <p className="form-message" role="alert">{cartMessage}</p>}<button className="button button-dark" type="submit" disabled={checkoutSubmitting || !userId}>{checkoutSubmitting ? 'Creating order…' : 'Create order · payment pending'}</button></form></>}</div></div>}
    {accountOpen && userId && <CustomerAccount userId={userId} email={customerEmail} onClose={() => setAccountOpen(false)} onSignOut={async () => { if (!supabase) return; const { error } = await supabase.auth.signOut(); if (error) console.error('Sign out failed.', error.message); setAccountOpen(false); }} />}
    <footer><span className="wordmark"><span>hop</span><b>N</b><span>shop</span></span><span>© {new Date().getFullYear()} hopNshop</span><span>Affiliate disclosure · Privacy · Terms</span></footer>
  </IonContent></IonPage></IonApp>;
}

export default App;





