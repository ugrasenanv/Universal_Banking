/**
 * Platform event schemas for the streaming backbone.
 *
 * Implements the standard event envelope (PlatformEvent<T>) and dead-letter
 * event schema as specified in the design document's Streaming Backbone section.
 *
 * Validates: Requirements 24.1
 */

import type { ISO8601, Jurisdiction } from './domain-types.js';

/**
 * Standard platform event envelope for all Kafka messages.
 *
 * All events flowing through the streaming backbone use this envelope
 * to ensure consistent metadata, tracing, and schema versioning.
 */
export interface PlatformEvent<T> {
  /** UUID v7 (time-ordered) for natural ordering and uniqueness. */
  eventId: string;

  /** Fully-qualified event type (e.g., 'fraud.scores.computed'). */
  eventType: string;

  /** Schema version for evolution compatibility (semver format). */
  version: string;

  /** ISO 8601 timestamp of event creation. */
  timestamp: ISO8601;

  /** Service identifier that produced this event. */
  source: string;

  /** Jurisdiction where the event originated (data residency). */
  jurisdiction: Jurisdiction;

  /** Tenant identifier for multi-tenant isolation. */
  tenantId: string;

  /** Correlation ID linking related business events. */
  correlationId: string;

  /** OpenTelemetry trace ID for distributed tracing. */
  traceId: string;

  /** The domain-specific payload. */
  payload: T;
}

/**
 * Dead-letter event envelope.
 *
 * When a message fails processing after configured retries (3 retries
 * with exponential backoff), it is routed to the dead-letter topic
 * wrapped in this envelope with diagnostic context.
 */
export interface DeadLetterEvent {
  /** The original event that failed processing. */
  originalEvent: PlatformEvent<unknown>;

  /** Human-readable description of why processing failed. */
  failureReason: string;

  /** Number of retry attempts before dead-lettering. */
  retryCount: number;

  /** Timestamp of the last processing attempt. */
  lastAttempt: ISO8601;

  /** Optional stack trace for debugging. */
  stackTrace?: string;
}
