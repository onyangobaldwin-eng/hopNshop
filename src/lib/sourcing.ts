import { z } from 'zod';
import {
  assessSupplierRisk,
  calculateLandedCostValues,
  canTransitionSourcingRequest,
  compareProducts,
  hasPotentialDuplicate,
  retryDelayMs,
  sourcingRequestStatuses
} from '../../supabase/functions/_shared/sourcing-domain';

export {
  assessSupplierRisk,
  canTransitionSourcingRequest,
  compareProducts,
  hasPotentialDuplicate,
  retryDelayMs,
  sourcingRequestStatuses
};
export type {
  ComparableProduct,
  LandedCostResult,
  ProductComparison,
  SourcingRequestStatus,
  SupplierRisk,
  SupplierRiskAssessment,
  SupplierRiskEvidence
} from '../../supabase/functions/_shared/sourcing-domain';

const nonNegativeCost = z.number().finite().min(0);

export const landedCostInputSchema = z.object({
  supplierPrice: z.number().finite().positive(),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  exchangeRateToKes: z.number().finite().positive().optional(),
  shippingKes: nonNegativeCost,
  insuranceKes: nonNegativeCost,
  importCostsKes: nonNegativeCost,
  otherExpensesKes: nonNegativeCost,
  markupPercent: z.number().finite().min(0).optional(),
  targetSellingPriceKes: z.number().finite().positive().optional()
}).superRefine((input, context) => {
  if (input.currency !== 'KES' && input.exchangeRateToKes === undefined) {
    context.addIssue({ code: 'custom', path: ['exchangeRateToKes'], message: 'A verified exchange rate is required for non-KES prices.' });
  }
  if ((input.markupPercent === undefined) === (input.targetSellingPriceKes === undefined)) {
    context.addIssue({ code: 'custom', path: ['markupPercent'], message: 'Provide either a markup percentage or a target selling price.' });
  }
});

export type LandedCostInput = z.input<typeof landedCostInputSchema>;

export function calculateLandedCost(rawInput: LandedCostInput) {
  const input = landedCostInputSchema.parse(rawInput);
  const exchangeRateToKes = input.exchangeRateToKes ?? (input.currency === 'KES' ? 1 : undefined);
  if (exchangeRateToKes === undefined) throw new Error('A verified exchange rate is required for non-KES prices.');
  return calculateLandedCostValues({ ...input, exchangeRateToKes });
}
