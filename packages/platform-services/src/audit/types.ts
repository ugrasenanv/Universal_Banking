/**
 * Audit Service types and interfaces.
 *
 * Defines the query API, storage abstractions, and partition
 * metadata for the immutable audit log.
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 18.5
 */

import type { DateRange, ISO8601, Jurisdiction } from '@afg/shared-types';
import type { AuditArtefact } from '@afg/shared-types';

export type { AuditArtefact };

/**
 * Query request for retrieving audit artefacts.
 * Jurisdiction is mandatory to enforce data residency.
 */
export interface AuditQueryRequest {
  filters: {
    artefactId?: string;
    customerId?: string;
    serviceId?: string;
    dateRange?: DateRange;
    jurisdiction: Jurisdiction;
  };
  maxResults: number;
}

/** Result of an audit query. */
export interface AuditQueryResponse {
  artefacts: AuditArtefact[];
  totalCount: number;
  truncated: boolean;
}

/** Integrity verification result for a single artefact. */
export interface IntegrityVerificationResult {
  artefactId: string;
  valid: boolean;
  storedHash: string;
  computedHash: string;
}

/**
 * Partition metadata for the Apache Iceberg table.
 * Artefacts are partitioned by jurisdiction and date for
 * data residency compliance and query performance.
 */
export interface PartitionSpec {
  jurisdiction: Jurisdiction;
  year: number;
  month: number;
}

/**
 * Represents the storage layer abstraction for the audit store.
 * Implementations may use Apache Iceberg, local file store, or
 * in-memory store for testing.
 */
export interface AuditStore {
  /** Append an artefact to the immutable store. */
  append(artefact: AuditArtefact): Promise<void>;

  /** Query artefacts matching the given request filters. */
  query(request: AuditQueryRequest): Promise<AuditQueryResponse>;

  /** Retrieve a single artefact by ID and jurisdiction. */
  getById(artefactId: string, jurisdiction: Jurisdiction): Promise<AuditArtefact | null>;

  /** Get partition info for a given jurisdiction. */
  getPartitions(jurisdiction: Jurisdiction): Promise<PartitionSpec[]>;
}
