import { IonIcon } from '@ionic/react';
import { arrowForwardOutline } from 'ionicons/icons';

interface HomeHeroProps {
  onSourceRequest: () => void;
  campaign?: {
    title: string;
    description: string;
    imageUrl: string;
    ctaLabel: string;
    targetType: 'category' | 'collection' | 'product' | 'sourcing';
    targetId: string | null;
  } | null;
  onCampaignAction?: (campaign: NonNullable<HomeHeroProps['campaign']>) => void;
}

function HomeHero({ onSourceRequest, campaign, onCampaignAction }: HomeHeroProps) {
  return <section className="home-hero" aria-labelledby="home-hero-title">
    <img className="home-hero-image" src={campaign?.imageUrl ?? '/images/hero-reference.jpg'} alt={campaign?.title ?? 'Shopper carrying bags from a thoughtful find'} fetchPriority="high" />
    <div className="home-hero-shade" />
    <div className="home-hero-content">
      <p className="hero-kicker"><span /> {campaign ? 'Featured campaign · hopNshop' : 'Curated commerce · Kenya'}</p>
      <h2 id="home-hero-title">{campaign ? campaign.title : <>Your Next<br /><em>Favourite Find</em></>}</h2>
      <p className="home-hero-lede">{campaign?.description || 'Discover curated products, shop selected finds, or ask us to source something you found elsewhere.'}</p>
      <div className="home-hero-actions">
        {campaign
          ? <button className="button button-lime" type="button" onClick={() => onCampaignAction?.(campaign)}>{campaign.ctaLabel} <IonIcon icon={arrowForwardOutline} /></button>
          : <a className="button button-lime" href="#discover">Shop the Collection <IonIcon icon={arrowForwardOutline} /></a>}
        <button className="button button-outline-light" type="button" onClick={onSourceRequest}>Can’t find it? We can source it</button>
      </div>
    </div>
    <span className="home-hero-index" aria-hidden="true">01 <i /> 01</span>
  </section>;
}

export default HomeHero;
