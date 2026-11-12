export interface LandedCostValuesInput {
  supplierPrice: number;
  currency: string;
  exchangeRateToKes: number;
  shippingKes: number;
  insuranceKes: number;
  importCostsKes: number;
  otherExpensesKes: number;
  markupPercent?: number;
  targetSellingPriceKes?: number;
}

export interface LandedCostResult {
  currency: 'KES';
  exchangeRateToKes: number;
  supplierCostKes: number;
  shippingKes: number;
  insuranceKes: number;
  importCostsKes: number;
  otherExpensesKes: number;
  totalCostKes: number;
  sellingPriceKes: number;
  grossProfitKes: number;
  grossMarginPercent: number;
}

const roundKes = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

export function calculateLandedCostValues(input: LandedCostValuesInput): LandedCostResult {
  const supplierCostKes = roundKes(input.supplierPrice * input.exchangeRateToKes);
  const shippingKes = roundKes(input.shippingKes);
  const insuranceKes = roundKes(input.insuranceKes);
  const importCostsKes = roundKes(input.importCostsKes);
  const otherExpensesKes = roundKes(input.otherExpensesKes);
  const totalCostKes = roundKes(supplierCostKes + shippingKes + insuranceKes + importCostsKes + otherExpensesKes);
  const sellingPriceKes = input.targetSellingPriceKes === undefined
    ? roundKes(totalCostKes * (1 + (input.markupPercent ?? 0) / 100))
    : roundKes(input.targetSellingPriceKes);
  const grossProfitKes = roundKes(sellingPriceKes - totalCostKes);

  return {
    currency: 'KES',
    exchangeRateToKes: input.exchangeRateToKes,
    supplierCostKes,
    shippingKes,
    insuranceKes,
    importCostsKes,
    otherExpensesKes,
    totalCostKes,
    sellingPriceKes,
    grossProfitKes,
    grossMarginPercent: sellingPriceKes === 0 ? 0 : roundKes(grossProfitKes / sellingPriceKes * 100)
  };
}

export interface ComparableProduct {
  name: string;
  brand?: string | null;
  model?: string | null;
  specifications?: Record<string, string | number | null> | null;
  variant?: string | null;
  condition?: string | null;
}

export interface ProductComparison {
  score: number;
  outcome: 'possible_match' | 'unlikely_match';
  requiresHumanReview: true;
  reasons: string[];
}

const normalizeText = (value: string | null | undefined) => (value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const tokenSimilarity = (left: string, right: string) => {
  const leftTokens = new Set(normalizeText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
};

const normalizedSpecifications = (product: ComparableProduct) => Object.entries(product.specifications ?? {})
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${normalizeText(key)} ${normalizeText(String(value ?? ''))}`)
  .join(' ');

export function compareProducts(left: ComparableProduct, right: ComparableProduct): ProductComparison {
  const leftBrand = normalizeText(left.brand);
  const rightBrand = normalizeText(right.brand);
  const leftModel = normalizeText(left.model);
  const rightModel = normalizeText(right.model);
  const leftVariant = normalizeText(left.variant);
  const rightVariant = normalizeText(right.variant);
  const leftCondition = normalizeText(left.condition);
  const rightCondition = normalizeText(right.condition);
  const brandMatch = Boolean(leftBrand && rightBrand && leftBrand === rightBrand);
  const modelMatch = Boolean(leftModel && rightModel && leftModel === rightModel);
  const explicitModelMismatch = Boolean(leftModel && rightModel && leftModel !== rightModel);
  const variantMismatch = Boolean(leftVariant && rightVariant && leftVariant !== rightVariant);
  const conditionMismatch = Boolean(leftCondition && rightCondition && leftCondition !== rightCondition);
  const nameSimilarity = tokenSimilarity(left.name, right.name);
  const specificationSimilarity = tokenSimilarity(normalizedSpecifications(left), normalizedSpecifications(right));
  let score = Math.round(nameSimilarity * 25 + specificationSimilarity * 20 + (brandMatch ? 25 : 0) + (modelMatch ? 30 : 0));
  const reasons: string[] = [];

  if (brandMatch) reasons.push('Brand matches.');
  else if (leftBrand && rightBrand) {
    reasons.push('Brands differ.');
    score -= 20;
  }
  if (modelMatch) reasons.push('Model identifiers match.');
  if (explicitModelMismatch) {
    reasons.push('Model identifiers differ materially.');
    score -= 45;
  } else if (!leftModel || !rightModel) reasons.push('Model information is incomplete.');
  if (variantMismatch) {
    reasons.push('Variants differ and need separate review.');
    score -= 20;
  }
  if (conditionMismatch) {
    reasons.push('Product conditions differ.');
    score -= 20;
  }
  if (nameSimilarity >= 0.6) reasons.push('Product names are similar.');
  if (specificationSimilarity >= 0.6) reasons.push('Available specifications are similar.');
  if (reasons.length === 0) reasons.push('Available product details provide little evidence of a match.');

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    outcome: score >= 65 ? 'possible_match' : 'unlikely_match',
    requiresHumanReview: true,
    reasons
  };
}

export function hasPotentialDuplicate(candidate: ComparableProduct, existing: ComparableProduct[]) {
  return existing.some(product => compareProducts(candidate, product).outcome === 'possible_match');
}

export type SupplierRisk = 'low' | 'moderate' | 'high' | 'unverified';

export interface SupplierRiskEvidence {
  humanVerified: boolean;
  hasBusinessInformation: boolean;
  hasContactDetails: boolean;
  verificationDocuments: number;
  sellerRating?: number | null;
  suspiciousPriceRatio?: number | null;
  discrepancies: string[];
}

export interface SupplierRiskAssessment {
  classification: SupplierRisk;
  requiresHumanReview: true;
  reasons: string[];
}

export function assessSupplierRisk(evidence: SupplierRiskEvidence): SupplierRiskAssessment {
  const reasons: string[] = [];
  if (!evidence.humanVerified) {
    reasons.push('Supplier has not been verified by an authorized human reviewer.');
    if (!evidence.hasBusinessInformation) reasons.push('Business information is missing.');
    if (!evidence.hasContactDetails) reasons.push('Contact details are missing.');
    return { classification: 'unverified', requiresHumanReview: true, reasons };
  }

  if (!evidence.hasBusinessInformation) reasons.push('Business information is incomplete.');
  if (!evidence.hasContactDetails) reasons.push('Contact details are incomplete.');
  if (evidence.verificationDocuments === 0) reasons.push('No verification documents are recorded.');
  if (evidence.sellerRating !== undefined && evidence.sellerRating !== null && evidence.sellerRating < 3) {
    reasons.push('Recorded seller rating is below 3 out of 5.');
  }
  if (evidence.suspiciousPriceRatio !== undefined && evidence.suspiciousPriceRatio !== null && evidence.suspiciousPriceRatio < 0.5) {
    reasons.push('Price is less than half of the configured comparison baseline.');
  }
  if (evidence.discrepancies.length > 0) reasons.push(...evidence.discrepancies.map(item => `Review discrepancy: ${item}`));

  const highRisk = (evidence.suspiciousPriceRatio !== undefined && evidence.suspiciousPriceRatio !== null && evidence.suspiciousPriceRatio < 0.5)
    || evidence.discrepancies.length > 0;
  const moderateRisk = !evidence.hasBusinessInformation
    || !evidence.hasContactDetails
    || evidence.verificationDocuments === 0
    || (evidence.sellerRating !== undefined && evidence.sellerRating !== null && evidence.sellerRating < 3);

  return {
    classification: highRisk ? 'high' : moderateRisk ? 'moderate' : 'low',
    requiresHumanReview: true,
    reasons: reasons.length ? reasons : ['Recorded evidence passed the configured checks; this is not a guarantee of legitimacy or authenticity.']
  };
}

export const sourcingRequestStatuses = [
  'new',
  'queued',
  'researching',
  'comparing',
  'verification_pending',
  'awaiting_approval',
  'approved',
  'rejected',
  'quoted',
  'completed',
  'failed',
  'cancelled'
] as const;

export type SourcingRequestStatus = typeof sourcingRequestStatuses[number];

const requestTransitions: Record<SourcingRequestStatus, readonly SourcingRequestStatus[]> = {
  new: ['queued', 'cancelled'],
  queued: ['researching', 'cancelled', 'failed'],
  researching: ['comparing', 'verification_pending', 'failed', 'cancelled'],
  comparing: ['verification_pending', 'awaiting_approval', 'failed', 'cancelled'],
  verification_pending: ['comparing', 'awaiting_approval', 'failed', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'failed', 'cancelled'],
  approved: ['quoted', 'completed', 'failed'],
  rejected: ['queued', 'cancelled'],
  quoted: ['completed', 'cancelled'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: []
};

export function canTransitionSourcingRequest(from: SourcingRequestStatus, to: SourcingRequestStatus) {
  return requestTransitions[from].includes(to);
}

export function retryDelayMs(attempt: number, baseDelayMs = 1_000, maxDelayMs = 300_000) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('Retry attempt must be a positive integer.');
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
    throw new RangeError('Retry delay bounds are invalid.');
  }
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}
