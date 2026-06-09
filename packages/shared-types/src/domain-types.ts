/**
 * Core domain types for the AFG AI/ML Banking Platform.
 *
 * These types provide the foundational vocabulary shared across
 * all platform services and jurisdictions.
 */

/** Supported jurisdictions for data residency and regulatory compliance. */
export type Jurisdiction = 'IN' | 'SG' | 'AE' | 'GB' | 'US';

/** ISO 4217 currency codes commonly used across AFG operations. */
export type CurrencyCode =
  | 'INR'
  | 'SGD'
  | 'AED'
  | 'GBP'
  | 'USD'
  | 'EUR'
  | 'JPY'
  | 'HKD'
  | 'CHF'
  | 'AUD';

/** ISO 8601 date-time string. */
export type ISO8601 = string;

/** Reference to a customer, account, or other platform entity. */
export interface EntityRef {
  entityId: string;
  entityType: 'CUSTOMER' | 'ACCOUNT' | 'MERCHANT' | 'TRANSACTION';
  jurisdiction: Jurisdiction;
}

/** BCP 47 language codes for multilingual support (11 languages). */
export type LanguageCode =
  | 'en'
  | 'hi'
  | 'ta'
  | 'te'
  | 'kn'
  | 'ml'
  | 'mr'
  | 'bn'
  | 'gu'
  | 'zh'
  | 'ar';

/**
 * Cost tier for LLM routing decisions.
 * Maps to model size and hosting mode:
 * - LOW: Small self-hosted models (7B-13B params)
 * - MEDIUM: Medium self-hosted models (30B-70B params)
 * - HIGH: Frontier API models
 * - PREMIUM: Specialised fine-tuned frontier models
 */
export type CostTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'PREMIUM';

/**
 * Quality tier for LLM routing decisions.
 * Represents the minimum acceptable output quality:
 * - BASIC: Simple classification, extraction
 * - STANDARD: Structured generation, summarisation
 * - HIGH: Complex reasoning, analysis
 * - FRONTIER: Advanced multi-step reasoning, creative generation
 */
export type QualityTier = 'BASIC' | 'STANDARD' | 'HIGH' | 'FRONTIER';

/** Date range filter used across query interfaces. */
export interface DateRange {
  from: ISO8601;
  to: ISO8601;
}
