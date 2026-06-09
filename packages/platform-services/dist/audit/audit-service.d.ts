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
import type { AuditArtefact, AuditQueryRequest, AuditQueryResponse, AuditStore, IntegrityVerificationResult } from './types.js';
/** Input to persist a new audit artefact (hash and retention are computed). */
export type AuditArtefactInput = Omit<AuditArtefact, 'integrityHash' | 'retentionExpiryDate'>;
/**
 * AuditService provides the core audit functionality for the platform.
 *
 * Every customer-impacting AI decision MUST be persisted via this service
 * before returning a response to the caller (audit-first design principle).
 */
export declare class AuditService {
    private readonly store;
    constructor(store: AuditStore);
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
    persist(input: AuditArtefactInput): Promise<AuditArtefact>;
    /**
     * Query audit artefacts with filters.
     *
     * Jurisdiction is mandatory to enforce data residency — queries
     * cannot cross jurisdictional boundaries.
     */
    query(request: AuditQueryRequest): Promise<AuditQueryResponse>;
    /**
     * Retrieve a single artefact by ID within a jurisdiction.
     */
    getById(artefactId: string, jurisdiction: Jurisdiction): Promise<AuditArtefact | null>;
    /**
     * Verify the cryptographic integrity of a stored artefact.
     *
     * Recomputes the SHA-256 hash from artefact content and compares
     * against the stored hash. Any tampering will cause verification to fail.
     */
    verifyIntegrity(artefactId: string, jurisdiction: Jurisdiction): Promise<IntegrityVerificationResult>;
    /**
     * Check whether an artefact's retention period has expired.
     *
     * @param artefact - The artefact to check
     * @param asOf - The reference date (defaults to now)
     * @returns true if the retention period has expired
     */
    isRetentionExpired(artefact: AuditArtefact, asOf?: ISO8601): boolean;
    /**
     * Validate input data before persisting.
     */
    private validateInput;
}
//# sourceMappingURL=audit-service.d.ts.map