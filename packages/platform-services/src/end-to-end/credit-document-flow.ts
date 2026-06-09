/**
 * Credit and Document Flows — End-to-End Wiring
 *
 * Connects the following service chains:
 * 1. Credit applications → Credit Underwriting → Feature Store → Human Review → Audit
 * 2. Document submission → Document Intelligence → Human Review → Audit
 * 3. NBA Engine → Feature Store → LLM Gateway → Audit
 *
 * This module integrates multiple services into coherent end-to-end flows,
 * handling error propagation, audit-first requirements, and human review gates.
 *
 * Validates: Requirements 5.1, 9.1, 11.1
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ──────────────────────────────────────────────────────────────────────────────
// Adapter Interfaces (service abstractions for wiring)
// ──────────────────────────────────────────────────────────────────────────────

/** Adapter for the Credit Underwriting Service. */
export interface CreditUnderwritingAdapter {
  processApplication(request: CreditApplicationInput): Promise<CreditDecisionOutput>;
}

/** Adapter for the Feature Store. */
export interface FeatureStoreAdapter {
  getFeatures(request: FeatureRetrievalRequest): Promise<FeatureRetrievalResponse>;
}

/** Adapter for the Human Review Queue. */
export interface HumanReviewAdapter {
  submitForReview(request: HumanReviewSubmission): Promise<HumanReviewResult>;
  isApproved(reviewId: string): Promise<boolean>;
}

/** Adapter for the Audit Service. */
export interface AuditAdapter {
  persist(artefact: AuditArtefactInput): Promise<string>;
}

/** Adapter for the Document Intelligence Service. */
export interface DocumentIntelligenceAdapter {
  extractDocument(request: DocumentSubmissionInput): Promise<DocumentExtractionOutput>;
}

/** Adapter for the NBA Engine. */
export interface NBAEngineAdapter {
  getMobileRecommendations(request: NBARecommendationInput): Promise<NBARecommendationOutput>;
}

/** Adapter for the LLM Gateway. */
export interface LLMGatewayAdapter {
  infer(request: LLMInferenceInput): Promise<LLMInferenceOutput>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Flow Input/Output Types
// ──────────────────────────────────────────────────────────────────────────────

/** Input for a credit application flow. */
export interface CreditApplicationInput {
  applicationId: string;
  applicationType: 'RETAIL_UNSECURED' | 'SME_WORKING_CAPITAL';
  customerId: string;
  jurisdiction: Jurisdiction;
  alternateDataConsent: boolean;
  applicantData: Record<string, unknown>;
}

/** Output from the credit underwriting adapter. */
export interface CreditDecisionOutput {
  applicationId: string;
  decision: 'APPROVE' | 'DECLINE' | 'REFER_TO_HUMAN';
  creditScore: number;
  confidence: number;
  riskFactors: CreditRiskFactor[];
  modelVersion: string;
  alternateDataUsed: boolean;
}

/** Risk factor from credit underwriting. */
export interface CreditRiskFactor {
  factorName: string;
  weight: number;
  explanation: string;
  rank: number;
}

/** Feature retrieval request. */
export interface FeatureRetrievalRequest {
  entityId: string;
  entityType: 'CUSTOMER' | 'ACCOUNT' | 'TRANSACTION' | 'MERCHANT';
  featureGroups: string[];
  timestamp?: ISO8601;
}

/** Feature retrieval response. */
export interface FeatureRetrievalResponse {
  entityId: string;
  features: Record<string, unknown>;
  freshnessTimestamp: ISO8601;
  latencyMs: number;
}

/** Submission to human review queue. */
export interface HumanReviewSubmission {
  useCase: string;
  jurisdiction: Jurisdiction;
  isHighImpact: boolean;
  highImpactActionType?: 'CREDIT_DECLINE' | 'CREDIT_LINE_REDUCTION';
  confidenceScore: number;
  aiDecision: string;
  decisionChain: {
    modelVersion: string;
    sourceServiceId: string;
    entityId: string;
    context: Record<string, unknown>;
    modelOutput: unknown;
  };
}

/** Result from human review queue submission. */
export interface HumanReviewResult {
  reviewId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  queuedAt: ISO8601;
}

/** Audit artefact input for persistence. */
export interface AuditArtefactInput {
  artefactId: string;
  timestamp: ISO8601;
  jurisdiction: Jurisdiction;
  serviceId: string;
  modelVersion: string;
  inputFeatures: Record<string, unknown>;
  modelOutput: unknown;
  confidenceScore: number;
  decision: string;
  explanation?: string;
}

/** Document submission input. */
export interface DocumentSubmissionInput {
  documentId: string;
  documentType: 'NATIONAL_ID' | 'PASSPORT' | 'UTILITY_BILL' | 'LETTER_OF_CREDIT' | 'BILL_OF_LADING' | 'COMMERCIAL_INVOICE' | 'BANK_GUARANTEE';
  binary: Buffer;
  expectedFields?: string[];
  jurisdiction: Jurisdiction;
}

/** Output from document extraction. */
export interface DocumentExtractionOutput {
  documentId: string;
  extractedFields: DocumentExtractedField[];
  overallConfidence: number;
  processingTimeMs: number;
  requiresHumanReview: boolean;
  flaggedFields: string[];
  auditArtefactId: string;
}

/** A single extracted field from a document. */
export interface DocumentExtractedField {
  fieldName: string;
  value: string;
  confidence: number;
  needsReview: boolean;
}

/** NBA recommendation input. */
export interface NBARecommendationInput {
  customerId: string;
  segment: string;
  channel: 'MOBILE_APP';
  jurisdiction: Jurisdiction;
  maxRecommendations?: number;
  requestTimestamp: ISO8601;
}

/** NBA recommendation output. */
export interface NBARecommendationOutput {
  customerId: string;
  recommendations: NBARecommendation[];
  processingTimeMs: number;
  signalsFresh: boolean;
  auditArtefactId: string;
}

/** A single NBA recommendation. */
export interface NBARecommendation {
  recommendationId: string;
  productCategory: string;
  productName: string;
  relevanceScore: number;
  reasoning: string;
  rank: number;
}

/** LLM inference input. */
export interface LLMInferenceInput {
  requestId: string;
  promptRegistryId: string;
  promptVersion: string;
  variables: Record<string, unknown>;
  tenantId: string;
  jurisdiction: Jurisdiction;
  routingHints: {
    maxLatencyMs: number;
    costCeiling: string;
    qualityFloor: string;
  };
}

/** LLM inference output. */
export interface LLMInferenceOutput {
  requestId: string;
  output: string;
  modelId: string;
  modelVersion: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  latencyMs: number;
  costUnits: number;
  auditArtefactId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// End-to-End Flow Results
// ──────────────────────────────────────────────────────────────────────────────

/** Status of the end-to-end flow. */
export type FlowStatus = 'COMPLETED' | 'PENDING_REVIEW' | 'FAILED';

/** Result of the credit application end-to-end flow. */
export interface CreditFlowResult {
  status: FlowStatus;
  applicationId: string;
  decision: 'APPROVE' | 'DECLINE' | 'REFER_TO_HUMAN';
  creditScore: number;
  confidence: number;
  riskFactors: CreditRiskFactor[];
  featureLatencyMs: number;
  humanReviewId?: string;
  auditArtefactId: string;
  totalProcessingMs: number;
}

/** Result of the document submission end-to-end flow. */
export interface DocumentFlowResult {
  status: FlowStatus;
  documentId: string;
  extractedFields: DocumentExtractedField[];
  overallConfidence: number;
  humanReviewId?: string;
  auditArtefactId: string;
  totalProcessingMs: number;
}

/** Result of the NBA engine end-to-end flow. */
export interface NBAFlowResult {
  status: FlowStatus;
  customerId: string;
  recommendations: NBARecommendation[];
  llmEnrichment?: {
    output: string;
    modelId: string;
    latencyMs: number;
  };
  featureLatencyMs: number;
  auditArtefactId: string;
  totalProcessingMs: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

/** Configuration for the credit-document flow orchestrator. */
export interface CreditDocumentFlowConfig {
  /** Confidence threshold below which credit decisions route to human review. */
  creditConfidenceThreshold: number;
  /** Confidence threshold below which document extractions route to human review. */
  documentConfidenceThreshold: number;
  /** Feature groups to fetch for credit decisions. */
  creditFeatureGroups: string[];
  /** Feature groups to fetch for NBA engine. */
  nbaFeatureGroups: string[];
  /** LLM prompt registry ID for NBA enrichment. */
  nbaLLMPromptRegistryId: string;
  /** LLM prompt version for NBA enrichment. */
  nbaLLMPromptVersion: string;
  /** Tenant ID for LLM calls. */
  tenantId: string;
}

/** Default configuration. */
export const DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG: CreditDocumentFlowConfig = {
  creditConfidenceThreshold: 0.70,
  documentConfidenceThreshold: 0.85,
  creditFeatureGroups: ['bureau_score', 'alternate_data_signals', 'behaviour_90d', 'txn_velocity_30d'],
  nbaFeatureGroups: ['channel_engagement', 'product_holdings', 'txn_velocity_30d'],
  nbaLLMPromptRegistryId: 'nba-recommendation-enrichment',
  nbaLLMPromptVersion: '1.0.0',
  tenantId: 'afg-platform',
};

// ──────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────────────

/**
 * CreditDocumentFlowOrchestrator wires together the end-to-end flows for:
 * 1. Credit applications → Credit Underwriting → Feature Store → Human Review → Audit
 * 2. Document submission → Document Intelligence → Human Review → Audit
 * 3. NBA Engine → Feature Store → LLM Gateway → Audit
 *
 * Design principles:
 * - Audit-first: every decision emits an audit artefact before returning
 * - HITL gate: credit declines and low-confidence results route to human review
 * - Fail-safe: errors are captured and surfaced rather than silently swallowed
 */
export class CreditDocumentFlowOrchestrator {
  private readonly creditUnderwriting: CreditUnderwritingAdapter;
  private readonly featureStore: FeatureStoreAdapter;
  private readonly humanReview: HumanReviewAdapter;
  private readonly audit: AuditAdapter;
  private readonly documentIntelligence: DocumentIntelligenceAdapter;
  private readonly nbaEngine: NBAEngineAdapter;
  private readonly llmGateway: LLMGatewayAdapter;
  private readonly config: CreditDocumentFlowConfig;

  constructor(deps: {
    creditUnderwriting: CreditUnderwritingAdapter;
    featureStore: FeatureStoreAdapter;
    humanReview: HumanReviewAdapter;
    audit: AuditAdapter;
    documentIntelligence: DocumentIntelligenceAdapter;
    nbaEngine: NBAEngineAdapter;
    llmGateway: LLMGatewayAdapter;
    config?: Partial<CreditDocumentFlowConfig>;
  }) {
    this.creditUnderwriting = deps.creditUnderwriting;
    this.featureStore = deps.featureStore;
    this.humanReview = deps.humanReview;
    this.audit = deps.audit;
    this.documentIntelligence = deps.documentIntelligence;
    this.nbaEngine = deps.nbaEngine;
    this.llmGateway = deps.llmGateway;
    this.config = { ...DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG, ...deps.config };
  }

  /**
   * Execute the credit application end-to-end flow.
   *
   * Flow: Credit application → Feature Store → Credit Underwriting → Human Review (if needed) → Audit
   *
   * - Fetches features from Feature Store for the applicant
   * - Passes application to Credit Underwriting for scoring
   * - Routes DECLINE and REFER_TO_HUMAN decisions through Human Review Queue
   * - Persists audit artefact for every decision
   *
   * Validates: Requirement 5.1
   */
  async executeCreditFlow(input: CreditApplicationInput): Promise<CreditFlowResult> {
    const startTime = Date.now();

    // Step 1: Fetch features from Feature Store
    const featureResponse = await this.featureStore.getFeatures({
      entityId: input.customerId,
      entityType: 'CUSTOMER',
      featureGroups: this.config.creditFeatureGroups,
    });

    // Step 2: Process through Credit Underwriting
    const creditResult = await this.creditUnderwriting.processApplication(input);

    // Step 3: Route to Human Review if needed
    let humanReviewId: string | undefined;
    const needsReview =
      creditResult.decision === 'REFER_TO_HUMAN' ||
      creditResult.decision === 'DECLINE' ||
      creditResult.confidence < this.config.creditConfidenceThreshold;

    if (needsReview) {
      const reviewResult = await this.humanReview.submitForReview({
        useCase: 'CREDIT_UNDERWRITING',
        jurisdiction: input.jurisdiction,
        isHighImpact: creditResult.decision === 'DECLINE',
        highImpactActionType: creditResult.decision === 'DECLINE' ? 'CREDIT_DECLINE' : undefined,
        confidenceScore: creditResult.confidence,
        aiDecision: creditResult.decision,
        decisionChain: {
          modelVersion: creditResult.modelVersion,
          sourceServiceId: 'credit-underwriting-service',
          entityId: input.applicationId,
          context: { features: featureResponse.features },
          modelOutput: {
            score: creditResult.creditScore,
            decision: creditResult.decision,
            riskFactors: creditResult.riskFactors,
          },
        },
      });
      humanReviewId = reviewResult.reviewId;
    }

    // Step 4: Persist audit artefact (audit-first principle)
    const auditArtefactId = await this.audit.persist({
      artefactId: `credit-${input.applicationId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      jurisdiction: input.jurisdiction,
      serviceId: 'credit-underwriting-service',
      modelVersion: creditResult.modelVersion,
      inputFeatures: featureResponse.features,
      modelOutput: {
        decision: creditResult.decision,
        creditScore: creditResult.creditScore,
        riskFactors: creditResult.riskFactors,
      },
      confidenceScore: creditResult.confidence,
      decision: creditResult.decision,
    });

    const totalProcessingMs = Date.now() - startTime;

    return {
      status: needsReview ? 'PENDING_REVIEW' : 'COMPLETED',
      applicationId: input.applicationId,
      decision: creditResult.decision,
      creditScore: creditResult.creditScore,
      confidence: creditResult.confidence,
      riskFactors: creditResult.riskFactors,
      featureLatencyMs: featureResponse.latencyMs,
      humanReviewId,
      auditArtefactId,
      totalProcessingMs,
    };
  }

  /**
   * Execute the document submission end-to-end flow.
   *
   * Flow: Document submission → Document Intelligence → Human Review (if low confidence) → Audit
   *
   * - Submits document to Document Intelligence for extraction
   * - Routes low-confidence extractions to Human Review Queue
   * - Persists audit artefact for every extraction
   *
   * Validates: Requirement 9.1
   */
  async executeDocumentFlow(input: DocumentSubmissionInput): Promise<DocumentFlowResult> {
    const startTime = Date.now();

    // Step 1: Process through Document Intelligence
    const extractionResult = await this.documentIntelligence.extractDocument(input);

    // Step 2: Route to Human Review if needed
    let humanReviewId: string | undefined;
    const needsReview =
      extractionResult.requiresHumanReview ||
      extractionResult.overallConfidence < this.config.documentConfidenceThreshold;

    if (needsReview) {
      const reviewResult = await this.humanReview.submitForReview({
        useCase: 'DOCUMENT_EXTRACTION',
        jurisdiction: input.jurisdiction,
        isHighImpact: false,
        confidenceScore: extractionResult.overallConfidence,
        aiDecision: 'EXTRACTED_LOW_CONFIDENCE',
        decisionChain: {
          modelVersion: 'document-intelligence-v1.0.0',
          sourceServiceId: 'document-intelligence-service',
          entityId: input.documentId,
          context: {
            documentType: input.documentType,
            flaggedFields: extractionResult.flaggedFields,
          },
          modelOutput: {
            extractedFields: extractionResult.extractedFields,
            overallConfidence: extractionResult.overallConfidence,
          },
        },
      });
      humanReviewId = reviewResult.reviewId;
    }

    // Step 3: Persist audit artefact (audit-first principle)
    const auditArtefactId = await this.audit.persist({
      artefactId: `doc-${input.documentId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      jurisdiction: input.jurisdiction,
      serviceId: 'document-intelligence-service',
      modelVersion: 'document-intelligence-v1.0.0',
      inputFeatures: {
        documentType: input.documentType,
        documentId: input.documentId,
      },
      modelOutput: {
        extractedFields: extractionResult.extractedFields,
        overallConfidence: extractionResult.overallConfidence,
        flaggedFields: extractionResult.flaggedFields,
      },
      confidenceScore: extractionResult.overallConfidence,
      decision: needsReview ? 'REQUIRES_HUMAN_REVIEW' : 'EXTRACTED',
    });

    const totalProcessingMs = Date.now() - startTime;

    return {
      status: needsReview ? 'PENDING_REVIEW' : 'COMPLETED',
      documentId: input.documentId,
      extractedFields: extractionResult.extractedFields,
      overallConfidence: extractionResult.overallConfidence,
      humanReviewId,
      auditArtefactId,
      totalProcessingMs,
    };
  }

  /**
   * Execute the NBA engine end-to-end flow.
   *
   * Flow: NBA Engine → Feature Store → LLM Gateway (for enrichment) → Audit
   *
   * - Fetches real-time signals from Feature Store
   * - Computes recommendations via NBA Engine
   * - Enriches recommendations using LLM Gateway for reasoning text
   * - Persists audit artefact for the recommendation session
   *
   * Validates: Requirement 11.1
   */
  async executeNBAFlow(input: NBARecommendationInput): Promise<NBAFlowResult> {
    const startTime = Date.now();

    // Step 1: Fetch features from Feature Store (real-time signals)
    const featureResponse = await this.featureStore.getFeatures({
      entityId: input.customerId,
      entityType: 'CUSTOMER',
      featureGroups: this.config.nbaFeatureGroups,
    });

    // Step 2: Compute recommendations via NBA Engine
    const nbaResult = await this.nbaEngine.getMobileRecommendations(input);

    // Step 3: Enrich recommendations via LLM Gateway
    let llmEnrichment: NBAFlowResult['llmEnrichment'];
    if (nbaResult.recommendations.length > 0) {
      try {
        const llmResult = await this.llmGateway.infer({
          requestId: `nba-enrichment-${input.customerId}-${Date.now()}`,
          promptRegistryId: this.config.nbaLLMPromptRegistryId,
          promptVersion: this.config.nbaLLMPromptVersion,
          variables: {
            customerId: input.customerId,
            recommendations: nbaResult.recommendations,
            features: featureResponse.features,
          },
          tenantId: this.config.tenantId,
          jurisdiction: input.jurisdiction,
          routingHints: {
            maxLatencyMs: 2000,
            costCeiling: 'MEDIUM',
            qualityFloor: 'STANDARD',
          },
        });

        llmEnrichment = {
          output: llmResult.output,
          modelId: llmResult.modelId,
          latencyMs: llmResult.latencyMs,
        };
      } catch {
        // LLM enrichment is non-critical; proceed without it
        llmEnrichment = undefined;
      }
    }

    // Step 4: Persist audit artefact
    const auditArtefactId = await this.audit.persist({
      artefactId: `nba-${input.customerId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      jurisdiction: input.jurisdiction,
      serviceId: 'nba-engine',
      modelVersion: '1.0.0',
      inputFeatures: featureResponse.features,
      modelOutput: {
        recommendations: nbaResult.recommendations,
        llmEnrichment: llmEnrichment?.output,
      },
      confidenceScore: nbaResult.recommendations.length > 0
        ? nbaResult.recommendations[0].relevanceScore
        : 0,
      decision: 'RECOMMENDATIONS_GENERATED',
    });

    const totalProcessingMs = Date.now() - startTime;

    return {
      status: 'COMPLETED',
      customerId: input.customerId,
      recommendations: nbaResult.recommendations,
      llmEnrichment,
      featureLatencyMs: featureResponse.latencyMs,
      auditArtefactId,
      totalProcessingMs,
    };
  }
}
