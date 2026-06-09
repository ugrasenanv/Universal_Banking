/**
 * AML Triage Service Types
 *
 * Defines all interfaces for AML alert triage, narrative generation,
 * SAR draft preparation, and HITL enforcement.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Alert Triage Types
// ──────────────────────────────────────────────────────────────────────────────

/** Alert types supported by the AML Triage Service. */
export type AMLAlertType = 'TRANSACTION_MONITORING' | 'BEHAVIOUR' | 'NETWORK';

/** Disposition categories for triage classification. */
export type AMLDisposition = 'ESCALATE_L2' | 'RECOMMEND_CLOSURE' | 'INVESTIGATE';

/** Payload structure for an AML alert. */
export interface AlertPayload {
  /** Monetary amount associated with the alert (if applicable). */
  amount?: number;
  /** Currency of the transaction. */
  currency?: string;
  /** Alert generation timestamp. */
  alertTimestamp: ISO8601;
  /** Source system that generated the alert. */
  sourceSystem: string;
  /** Rule or scenario that triggered the alert. */
  triggerRule: string;
  /** Risk indicators present. */
  riskIndicators: string[];
  /** Related transaction IDs. */
  relatedTransactions: string[];
  /** Additional metadata. */
  metadata: Record<string, unknown>;
}

/** Request to triage an AML alert. */
export interface AMLTriageRequest {
  alertId: string;
  alertType: AMLAlertType;
  entityId: string;
  alertData: AlertPayload;
  /** Jurisdiction for data residency and regulatory context. */
  jurisdiction: Jurisdiction;
}

/** Response from alert triage classification. */
export interface AMLTriageResponse {
  alertId: string;
  disposition: AMLDisposition;
  priorityScore: number; // 1-100
  reasoningSummary: string;
  confidence: number; // 0.00-1.00
  auditArtefactId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Narrative Generation Types
// ──────────────────────────────────────────────────────────────────────────────

/** Scope of narrative generation. */
export type NarrativeScope = 'INVESTIGATION_NARRATIVE' | 'SAR_DRAFT';

/** Request to generate an investigation narrative or SAR draft. */
export interface NarrativeGenerationRequest {
  caseId: string;
  analystId: string;
  scope: NarrativeScope;
  /** Jurisdiction for data residency enforcement. */
  jurisdiction: Jurisdiction;
}

/** Citation from RAG-retrieved source material. */
export interface Citation {
  /** Source document name. */
  documentName: string;
  /** Section within the document. */
  section: string;
  /** Publication date of the source document. */
  publicationDate: ISO8601;
  /** Relevance score from retrieval. */
  relevanceScore: number;
  /** Chunk ID for traceability. */
  chunkId: string;
}

/** Response from narrative generation. */
export interface NarrativeGenerationResponse {
  caseId: string;
  narrative: string;
  citations: Citation[];
  groundednessScore: number; // 0.00-1.00
  requiresHumanApproval: boolean;
  auditArtefactId: string;
  /** Flags low-confidence content if groundedness below threshold. */
  lowConfidenceFlag: boolean;
  /** Data source availability status. */
  dataSourceStatus: DataSourceStatus;
}

/** Status of data sources during generation. */
export interface DataSourceStatus {
  allSourcesAvailable: boolean;
  unavailableSources: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// SAR Draft Types
// ──────────────────────────────────────────────────────────────────────────────

/** SAR filing request with mandatory analyst approval. */
export interface SARFilingRequest {
  caseId: string;
  analystId: string;
  narrativeId: string;
  /** Explicit analyst approval — MUST be true before filing. */
  analystApproval: boolean;
  /** Analyst confirmation of data gap awareness (if applicable). */
  dataGapAcknowledgement?: boolean;
  jurisdiction: Jurisdiction;
}

/** SAR filing response. */
export interface SARFilingResponse {
  caseId: string;
  filed: boolean;
  filingTimestamp?: ISO8601;
  rejectionReason?: string;
  auditArtefactId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Adapter Interfaces (for dependency injection)
// ──────────────────────────────────────────────────────────────────────────────

/** ML model adapter for alert classification. */
export interface AMLClassificationModelAdapter {
  /** Classify an alert and return disposition, priority, confidence. */
  classify(request: AMLTriageRequest): Promise<ClassificationResult>;
}

/** Raw classification result from the ML model. */
export interface ClassificationResult {
  disposition: AMLDisposition;
  priorityScore: number;
  confidence: number;
  reasoningFactors: string[];
}

/** RAG retrieval adapter for case history lookup. */
export interface AMLRAGAdapter {
  /** Retrieve case history context for narrative generation. */
  retrieveCaseHistory(
    caseId: string,
    tenantId: string,
    jurisdiction: Jurisdiction
  ): Promise<RAGCaseHistoryResult>;
}

/** Result from RAG case history retrieval. */
export interface RAGCaseHistoryResult {
  success: boolean;
  chunks: RAGChunk[];
  unavailableSources: string[];
  retrievalLatencyMs: number;
}

/** A single RAG-retrieved chunk. */
export interface RAGChunk {
  chunkId: string;
  content: string;
  source: {
    documentName: string;
    section: string;
    publicationDate: ISO8601;
  };
  relevanceScore: number;
}

/** LLM adapter for narrative text generation. */
export interface AMLNarrativeGeneratorAdapter {
  /** Generate a narrative from retrieved context. */
  generateNarrative(
    prompt: string,
    context: RAGChunk[],
    scope: NarrativeScope
  ): Promise<NarrativeResult>;
}

/** Raw narrative generation result. */
export interface NarrativeResult {
  narrative: string;
  groundednessScore: number;
}

/** Audit emitter interface for persisting audit artefacts. */
export interface AMLAuditEmitter {
  /** Emit an audit artefact and return its ID. */
  emit(artefact: AMLAuditArtefactInput): Promise<string>;
}

/** Audit artefact input specific to AML decisions. */
export interface AMLAuditArtefactInput {
  serviceId: string;
  timestamp: ISO8601;
  jurisdiction: Jurisdiction;
  modelVersion: string;
  inputFeatures: Record<string, unknown>;
  prompt?: string;
  retrievedContext?: Array<{
    chunkId: string;
    content: string;
    source: { documentName: string; section: string; publicationDate: ISO8601 };
    relevanceScore: number;
  }>;
  modelOutput: unknown;
  confidenceScore: number;
  decision: string;
  /** Analyst decision (for HITL artefacts). */
  analystDecision?: string;
  /** Full context payload. */
  contextPayload?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

/** Configuration for the AML Triage Service. */
export interface AMLTriageConfig {
  /** Service identifier for audit trail. */
  serviceId: string;
  /** Model version string. */
  modelVersion: string;
  /** Groundedness score threshold below which content is flagged. */
  groundednessThreshold: number;
  /** Maximum time in ms for narrative generation (default: 60000). */
  narrativeTimeoutMs: number;
  /** Tenant ID for RAG retrieval scoping. */
  tenantId: string;
}

/** Default configuration values. */
export const DEFAULT_AML_TRIAGE_CONFIG: AMLTriageConfig = {
  serviceId: 'aml-triage-service',
  modelVersion: '1.0.0',
  groundednessThreshold: 0.70,
  narrativeTimeoutMs: 60_000,
  tenantId: 'aml-default',
};
