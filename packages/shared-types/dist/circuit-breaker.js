"use strict";
/**
 * Circuit breaker and degradation hierarchy types.
 *
 * Every AI service implements a 5-tier fallback chain:
 * primary model → smaller model → rules engine → human review → safe default.
 *
 * The circuit breaker pattern detects consecutive failures and transitions
 * through states to prevent cascading failures.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = exports.DEGRADATION_ORDER = void 0;
exports.getNextDegradationTier = getNextDegradationTier;
/** Ordered degradation tiers from highest capability to safest default. */
exports.DEGRADATION_ORDER = [
    'PRIMARY',
    'SECONDARY',
    'RULES_ENGINE',
    'HUMAN_REVIEW',
    'SAFE_DEFAULT',
];
/** Default circuit breaker configuration as specified in design. */
exports.DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 3,
    recoveryTimeoutMs: 10_000,
    successThreshold: 1,
    halfOpenMaxRequests: 1,
    requestTimeoutMs: 5_000,
};
/**
 * Determines the next degradation tier given the current tier.
 * Returns undefined if already at the lowest tier (SAFE_DEFAULT).
 *
 * @param currentTier - The current active degradation tier
 * @returns The next tier in the fallback chain, or undefined if at bottom
 */
function getNextDegradationTier(currentTier) {
    const currentIndex = exports.DEGRADATION_ORDER.indexOf(currentTier);
    if (currentIndex === -1 || currentIndex >= exports.DEGRADATION_ORDER.length - 1) {
        return undefined;
    }
    return exports.DEGRADATION_ORDER[currentIndex + 1];
}
//# sourceMappingURL=circuit-breaker.js.map