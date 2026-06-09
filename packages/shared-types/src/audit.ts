/**
 * Audit artefact types and integrity utilities.
 *
 * Every customer-impacting AI decision emits an immutable audit artefact
 * before returning a response. Artefacts are retained for 7 years with
 * SHA-256 cryptographic integrity verification.
 *
 * Validates: Requirements 28.1, 28.3
 */

import { createHash } from 'node:crypto';
import type { ISO8601, Jurisdiction } from './domain-types.js';

/** Feature attribution explaining a model's decision factor. */
export interface FeatureAttribution {
  featureName: string;
  attributionWeight: number;
  featureValue: unknown;
  rank: number;
}

/** Record of a human override on an AI decision. */
export interface HumanOverrideRecord {
  overrideBy: string;
  overrideTimestamp: ISO8601;
  originalDecision: string;
  overriddenDecision: string;
  rationale: string;
}

/** Retrieved chunk reference for RAG context audit trail. */
export interface RetrievedChunkRef {
  chunkId: string;
  content: string;
  source: {
    documentName: string;
    section: string;
    publicationDate: ISO8601;
  };
  relevanceScore: number;
}

/**
 * Immutable audit artefact for every AI/ML decision.
 *
 * Captures the complete decision chain: inputs, model context,
 * output, confidence, and human oversight. Stored in append-only
 * format with cryptographic integrity hashing.
 */
export interface AuditArtefact {
  /** Unique identifier for this artefact. */
  artefactId: string;

  /** Timestamp of artefact creation. */
  timestamp: ISO8601;

  /** Jurisdiction where this decision was made. */
  jurisdiction: Jurisdiction;

  /** Service that produced this decision. */
  serviceId: string;

  /** Version of the model used for inference. */
  modelVersion: string;

  /** Input features provided to the model. */
  inputFeatures: Record<string, unknown>;

  /** The prompt sent to the model (if LLM-based). */
  prompt?: string;

  /** RAG-retrieved context used in generation. */
  retrievedContext?: RetrievedChunkRef[];

  /** Raw model output. */
  modelOutput: unknown;

  /** Model confidence score (0.00 - 1.00). */
  confidenceScore: number;

  /** The decision rendered (e.g., 'APPROVE', 'DECLINE', 'HOLD'). */
  decision: string;

  /** Human override record if the decision was overridden. */
  humanOverride?: HumanOverrideRecord;

  /** Feature attributions explaining the decision. */
  explanation?: FeatureAttribution[];

  /** Retention expiry date (7 years from creation). */
  retentionExpiryDate: ISO8601;

  /** SHA-256 hash of artefact content for tamper detection. */
  integrityHash: string;
}

/** Retention period for audit artefacts: 7 years in milliseconds. */
const RETENTION_YEARS = 7;

/**
 * Computes the retention expiry date (7 years from the given timestamp).
 */
export function computeRetentionExpiry(creationTimestamp: ISO8601): ISO8601 {
  const date = new Date(creationTimestamp);
  date.setFullYear(date.getFullYear() + RETENTION_YEARS);
  return date.toISOString();
}

/**
 * Computes the SHA-256 integrity hash for an audit artefact.
 *
 * The hash covers all content fields (excluding the integrityHash field itself)
 * to enable tamper detection. Fields are serialised in a deterministic order
 * to ensure reproducible hashes.
 *
 * @param artefact - The audit artefact (integrityHash field is excluded from computation)
 * @returns Hex-encoded SHA-256 hash string
 */
export function computeIntegrityHash(
  artefact: Omit<AuditArtefact, 'integrityHash'>
): string {
  const content = buildHashContent(artefact);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Verifies the integrity of a stored audit artefact by recomputing
 * the hash and comparing against the stored value.
 *
 * @param artefact - The complete audit artefact with stored integrityHash
 * @returns true if the stored hash matches the recomputed hash
 */
export function verifyIntegrity(artefact: AuditArtefact): boolean {
  const { integrityHash, ...content } = artefact;
  const computedHash = computeIntegrityHash(content);
  return computedHash === integrityHash;
}

/**
 * Builds a deterministic string representation of artefact content
 * for hash computation. Uses sorted JSON keys to ensure reproducibility.
 */
function buildHashContent(
  artefact: Omit<AuditArtefact, 'integrityHash'>
): string {
  const ordered: Record<string, unknown> = {
    artefactId: artefact.artefactId,
    timestamp: artefact.timestamp,
    jurisdiction: artefact.jurisdiction,
    serviceId: artefact.serviceId,
    modelVersion: artefact.modelVersion,
    inputFeatures: artefact.inputFeatures,
    prompt: artefact.prompt ?? null,
    retrievedContext: artefact.retrievedContext ?? null,
    modelOutput: artefact.modelOutput,
    confidenceScore: artefact.confidenceScore,
    decision: artefact.decision,
    humanOverride: artefact.humanOverride ?? null,
    explanation: artefact.explanation ?? null,
    retentionExpiryDate: artefact.retentionExpiryDate,
  };
  return JSON.stringify(ordered, null, 0);
}
