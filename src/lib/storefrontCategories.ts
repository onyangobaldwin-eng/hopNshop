export interface StorefrontCategory {
  name: string;
  slug: string;
  image: string;
  description: string;
}

export const STOREFRONT_CATEGORIES: StorefrontCategory[] = [
  { name: 'Fashion', slug: 'fashion', image: '/images/categories/fashion.webp', description: 'Considered pieces for every day.' },
  { name: 'Electronics', slug: 'electronics', image: '/images/categories/electronics.webp', description: 'Thoughtful upgrades for work and play.' },
  { name: 'Beauty', slug: 'beauty', image: '/images/categories/beauty.webp', description: 'Everyday rituals, beautifully chosen.' },
  { name: 'Home & Living', slug: 'home-living', image: '/images/categories/home-living.webp', description: 'Small details that make a space yours.' },
  { name: 'Sports & Outdoors', slug: 'sports-outdoors', image: '/images/categories/sports-outdoors.webp', description: 'Made for movement and open air.' },
  { name: 'Footwear', slug: 'footwear', image: '/images/categories/footwear.webp', description: 'The finishing touch to every look.' },
  { name: 'Watches & Accessories', slug: 'watches-accessories', image: '/images/categories/watches-accessories.webp', description: 'Personal details, made to last.' },
  { name: 'Bags & Luggage', slug: 'bags-luggage', image: '/images/categories/bags-luggage.webp', description: 'Carry your day, wherever it goes.' },
  { name: 'Kids & Baby', slug: 'kids-baby', image: '/images/categories/kids-baby.webp', description: 'Useful finds for little ones.' },
  { name: 'Health & Wellness', slug: 'health-wellness', image: '/images/categories/health-wellness.webp', description: 'A little more care in your routine.' },
  { name: 'Automotive Accessories', slug: 'automotive-accessories', image: '/images/categories/automotive-accessories.webp', description: 'Useful upgrades for the road.' },
  { name: 'Lifestyle', slug: 'lifestyle', image: '/images/categories/lifestyle.webp', description: 'Good things for the way you live.' }
];
