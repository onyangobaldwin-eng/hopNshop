import { describe, expect, it } from 'vitest';
import {
  assessSupplierRisk,
  calculateLandedCost,
  canTransitionSourcingRequest,
  compareProducts,
  hasPotentialDuplicate,
  retryDelayMs
} from '../src/lib/sourcing';

describe('sourcing cost calculations', () => {
  it('requires an explicit exchange rate for foreign supplier prices', () => {
    expect(() => calculateLandedCost({
      supplierPrice: 100,
      currency: 'USD',
      shippingKes: 0,
      insuranceKes: 0,
      importCostsKes: 0,
      otherExpensesKes: 0,
      markupPercent: 20
    })).toThrow();
  });

  it('converts supplier cost and calculates transparent KES totals and margin', () => {
    const result = calculateLandedCost({
      supplierPrice: 100,
      currency: 'usd',
      exchangeRateToKes: 130,
      shippingKes: 100,
      insuranceKes: 50,
      importCostsKes: 200,
      otherExpensesKes: 50,
      markupPercent: 25
    });

    expect(result).toEqual({
      currency: 'KES',
      exchangeRateToKes: 130,
      supplierCostKes: 13000,
      shippingKes: 100,
      insuranceKes: 50,
      importCostsKes: 200,
      otherExpensesKes: 50,
      totalCostKes: 13400,
      sellingPriceKes: 16750,
      grossProfitKes: 3350,
      grossMarginPercent: 20
    });
  });

  it('does not silently invent shipping or a selling price', () => {
    expect(() => calculateLandedCost({
      supplierPrice: 1_000,
      currency: 'KES',
      shippingKes: 0,
      insuranceKes: 0,
      importCostsKes: 0,
      otherExpensesKes: 0
    })).toThrow();
  });
});

describe('product comparison and supplier risk', () => {
  it('flags matching models for human review and identifies material model differences', () => {
    const left = { name: 'Acme Nova 12 phone', brand: 'Acme', model: 'Nova 12', specifications: { storage: '256GB' } };
    const matching = compareProducts(left, { ...left, name: 'Acme Nova 12 Smartphone' });
    const differentModel = compareProducts(left, { ...left, model: 'Nova 13' });

    expect(matching.outcome).toBe('possible_match');
    expect(matching.requiresHumanReview).toBe(true);
    expect(differentModel.outcome).toBe('unlikely_match');
    expect(differentModel.reasons).toContain('Model identifiers differ materially.');
  });

  it('detects only review candidates and never marks an unverified supplier low risk', () => {
    const product = { name: 'Acme Nova 12 phone', brand: 'Acme', model: 'Nova 12' };
    expect(hasPotentialDuplicate(product, [{ ...product }])).toBe(true);

    const unverified = assessSupplierRisk({
      humanVerified: false,
      hasBusinessInformation: true,
      hasContactDetails: true,
      verificationDocuments: 2,
      discrepancies: []
    });
    expect(unverified.classification).toBe('unverified');
    expect(unverified.requiresHumanReview).toBe(true);
  });

  it('raises human-verified evidence with a suspicious price to high risk', () => {
    const result = assessSupplierRisk({
      humanVerified: true,
      hasBusinessInformation: true,
      hasContactDetails: true,
      verificationDocuments: 2,
      sellerRating: 4.5,
      suspiciousPriceRatio: 0.4,
      discrepancies: []
    });

    expect(result.classification).toBe('high');
    expect(result.reasons[0]).toContain('Price is less than half');
    expect(result.requiresHumanReview).toBe(true);
  });
});

describe('sourcing workflow rules', () => {
  it('allows only documented request transitions', () => {
    expect(canTransitionSourcingRequest('queued', 'researching')).toBe(true);
    expect(canTransitionSourcingRequest('researching', 'approved')).toBe(false);
    expect(canTransitionSourcingRequest('completed', 'queued')).toBe(false);
  });

  it('uses capped exponential retry delays and rejects invalid attempts', () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(4)).toBe(8_000);
    expect(retryDelayMs(20)).toBe(300_000);
    expect(() => retryDelayMs(0)).toThrow(RangeError);
  });
});
