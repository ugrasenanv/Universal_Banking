/**
 * Audit Service — immutable, tamper-evident audit log for all AI/ML decisions.
 *
 * Responsibilities:
 * - Persist every AI decision artefact with cryptographic integrity
 * - Enforce jurisdiction-scoped data residency via partitioning
 * - Compute and verify SHA-256 integrity hashes
 * - Enforce 7-year retention policy
 * - Provide query API with rich filtering
 *
 * Storage: Append-only Apache Iceberg format with no update/delete.
 * Partitioning: jurisdiction/year/month
 * Integrity: SHA-256 hash computed over artefact content (excluding hash field itself)
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 18.5
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';
import {
  computeIntegrityHash,
  computeRetentionExpiry,
  verifyIntegrity,
} from '@afg/shared-types';
import type {
  AuditArtefact,
  AuditQueryRequest,
  AuditQueryResponse,
  AuditStore,
  IntegrityVerificationResult,
} from './types.js';

/** Input to persist a new audit artefact (hash and retention are computed). */
export type AuditArtefactInput = Omit<AuditArtefact, 'integrityHash' | 'retentionExpiryDate'>;

/**
 * AuditService provides the core audit functionality for the platform.
 *
 * Every customer-impacting AI decision MUST be persisted via this service
 * before returning a response to the caller (audit-first design principle).
 */
export class AuditService {
  private readonly store: AuditStore;

  constructor(store: AuditStore) {
    this.store = store;
  }

  /**
   * Persist a new audit artefact.
   *
   * Computes the 7-year retention expiry date and SHA-256 integrity hash,
   * then appends the artefact to the immutable store.
   *
   * @param input - Artefact data without hash and retention (computed automatically)
   * @returns The complete artefact with computed fields
   * @throws Error if artefactId is missing or jurisdiction is invalid
   */
  async persist(input: AuditArtefactInput): Promise<AuditArtefact> {
    this.validateInput(input);

    // Compute 7-year retention expiry from artefact creation timestamp
    const retentionExpiryDate = computeRetentionExpiry(input.timestamp);

    // Build the content for hashing (everything except integrityHash)
    const contentForHash: Omit<AuditArtefact, 'integrityHash'> = {
      ...input,
      retentionExpiryDate,
    };

    // Compute SHA-256 integrity hash
    const integrityHash = computeIntegrityHash(contentForHash);

    // Assemble the complete artefact
    const artefact: AuditArtefact = {
      ...contentForHash,
      integrityHash,
    };

    // Append to immutable store (no update/delete possible)
    await this.store.append(artefact);

    return artefact;
  }

  /**
   * Query audit artefacts with filters.
   *
   * Jurisdiction is mandatory to enforce data residency — queries
   * cannot cross jurisdictional boundaries.
   */
  async query(request: AuditQueryRequest): Promise<AuditQueryResponse> {
    if (!request.filters.jurisdiction) {
      throw new Error('Jurisdiction filter is mandatory for audit queries');
    }
    if (request.maxResults <= 0) {
      throw new Error('maxResults must be a positive integer');
    }

    return this.store.query(request);
  }

  /**
   * Retrieve a single artefact by ID within a jurisdiction.
   */
  async getById(
    artefactId: string,
    jurisdiction: Jurisdiction
  ): Promise<AuditArtefact | null> {
    return this.store.getById(artefactId, jurisdiction);
  }

  /**
   * Verify the cryptographic integrity of a stored artefact.
   *
   * Recomputes the SHA-256 hash from artefact content and compares
   * against the stored hash. Any tampering will cause verification to fail.
   */
  async verifyIntegrity(
    artefactId: string,
    jurisdiction: Jurisdiction
  ): Promise<IntegrityVerificationResult> {
    const artefact = await this.store.getById(artefactId, jurisdiction);
    if (!artefact) {
      throw new Error(
        `Artefact not found: ${artefactId} in jurisdiction ${jurisdiction}`
      );
    }

    const { integrityHash, ...content } = artefact;
    const computedHash = computeIntegrityHash(content);

    return {
      artefactId,
      valid: verifyIntegrity(artefact),
      storedHash: integrityHash,
      computedHash,
    };
  }

  /**
   * Check whether an artefact's retention period has expired.
   *
   * @param artefact - The artefact to check
   * @param asOf - The reference date (defaults to now)
   * @returns true if the retention period has expired
   */
  isRetentionExpired(artefact: AuditArtefact, asOf?: ISO8601): boolean {
    const referenceDate = asOf ? new Date(asOf) : new Date();
    const expiryDate = new Date(artefact.retentionExpiryDate);
    return referenceDate >= expiryDate;
  }

  /**
   * Validate input data before persisting.
   */
  private validateInput(input: AuditArtefactInput): void {
    if (!input.artefactId || input.artefactId.trim() === '') {
      throw new Error('artefactId is required');
    }
    if (!input.timestamp) {
      throw new Error('timestamp is required');
    }
    if (!input.jurisdiction) {
      throw new Error('jurisdiction is required');
    }
    if (!input.serviceId || input.serviceId.trim() === '') {
      throw new Error('serviceId is required');
    }
    if (!input.modelVersion) {
      throw new Error('modelVersion is required');
    }
    if (input.confidenceScore < 0 || input.confidenceScore > 1) {
      throw new Error('confidenceScore must be between 0.00 and 1.00');
    }
    if (!input.decision || input.decision.trim() === '') {
      throw new Error('decision is required');
    }
  }
}
