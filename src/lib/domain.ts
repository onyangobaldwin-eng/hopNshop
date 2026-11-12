import { z } from 'zod';

export type BusinessModel = 'affiliate' | 'resale' | 'sourcing';
export type ProductAvailability = 'affiliate' | 'local_inventory' | 'pre_order' | 'sourcing_only';
export type OrderStatus = 'awaiting_payment' | 'payment_verification' | 'payment_confirmed' | 'procurement_approved' | 'ordered_from_supplier' | 'supplier_processing' | 'dispatched' | 'international_transit' | 'customs_processing' | 'local_courier' | 'ready_for_collection' | 'delivered' | 'cancelled' | 'refund_pending' | 'refunded' | 'exception';

export const sourcingRequestSchema = z.object({
  productUrl: z.string().url().max(2000),
  productName: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  brandPreference: z.string().trim().max(200).optional(),
  modelSpecification: z.string().trim().max(200).optional(),
  productCondition: z.enum(['new', 'used', 'refurbished', 'any']).optional(),
  preferredLocation: z.string().trim().max(200).optional(),
  quantity: z.number().int().min(1).max(100),
  variant: z.string().trim().max(200).optional(),
  customerRequirements: z.string().trim().max(2_000).optional(),
  notes: z.string().trim().max(2_000).optional()
});
export const resaleOrderSchema = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+() -]{8,24}$/),
  addressLine: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  county: z.string().trim().max(100).optional()
});
export const sourcingQuoteSchema = z.object({
  description: z.string().trim().min(2).max(300),
  unitAmount: z.number().finite().gt(0).max(100000000),
  shipping: z.number().finite().min(0).max(100000000),
  duties: z.number().finite().min(0).max(100000000),
  taxes: z.number().finite().min(0).max(100000000),
  serviceFee: z.number().finite().min(0).max(100000000),
  markup: z.number().finite().min(0).max(100000000),
  discount: z.number().finite().min(0).max(100000000),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  deliveryWindow: z.string().trim().max(100).optional()
});
export const manualPaymentSchema = z.object({
  transactionReference: z.string().trim().regex(/^[A-Za-z0-9]{6,20}$/),
  payerName: z.string().trim().min(2).max(120),
  amount: z.number().finite().gt(0).max(100000000)
});
export const manualRefundRequestSchema = z.object({
  amount: z.number().finite().gt(0).max(100000000),
  reason: z.string().trim().min(10).max(1000)
});
export const manualRefundCompletionSchema = z.object({
  providerReference: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/)
});
export const customerProfileSchema = z.object({
  fullName: z.string().trim().max(120),
  phone: z.union([z.literal(''), z.string().trim().regex(/^[0-9+() -]{8,24}$/)])
});
export const savedAddressSchema = z.object({
  label: z.string().trim().min(2).max(60),
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+() -]{8,24}$/),
  addressLine: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  county: z.string().trim().max(100)
});
export const sourcingReferenceImageSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(5 * 1024 * 1024)
});
export const adminProductSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(220),
  description: z.string().trim().max(5000),
  brand: z.string().trim().max(120).nullable(),
  categoryId: z.string().uuid().nullable(),
  businessModel: z.enum(['affiliate', 'resale', 'sourcing']),
  availability: z.enum(['affiliate', 'local_inventory', 'pre_order', 'sourcing_only']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  sourcePrice: z.number().finite().positive().max(100000000).nullable(),
  localPrice: z.number().finite().positive().max(100000000).nullable(),
  sourceUrl: z.string().url().max(2000).nullable(),
  affiliateUrl: z.string().url().max(2000).nullable(),
  publicationStatus: z.enum(['draft', 'review', 'published', 'archived'])
}).superRefine((product, context) => {
  if (product.publicationStatus !== 'published') return;
  if (!product.sourceUrl || !isValidPublicProductUrl(product.sourceUrl)) {
    context.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Published products need a verified public HTTPS source.' });
  }
  if (product.businessModel === 'affiliate') {
    if (product.availability !== 'affiliate') context.addIssue({ code: 'custom', path: ['availability'], message: 'Affiliate products must use affiliate availability.' });
    if (!product.affiliateUrl || !isValidPublicProductUrl(product.affiliateUrl)) context.addIssue({ code: 'custom', path: ['affiliateUrl'], message: 'Published affiliate products need an approved HTTPS tracking link.' });
  }
  if (product.businessModel === 'resale') {
    if (!['local_inventory', 'pre_order'].includes(product.availability)) context.addIssue({ code: 'custom', path: ['availability'], message: 'Resale products must be local inventory or pre-order.' });
    if (product.localPrice === null) context.addIssue({ code: 'custom', path: ['localPrice'], message: 'Published resale products need a positive local price.' });
  }
  if (product.businessModel === 'sourcing' && product.availability !== 'sourcing_only') {
    context.addIssue({ code: 'custom', path: ['availability'], message: 'Sourcing products must use sourcing-only availability.' });
  }
});

export interface ProductVariant { id: string; name: string; sku?: string; attributes: Record<string, unknown>; price?: number; available: boolean; }
export interface Product { id: string; name: string; slug: string; description: string; brand?: string; category?: string; availability: ProductAvailability; businessModel: BusinessModel; localPrice?: number; estimatedShipping?: number; estimatedDuties?: number; currency: string; imageUrl?: string; imageUrls?: string[]; variants?: ProductVariant[]; sourceUrl?: string; affiliateTrackingUrl?: string; affiliateLinkId?: string; publishedAt?: string; verifiedAt?: string; }
export interface DiscoveryFilters {
  search?: string;
  category?: string;
  brand?: string;
  size?: string;
  colour?: string;
  availability?: ProductAvailability | '';
  currency?: string;
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'name';
}

function variantHasAttribute(variants: ProductVariant[] | undefined, attribute: 'size' | 'colour', value: string) {
  const expected = value.trim().toLocaleLowerCase();
  if (!expected) return true;
  const acceptedKeys = attribute === 'colour' ? ['colour', 'color'] : ['size'];
  return (variants ?? []).some(variant =>
    variant.available && (
      variant.name.toLocaleLowerCase().split(/[\s·,/_-]+/).includes(expected)
      || Object.entries(variant.attributes).some(([key, attributeValue]) =>
        acceptedKeys.includes(key.trim().toLocaleLowerCase())
        && String(attributeValue).trim().toLocaleLowerCase() === expected
      )
    )
  );
}

export function filterProducts(products: Product[], filters: DiscoveryFilters): Product[] {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return products.filter(product => {
    if (query && !`${product.name} ${product.description} ${product.brand ?? ''} ${product.category ?? ''}`.toLowerCase().includes(query)) return false;
    if (filters.category && product.category !== filters.category
      && !(filters.category === 'Sports & Outdoors' && product.category === 'Sports')) return false;
    if (filters.brand && product.brand !== filters.brand) return false;
    if (filters.size && !variantHasAttribute(product.variants, 'size', filters.size)) return false;
    if (filters.colour && !variantHasAttribute(product.variants, 'colour', filters.colour)) return false;
    if (filters.availability && product.availability !== filters.availability) return false;
    if (filters.currency && product.currency.toUpperCase() !== filters.currency.toUpperCase()) return false;
    return true;
  }).sort((left, right) => {
    switch (filters.sortBy ?? 'newest') {
      case 'price_asc': return left.currency.localeCompare(right.currency) || (left.localPrice ?? Number.POSITIVE_INFINITY) - (right.localPrice ?? Number.POSITIVE_INFINITY);
      case 'price_desc': return left.currency.localeCompare(right.currency) || (right.localPrice ?? Number.NEGATIVE_INFINITY) - (left.localPrice ?? Number.NEGATIVE_INFINITY);
      case 'name': return left.name.localeCompare(right.name);
      default: return (right.publishedAt ?? '').localeCompare(left.publishedAt ?? '');
    }
  });
}
export function canPurchaseResaleProduct(product: Product): boolean {
  return product.businessModel === 'resale'
    && (product.availability === 'local_inventory' || product.availability === 'pre_order')
    && product.localPrice !== undefined
    && Number.isFinite(product.localPrice)
    && product.localPrice > 0;
}
export interface QuoteLine { description: string; quantity: number; unitAmount: number; }
export interface QuoteInput { lines: QuoteLine[]; shipping: number; duties: number; taxes: number; serviceFee: number; markupRate: number; discount: number; }
export interface QuoteTotals { subtotal: number; markup: number; total: number; }

export function calculateQuote(input: QuoteInput): QuoteTotals {
  const subtotal = input.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0) + input.shipping + input.duties + input.taxes + input.serviceFee;
  const markup = Math.max(0, subtotal * input.markupRate);
  return { subtotal, markup, total: Math.max(0, subtotal + markup - input.discount) };
}

export function isValidPublicProductUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return host.includes('.') && !url.username && !url.password;
  } catch { return false; }
}

export const ORDER_STATUS_FLOW: OrderStatus[] = ['awaiting_payment', 'payment_verification', 'payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing', 'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection', 'delivered'];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (to === 'cancelled' || to === 'exception') return !['delivered', 'refunded'].includes(from);
  if (to === 'refund_pending') return ['payment_confirmed', 'delivered', 'exception'].includes(from);
  if (to === 'refunded') return from === 'refund_pending';
  return ORDER_STATUS_FLOW.indexOf(to) === ORDER_STATUS_FLOW.indexOf(from) + 1;
}
