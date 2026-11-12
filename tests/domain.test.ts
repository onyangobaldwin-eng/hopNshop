import { adminProductSchema, calculateQuote, canPurchaseResaleProduct, canTransitionOrder, customerProfileSchema, filterProducts, isValidPublicProductUrl, manualPaymentSchema, manualRefundCompletionSchema, manualRefundRequestSchema, resaleOrderSchema, savedAddressSchema, sourcingQuoteSchema, sourcingReferenceImageSchema, sourcingRequestSchema, type Product } from '../src/lib/domain';

describe('quote calculation', () => {
  it('adds costs and applies markup and discount', () => {
    expect(calculateQuote({ lines: [{ description: 'Item', quantity: 2, unitAmount: 100 }], shipping: 50, duties: 20, taxes: 10, serviceFee: 25, markupRate: .1, discount: 10 })).toEqual({ subtotal: 305, markup: 30.5, total: 325.5 });
  });
});
describe('safe source URLs', () => {
  it('rejects private networks and accepts public HTTPS URLs', () => { expect(isValidPublicProductUrl('http://localhost:3000/x')).toBe(false); expect(isValidPublicProductUrl('https://192.168.0.1/x')).toBe(false); expect(isValidPublicProductUrl('https://example.com/product')).toBe(true); });
});
describe('sourcing request validation', () => {
  it('accepts a bounded request and rejects invalid quantities', () => {
    expect(sourcingRequestSchema.safeParse({ productUrl: 'https://example.com/item', quantity: 2 }).success).toBe(true);
    expect(sourcingRequestSchema.safeParse({ productUrl: 'https://example.com/item', productName: 'Desk lamp', quantity: 2 }).success).toBe(true);
    expect(sourcingRequestSchema.safeParse({ productUrl: 'https://example.com/item', productName: 'x'.repeat(201), quantity: 2 }).success).toBe(false);
    expect(sourcingRequestSchema.safeParse({ productUrl: 'https://example.com/item', quantity: 101 }).success).toBe(false);
  });
  it('validates structured sourcing details without requiring an unverified budget', () => {
    const request = sourcingRequestSchema.safeParse({
      productUrl: 'https://example.com/item',
      quantity: 1,
      categoryId: '00000000-0000-4000-8000-000000000001',
      brandPreference: ' Acme ',
      modelSpecification: 'Nova 12',
      productCondition: 'refurbished',
      preferredLocation: 'Nairobi',
      customerRequirements: '256GB storage'
    });
    expect(request.success).toBe(true);
    if (request.success) expect(request.data.brandPreference).toBe('Acme');
    expect(sourcingRequestSchema.safeParse({
      productUrl: 'https://example.com/item',
      quantity: 1,
      productCondition: 'damaged'
    }).success).toBe(false);
  });
  describe('resale checkout validation', () => {
    const product: Product = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Local product',
      slug: 'local-product',
      description: 'A real catalogue item',
      availability: 'local_inventory',
      businessModel: 'resale',
      localPrice: 1250,
      currency: 'KES'
    };

    it('only makes priced local inventory and pre-orders purchasable through hopNshop', () => {
      expect(canPurchaseResaleProduct(product)).toBe(true);
      expect(canPurchaseResaleProduct({ ...product, businessModel: 'affiliate' })).toBe(false);
      expect(canPurchaseResaleProduct({ ...product, availability: 'sourcing_only' })).toBe(false);
      expect(canPurchaseResaleProduct({ ...product, localPrice: undefined })).toBe(false);
    });
    describe('sourcing quotation validation', () => {
      const quote = {
        description: 'Sourced product',
        unitAmount: 1000,
        shipping: 100,
        duties: 50,
        taxes: 0,
        serviceFee: 200,
        markup: 100,
        discount: 0,
        deliveryWindow: '2-3 weeks'
      };

      it('accepts itemized KES quote details and rejects invalid amounts', () => {
        expect(sourcingQuoteSchema.safeParse(quote).success).toBe(true);
        expect(sourcingQuoteSchema.safeParse({ ...quote, unitAmount: 0 }).success).toBe(false);
        expect(sourcingQuoteSchema.safeParse({ ...quote, discount: -1 }).success).toBe(false);
      });
    });

    it('validates delivery details, product IDs, and bounded quantities', () => {
      const checkout = {
        items: [{ productId: product.id, quantity: 2 }],
        recipientName: 'Customer Name',
        phone: '+254 700 123 456',
        addressLine: '12 Market Road',
        city: 'Nairobi'
      };
      expect(resaleOrderSchema.safeParse(checkout).success).toBe(true);
      expect(resaleOrderSchema.safeParse({ ...checkout, items: [{ productId: product.id, quantity: 0 }] }).success).toBe(false);
      expect(resaleOrderSchema.safeParse({ ...checkout, phone: 'bad' }).success).toBe(false);
    });
  });
});
describe('order transitions', () => {
  it('only permits the next workflow state or controlled exceptions', () => { expect(canTransitionOrder('awaiting_payment', 'payment_verification')).toBe(true); expect(canTransitionOrder('awaiting_payment', 'delivered')).toBe(false); expect(canTransitionOrder('delivered', 'cancelled')).toBe(false); expect(canTransitionOrder('payment_confirmed', 'refund_pending')).toBe(true); });
});
describe('manual payment submission validation', () => {
  it('accepts a transaction reference, payer and positive amount', () => {
    expect(manualPaymentSchema.safeParse({ transactionReference: 'AB12CD34EF', payerName: 'A Customer', amount: 1250 }).success).toBe(true);
  });
  describe('manual refund validation', () => {
    it('accepts a bounded refund request and an external completion reference', () => {
      expect(manualRefundRequestSchema.safeParse({ amount: 1250, reason: 'Item arrived damaged.' }).success).toBe(true);
      expect(manualRefundCompletionSchema.safeParse({ providerReference: 'RF123ABC456' }).success).toBe(true);
    });
    describe('customer profile and address validation', () => {
      it('accepts optional profile fields and validates saved delivery addresses', () => {
        expect(customerProfileSchema.safeParse({ fullName: '', phone: '' }).success).toBe(true);
        expect(customerProfileSchema.safeParse({ fullName: 'Customer Name', phone: '+254 700 123 456' }).success).toBe(true);
        expect(savedAddressSchema.safeParse({
          label: 'Home',
          recipientName: 'Customer Name',
          phone: '+254 700 123 456',
          addressLine: '12 Market Road',
          city: 'Nairobi',
          county: 'Nairobi'
        }).success).toBe(true);
      });

      it('rejects malformed contact numbers and incomplete addresses', () => {
        expect(customerProfileSchema.safeParse({ fullName: 'Customer', phone: 'bad' }).success).toBe(false);
        expect(savedAddressSchema.safeParse({
          label: 'H',
          recipientName: 'Customer Name',
          phone: 'bad',
          addressLine: '1',
          city: 'N',
          county: ''
        }).success).toBe(false);
      });
    });

    it('rejects invalid refund requests and malformed completion references', () => {
      expect(manualRefundRequestSchema.safeParse({ amount: 0, reason: 'too short' }).success).toBe(false);
      expect(manualRefundRequestSchema.safeParse({ amount: 10, reason: 'x'.repeat(1001) }).success).toBe(false);
      expect(manualRefundCompletionSchema.safeParse({ providerReference: 'BAD REF' }).success).toBe(false);
    });
  });

  it('rejects malformed references and non-positive amounts', () => {
    expect(manualPaymentSchema.safeParse({ transactionReference: 'REF 123', payerName: 'A Customer', amount: 1250 }).success).toBe(false);
    expect(manualPaymentSchema.safeParse({ transactionReference: 'AB12CD34EF', payerName: 'A Customer', amount: 0 }).success).toBe(false);
  });
});
describe('sourcing reference images', () => {
  it('accepts supported image formats up to 5 MB', () => {
    expect(sourcingReferenceImageSchema.safeParse({ type: 'image/png', size: 1024 }).success).toBe(true);
    expect(sourcingReferenceImageSchema.safeParse({ type: 'image/webp', size: 5 * 1024 * 1024 }).success).toBe(true);
  });

  it('rejects unsupported formats and oversized images', () => {
    expect(sourcingReferenceImageSchema.safeParse({ type: 'image/svg+xml', size: 1024 }).success).toBe(false);
    expect(sourcingReferenceImageSchema.safeParse({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }).success).toBe(false);
  });
});
describe('product publication checks', () => {
  const product = {
    name: 'Desk lamp',
    slug: 'desk-lamp',
    description: 'A verified local item.',
    brand: null,
    categoryId: null,
    businessModel: 'resale',
    availability: 'local_inventory',
    currency: 'KES',
    sourcePrice: null,
    localPrice: 1500,
    sourceUrl: 'https://supplier.example/item',
    affiliateUrl: null,
    publicationStatus: 'published'
  };

  it('allows a priced resale listing with a public HTTPS source', () => {
    expect(adminProductSchema.safeParse(product).success).toBe(true);
  });

  it('prevents publishing without a public source or correct model fields', () => {
    expect(adminProductSchema.safeParse({ ...product, sourceUrl: null }).success).toBe(false);
    expect(adminProductSchema.safeParse({ ...product, localPrice: null }).success).toBe(false);
    expect(adminProductSchema.safeParse({ ...product, businessModel: 'affiliate', availability: 'affiliate', affiliateUrl: null }).success).toBe(false);
  });
});
describe('product discovery filters', () => {
  const products: Product[] = [
    { id: '1', name: 'Desk lamp', slug: 'desk-lamp', description: 'Warm light', brand: 'North', category: 'Home', availability: 'local_inventory', businessModel: 'resale', localPrice: 1500, currency: 'KES', publishedAt: '2026-01-02', variants: [{ id: 'v1', name: 'Medium · Blue', attributes: { size: 'M', colour: 'Blue' }, available: true }] },
    { id: '2', name: 'Travel mug', slug: 'travel-mug', description: 'Steel mug', brand: 'South', category: 'Travel', availability: 'pre_order', businessModel: 'resale', localPrice: 800, currency: 'KES', publishedAt: '2026-01-01' },
    { id: '3', name: 'Creator light', slug: 'creator-light', description: 'Studio light', brand: 'North', category: 'Tech', availability: 'affiliate', businessModel: 'affiliate', currency: 'USD', publishedAt: '2026-01-03' }
  ];

  it('combines text, category, brand, availability and currency filters', () => {
    expect(filterProducts(products, { search: 'light', category: 'Home', brand: 'North', availability: 'local_inventory', currency: 'KES' }).map(item => item.id)).toEqual(['1']);
    expect(filterProducts([{ ...products[0], category: 'Sports' }], { category: 'Sports & Outdoors' }).map(item => item.id)).toEqual(['1']);
    expect(filterProducts(products, { search: 'Home' }).map(item => item.id)).toEqual(['1']);
    expect(filterProducts(products, { size: 'M', colour: 'blue' }).map(item => item.id)).toEqual(['1']);
    expect(filterProducts(products, { size: 'L' })).toEqual([]);
    expect(filterProducts(products, { currency: 'KES' }).map(item => item.id)).toEqual(['1', '2']);
    expect(filterProducts(products, { currency: 'usd' }).map(item => item.id)).toEqual(['3']);
  });

  it('sorts actual catalogue records by newest, price or name', () => {
    expect(filterProducts(products, { sortBy: 'newest' }).map(item => item.id)).toEqual(['3', '1', '2']);
    expect(filterProducts(products, { sortBy: 'price_asc' }).map(item => item.id)).toEqual(['2', '1', '3']);
    expect(filterProducts(products, { sortBy: 'name' }).map(item => item.name)).toEqual(['Creator light', 'Desk lamp', 'Travel mug']);
  });
});
