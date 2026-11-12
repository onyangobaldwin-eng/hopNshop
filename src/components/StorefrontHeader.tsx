import { IonIcon } from '@ionic/react';
import { bagHandleOutline, chevronDownOutline, heartOutline, homeOutline, gridOutline, notificationsOutline, personOutline, searchOutline } from 'ionicons/icons';

interface StorefrontHeaderProps {
  categories: string[];
  categoryFilter: string;
  search: string;
  searchSuggestions: string[];
  wishlistCount: number;
  cartCount: number;
  signedIn: boolean;
  onCategoryChange: (category: string) => void;
  onSearchChange: (search: string) => void;
  onWishlist: () => void;
  onNotifications: () => void;
  onAccount: () => void;
  onCart: () => void;
}

function StorefrontHeader({
  categories,
  categoryFilter,
  search,
  searchSuggestions,
  wishlistCount,
  cartCount,
  signedIn,
  onCategoryChange,
  onSearchChange,
  onWishlist,
  onNotifications,
  onAccount,
  onCart
}: StorefrontHeaderProps) {
  const chooseCategory = (category: string) => {
    onCategoryChange(category);
    document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' });
  };

  const categoryLinks = categories.slice(0, 5);
  const moreCategories = categories.slice(5);

  return <>
    <header className="storefront-header">
      <div className="header-main">
        <a className="brand-lockup" href="#top" aria-label="hopNshop home">
          <span className="brand-mark"><IonIcon icon={bagHandleOutline} /></span>
          <span className="brand-copy"><strong>hop<span>N</span>shop</strong><small>Shop Smart. Live Better.</small></span>
        </a>
        <label className="store-search">
          <IonIcon icon={searchOutline} aria-hidden="true" />
          <input value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Search for products…" aria-label="Search products" list="product-search-suggestions" autoComplete="off" />
          <datalist id="product-search-suggestions">{searchSuggestions.map(suggestion => <option value={suggestion} key={suggestion} />)}</datalist>
        </label>
        <div className="header-actions">
          <button className="header-action header-account" type="button" onClick={onAccount} aria-label={signedIn ? 'Open account' : 'Sign in'}>
            <IonIcon icon={personOutline} /><span>{signedIn ? 'Account' : 'Sign in'}</span>
          </button>
          <button className="header-action" type="button" onClick={onWishlist} aria-label={`Open wishlist, ${wishlistCount} saved products`}>
            <IonIcon icon={heartOutline} />{wishlistCount > 0 && <span className="header-count">{wishlistCount}</span>}
          </button>
          <button className="header-action" type="button" onClick={onCart} aria-label={`Open bag, ${cartCount} products`}>
            <IonIcon icon={bagHandleOutline} />{cartCount > 0 && <span className="header-count">{cartCount}</span>}
          </button>
          {signedIn && <button className="header-action header-notifications" type="button" onClick={onNotifications} aria-label="Open notification centre">
            <IonIcon icon={notificationsOutline} />
          </button>}
        </div>
      </div>
      <nav className="category-nav" aria-label="Product categories">
        <button className={!categoryFilter ? 'category-nav-all active' : 'category-nav-all'} type="button" onClick={() => chooseCategory('')}>
          <IonIcon icon={gridOutline} /> All Categories <IonIcon className="category-chevron" icon={chevronDownOutline} />
        </button>
        {categoryLinks.map(category => <button className={categoryFilter === category ? 'active' : ''} type="button" key={category} onClick={() => chooseCategory(category)}>{category}</button>)}
        {moreCategories.length > 0 && <details className="category-more">
          <summary>More <IonIcon icon={chevronDownOutline} /></summary>
          <div className="category-more-menu">{moreCategories.map(category => <button type="button" key={category} onClick={() => chooseCategory(category)}>{category}</button>)}</div>
        </details>}
      </nav>
    </header>
    <nav className="mobile-bottom-nav" aria-label="Main navigation">
      <a href="#top"><IonIcon icon={homeOutline} /><span>Home</span></a>
      <a href="#discover" onClick={() => onCategoryChange('')}><IonIcon icon={gridOutline} /><span>Categories</span></a>
      <button type="button" onClick={onWishlist}><IonIcon icon={heartOutline} /><span>Wishlist</span></button>
      <button type="button" onClick={onAccount}><IonIcon icon={personOutline} /><span>Account</span></button>
    </nav>
  </>;
}

export default StorefrontHeader;
