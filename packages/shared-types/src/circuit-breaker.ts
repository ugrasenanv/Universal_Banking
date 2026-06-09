/**
 * Circuit breaker and degradation hierarchy types.
 *
 * Every AI service implements a 5-tier fallback chain:
 * primary model → smaller model → rules engine → human review → safe default.
 *
 * The circuit breaker pattern detects consecutive failures and transitions
 * through states to prevent cascading failures.
 */

/**
 * The 5-tier degradation hierarchy for AI services.
 * Each tier represents a progressively safer (but less capable) fallback.
 */
export type DegradationTier =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'RULES_ENGINE'
  | 'HUMAN_REVIEW'
  | 'SAFE_DEFAULT';

/** Ordered degradation tiers from highest capability to safest default. */
export const DEGRADATION_ORDER: readonly DegradationTier[] = [
  'PRIMARY',
  'SECONDARY',
  'RULES_ENGINE',
  'HUMAN_REVIEW',
  'SAFE_DEFAULT',
] as const;

/** Circuit breaker state machine states. */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Configuration for the circuit breaker pattern.
 *
 * Default thresholds: 3 consecutive failures → OPEN,
 * 10s timeout → HALF_OPEN, 1 success in HALF_OPEN → CLOSED.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;

  /** Time in milliseconds to wait before transitioning from OPEN to HALF_OPEN. */
  recoveryTimeoutMs: number;

  /** Number of successful requests in HALF_OPEN state to close the circuit. */
  successThreshold: number;

  /** Maximum number of requests allowed in HALF_OPEN state for probing. */
  halfOpenMaxRequests: number;

  /** Timeout in milliseconds for individual requests. */
  requestTimeoutMs: number;
}

/** Default circuit breaker configuration as specified in design. */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  recoveryTimeoutMs: 10_000,
  successThreshold: 1,
  halfOpenMaxRequests: 1,
  requestTimeoutMs: 5_000,
};

/**
 * Failure state inputs used to determine the appropriate degradation tier.
 * The same inputs should always produce the same tier selection (deterministic).
 */
export interface FailureState {
  /** Current circuit breaker state. */
  circuitState: CircuitBreakerState;

  /** Number of consecutive failures observed. */
  consecutiveFailures: number;

  /** Whether the failure is a timeout. */
  isTimeout: boolean;

  /** Whether capacity has been exceeded. */
  capacityExceeded: boolean;

  /** Current degradation tier (determines next fallback). */
  currentTier: DegradationTier;
}

/**
 * Service-level degradation configuration.
 * Each AI service has its own degradation policy specifying
 * the behaviour at each tier.
 */
export interface DegradationPolicy {
  /** Service identifier. */
  serviceId: string;

  /** Circuit breaker configuration for this service. */
  circuitBreaker: CircuitBreakerConfig;

  /** Configuration per degradation tier. */
  tiers: Record<DegradationTier, TierConfig>;
}

/** Configuration for a single degradation tier. */
export interface TierConfig {
  /** Whether this tier is enabled for this service. */
  enabled: boolean;

  /** Description of what this tier does for the service. */
  description: string;

  /** Maximum latency budget in milliseconds for this tier. */
  maxLatencyMs: number;

  /** Safe default response to return at SAFE_DEFAULT tier. */
  safeDefault?: unknown;
}

/**
 * Determines the next degradation tier given the current tier.
 * Returns undefined if already at the lowest tier (SAFE_DEFAULT).
 *
 * @param currentTier - The current active degradation tier
 * @returns The next tier in the fallback chain, or undefined if at bottom
 */
export function getNextDegradationTier(
  currentTier: DegradationTier
): DegradationTier | undefined {
  const currentIndex = DEGRADATION_ORDER.indexOf(currentTier);
  if (currentIndex === -1 || currentIndex >= DEGRADATION_ORDER.length - 1) {
    return undefined;
  }
  return DEGRADATION_ORDER[currentIndex + 1];
}
