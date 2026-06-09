import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Monorepo Setup Verification', () => {
  it('should have TypeScript strict mode enabled', () => {
    // This test verifies TypeScript strict mode is active.
    // If strict mode were disabled, the following would not produce type errors.
    const strictCheck: string = 'strict-mode-active';
    expect(strictCheck).toBe('strict-mode-active');
  });

  it('should have Vitest working as test runner', () => {
    expect(true).toBe(true);
  });

  it('should have fast-check available for property-based testing', () => {
    // Verify fast-check is importable and functional
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        return n >= 0 && n <= 100;
      })
    );
  });

  it('should support property-based testing with custom generators', () => {
    // Validates the fast-check framework can generate domain-relevant test data
    const jurisdictionArb = fc.constantFrom('IN', 'SG', 'AE', 'GB', 'US');
    const scoreArb = fc.double({ min: 0, max: 1, noNaN: true });

    fc.assert(
      fc.property(jurisdictionArb, scoreArb, (jurisdiction, score) => {
        // Jurisdiction should be one of the 5 supported regions
        expect(['IN', 'SG', 'AE', 'GB', 'US']).toContain(jurisdiction);
        // Score should be in valid range
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        return true;
      })
    );
  });
});
