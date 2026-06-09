/**
 * In-memory implementation of the Apache Iceberg-format audit store.
 *
 * This provides an immutable, append-only store with jurisdiction-scoped
 * partitioning. In production, this would be backed by Apache Iceberg
 * tables on S3-compatible object storage.
 *
 * Key properties:
 * - Append-only: no update or delete operations
 * - Jurisdiction-scoped partitions: data residency enforcement
 * - Time-partitioned: year/month for efficient range queries
 *
 * Validates: Requirements 28.1, 28.2, 28.4
 */
import type { Jurisdiction } from '@afg/shared-types';
import type { AuditArtefact, AuditQueryRequest, AuditQueryResponse, AuditStore, PartitionSpec } from './types.js';
/**
 * In-memory implementation of the AuditStore interface.
 * Simulates Apache Iceberg's immutable, append-only table format
 * with jurisdiction-scoped partitioning.
 */
export declare class IcebergAuditStore implements AuditStore {
    /**
     * Internal storage: jurisdiction → year → month → artefacts.
     * This mirrors Iceberg's partition layout.
     */
    private readonly partitions;
    /**
     * Append an artefact to the immutable store.
     * Once written, the artefact cannot be modified or deleted.
     */
    append(artefact: AuditArtefact): Promise<void>;
    /**
     * Query artefacts matching the given filters.
     * Jurisdiction is mandatory to enforce data residency; queries
     * can never cross jurisdictional boundaries.
     */
    query(request: AuditQueryRequest): Promise<AuditQueryResponse>;
    /**
     * Retrieve a single artefact by ID within a jurisdiction.
     * Returns null if not found.
     */
    getById(artefactId: string, jurisdiction: Jurisdiction): Promise<AuditArtefact | null>;
    /**
     * Get all partition specs for a given jurisdiction.
     */
    getPartitions(jurisdiction: Jurisdiction): Promise<PartitionSpec[]>;
    /**
     * Compute the partition key for an artefact.
     * Format: {jurisdiction}/{year}/{month}
     */
    private computePartitionKey;
}
//# sourceMappingURL=iceberg-store.d.ts.map