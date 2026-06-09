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
import type {
  AuditArtefact,
  AuditQueryRequest,
  AuditQueryResponse,
  AuditStore,
  PartitionSpec,
} from './types.js';

/**
 * In-memory implementation of the AuditStore interface.
 * Simulates Apache Iceberg's immutable, append-only table format
 * with jurisdiction-scoped partitioning.
 */
export class IcebergAuditStore implements AuditStore {
  /**
   * Internal storage: jurisdiction → year → month → artefacts.
   * This mirrors Iceberg's partition layout.
   */
  private readonly partitions: Map<string, AuditArtefact[]> = new Map();

  /**
   * Append an artefact to the immutable store.
   * Once written, the artefact cannot be modified or deleted.
   */
  async append(artefact: AuditArtefact): Promise<void> {
    const partitionKey = this.computePartitionKey(artefact);
    const partition = this.partitions.get(partitionKey);
    if (partition) {
      partition.push(Object.freeze({ ...artefact }));
    } else {
      this.partitions.set(partitionKey, [Object.freeze({ ...artefact })]);
    }
  }

  /**
   * Query artefacts matching the given filters.
   * Jurisdiction is mandatory to enforce data residency; queries
   * can never cross jurisdictional boundaries.
   */
  async query(request: AuditQueryRequest): Promise<AuditQueryResponse> {
    const { filters, maxResults } = request;
    const jurisdiction = filters.jurisdiction;

    // Collect artefacts from matching partitions
    let candidates: AuditArtefact[] = [];
    for (const [key, artefacts] of this.partitions.entries()) {
      if (key.startsWith(`${jurisdiction}/`)) {
        candidates = candidates.concat(artefacts);
      }
    }

    // Apply filters
    let results = candidates;

    if (filters.artefactId) {
      results = results.filter((a) => a.artefactId === filters.artefactId);
    }

    if (filters.customerId) {
      results = results.filter(
        (a) =>
          a.inputFeatures['customerId'] === filters.customerId ||
          a.inputFeatures['customer_id'] === filters.customerId
      );
    }

    if (filters.serviceId) {
      results = results.filter((a) => a.serviceId === filters.serviceId);
    }

    if (filters.dateRange) {
      const from = new Date(filters.dateRange.from).getTime();
      const to = new Date(filters.dateRange.to).getTime();
      results = results.filter((a) => {
        const ts = new Date(a.timestamp).getTime();
        return ts >= from && ts <= to;
      });
    }

    // Sort by timestamp descending (most recent first)
    results.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const truncated = results.length > maxResults;
    const artefacts = results.slice(0, maxResults);

    return {
      artefacts,
      totalCount: results.length,
      truncated,
    };
  }

  /**
   * Retrieve a single artefact by ID within a jurisdiction.
   * Returns null if not found.
   */
  async getById(
    artefactId: string,
    jurisdiction: Jurisdiction
  ): Promise<AuditArtefact | null> {
    for (const [key, artefacts] of this.partitions.entries()) {
      if (key.startsWith(`${jurisdiction}/`)) {
        const found = artefacts.find((a) => a.artefactId === artefactId);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Get all partition specs for a given jurisdiction.
   */
  async getPartitions(jurisdiction: Jurisdiction): Promise<PartitionSpec[]> {
    const specs: PartitionSpec[] = [];
    for (const key of this.partitions.keys()) {
      if (key.startsWith(`${jurisdiction}/`)) {
        const parts = key.split('/');
        specs.push({
          jurisdiction,
          year: parseInt(parts[1], 10),
          month: parseInt(parts[2], 10),
        });
      }
    }
    return specs;
  }

  /**
   * Compute the partition key for an artefact.
   * Format: {jurisdiction}/{year}/{month}
   */
  private computePartitionKey(artefact: AuditArtefact): string {
    const date = new Date(artefact.timestamp);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return `${artefact.jurisdiction}/${year}/${month}`;
  }
}
