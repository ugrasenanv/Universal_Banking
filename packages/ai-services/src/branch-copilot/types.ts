/**
 * Branch Copilot Types
 *
 * Defines interfaces for the Branch Copilot service that provides
 * policy/circular/product corpus RAG with hybrid retrieval, mandatory
 * source citations, confidence-based refusal, and incremental updates.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import type { ISO8601, LanguageCode } from '@afg/shared-types';

// ============================================================================
// Source Citation Types (Requirement 12.1)
// ============================================================================

/** A citation referencing the source document, section, and effective date. */
export interface SourceCitation {
  /** Name of the policy, circular, or product document. */
  documentName: string;
  /** Specific section within the document. */
  section: string;
  /** Effective/publication date of the document. */
  effectiveDate: ISO8601;
  /** Relevance score from retrieval (0.0-1.0). */
  relevanceScore: number;
}

// ============================================================================
// Query & Response Types (Requirements 12.1, 12.2, 12.3)
// ============================================================================

/** Corpus categories supported by the Branch Copilot. */
export type BranchCorpusCategory = 'POLICY' | 'CIRCULAR' | 'PRODUCT';

/** Request to query the Branch Copilot. */
export interface BranchCopilotQuery {
  /** Unique query identifier. */
  queryId: string;
  /** The staff member's question. */
  question: string;
  /** Tenant/branch identifier for isolation. */
  tenantId: string;
  /** Optional: filter to specific corpus categories. */
  corpusCategories?: BranchCorpusCategory[];
  /** Optional: language of the query (auto-detected if absent). */
  language?: LanguageCode;
  /** Optional: max number of source citations to include. */
  maxCitations?: number;
}

/** Successful answer from the Branch Copilot with mandatory citations. */
export interface BranchCopilotAnswer {
  /** Unique query identifier (echo from request). */
  queryId: string;
  /** Generated answer grounded in retrieved sources. */
  answer: string;
  /** Mandatory source citations for the answer. */
  citations: SourceCitation[];
  /** Retrieval confidence/groundedness score (0.0-1.0). */
  confidenceScore: number;
  /** Total processing latency in milliseconds. */
  latencyMs: number;
  /** Whether the answer was refused due to low confidence. */
  refused: false;
}

/** Refusal response when retrieval confidence is below threshold. */
export interface BranchCopilotRefusal {
  /** Unique query identifier (echo from request). */
  queryId: string;
  /** Explanation of why the system cannot answer. */
  reason: string;
  /** The retrieval confidence score that triggered refusal. */
  confidenceScore: number;
  /** Configured threshold that was not met. */
  threshold: number;
  /** Escalation channel to direct the staff member to. */
  escalationChannel: string;
  /** Total processing latency in milliseconds. */
  latencyMs: number;
  /** Discriminator for refusal responses. */
  refused: true;
}

/** Union type for Branch Copilot query results. */
export type BranchCopilotResponse = BranchCopilotAnswer | BranchCopilotRefusal;

/** Type guard to check if a response is a refusal. */
export function isBranchCopilotRefusal(
  response: BranchCopilotResponse
): response is BranchCopilotRefusal {
  return response.refused === true;
}

// ============================================================================
// Corpus Update Types (Requirement 12.4)
// ============================================================================

/** Status of a corpus update operation. */
export type CorpusUpdateStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

/** A document to be added or updated in the branch copilot corpus. */
export interface BranchCorpusDocument {
  /** Unique document identifier. */
  documentId: string;
  /** Document name/title. */
  documentName: string;
  /** Full text content of the document. */
  content: string;
  /** Category of the document. */
  category: BranchCorpusCategory;
  /** Effective/publication date of the document. */
  effectiveDate: ISO8601;
  /** Language of the document content. */
  language: LanguageCode;
}

/** Request to update the branch copilot corpus incrementally. */
export interface BranchCorpusUpdateRequest {
  /** Tenant/branch identifier. */
  tenantId: string;
  /** Documents to add or update. */
  documents: BranchCorpusDocument[];
  /** Document IDs to remove from the corpus. */
  removals?: string[];
}

/** Result of a corpus update operation. */
export interface BranchCorpusUpdateResult {
  /** Unique update operation identifier. */
  updateId: string;
  /** Current status of the update. */
  status: CorpusUpdateStatus;
  /** Number of documents processed. */
  documentsProcessed: number;
  /** Number of documents removed. */
  documentsRemoved: number;
  /** Time taken in milliseconds. */
  processingTimeMs: number;
  /** Deadline by which update must complete (1 hour from scheduling). */
  deadline: ISO8601;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** Configuration for the Branch Copilot service. */
export interface BranchCopilotConfig {
  /** Groundedness/confidence threshold for refusal (default 0.70). */
  confidenceThreshold: number;
  /** Maximum response latency target in milliseconds (default 10000). */
  maxLatencyMs: number;
  /** Default number of citations to include (default 3). */
  defaultMaxCitations: number;
  /** Default escalation channel when refusing queries. */
  defaultEscalationChannel: string;
  /** Maximum time for incremental updates in milliseconds (1 hour). */
  maxUpdateTimeMs: number;
  /** Corpus IDs mapped to categories for retrieval filtering. */
  corpusCategoryMapping: Record<BranchCorpusCategory, string>;
}

/** Default Branch Copilot configuration. */
export const DEFAULT_BRANCH_COPILOT_CONFIG: BranchCopilotConfig = {
  confidenceThreshold: 0.70,
  maxLatencyMs: 10_000,
  defaultMaxCitations: 3,
  defaultEscalationChannel: 'branch-ops-helpdesk',
  maxUpdateTimeMs: 60 * 60 * 1000, // 1 hour
  corpusCategoryMapping: {
    POLICY: 'branch-policies',
    CIRCULAR: 'branch-circulars',
    PRODUCT: 'branch-products',
  },
};

// ============================================================================
// Adapter Interfaces
// ============================================================================

/** Adapter for LLM-based answer generation grounded in retrieved context. */
export interface BranchAnswerGeneratorAdapter {
  /**
   * Generate an answer to the question using the provided context chunks.
   * The response must be grounded in the provided evidence.
   */
  generateAnswer(
    question: string,
    contextChunks: Array<{ content: string; source: SourceCitation }>,
    language?: LanguageCode
  ): Promise<{ answer: string; latencyMs: number }>;
}

/** Adapter for the retrieval engine used by Branch Copilot. */
export interface BranchRetrievalAdapter {
  /**
   * Perform hybrid retrieval (BM25 + dense vector) for the given query.
   * Returns retrieved chunks with relevance scores and groundedness.
   */
  retrieve(params: {
    query: string;
    queryLanguage: LanguageCode;
    tenantId: string;
    corpusIds: string[];
    topK: number;
  }): Promise<BranchRetrievalResult>;
}

/** Result from the retrieval adapter. */
export interface BranchRetrievalResult {
  /** Retrieved chunks with source metadata and relevance scores. */
  chunks: Array<{
    chunkId: string;
    content: string;
    source: {
      documentName: string;
      section: string;
      publicationDate: ISO8601;
    };
    relevanceScore: number;
    language: LanguageCode;
  }>;
  /** Groundedness score computed over retrieved evidence (0.0-1.0). */
  groundednessScore: number;
  /** Retrieval latency in milliseconds. */
  retrievalLatencyMs: number;
}

/** Adapter for incremental corpus updates. */
export interface BranchCorpusUpdateAdapter {
  /**
   * Ingest a document into the corpus without full re-index.
   * Returns the number of chunks created.
   */
  ingestDocument(params: {
    documentId: string;
    documentName: string;
    content: string;
    tenantId: string;
    corpusId: string;
    language: LanguageCode;
    publicationDate: ISO8601;
  }): Promise<{ chunksCreated: number; processingTimeMs: number }>;

  /**
   * Remove a document from the corpus.
   */
  removeDocument(documentId: string, tenantId: string): Promise<void>;
}
