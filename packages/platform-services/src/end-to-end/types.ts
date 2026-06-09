/**
 * DORA-Aligned Operational Resilience Types.
 *
 * Defines the ICT risk register, third-party concentration risk,
 * exit strategy documentation, criticality tiers, and recovery runbooks
 * required for Digital Operational Resilience Act (DORA) compliance.
 *
 * Validates: Requirements 30.1, 30.2, 30.3, 30.4
 */

import type { ISO8601, Jurisdiction } from '@afg/shared-types';

// ─── Criticality Tier Classification ─────────────────────────────────────────

/**
 * Criticality tier for AI/ML services, aligned to recovery priority.
 * - CRITICAL: Must recover within RTO <5 min (e.g., fraud scoring)
 * - HIGH: Must recover within RTO <15 min (e.g., AML triage)
 * - MEDIUM: Must recover within RTO <1 hour (e.g., credit underwriting)
 * - LOW: Must recover within RTO <4 hours (e.g., NBA engine)
 */
export type CriticalityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Vendor category for concentration risk assessment.
 */
export type VendorCategory =
  | 'CLOUD_PROVIDER'
  | 'MODEL_VENDOR'
  | 'VECTOR_DB'
  | 'STREAMING'
  | 'IDENTITY_PROVIDER'
  | 'OBSERVABILITY'
  | 'OTHER';

/**
 * ICT risk impact level.
 */
export type ImpactLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Risk likelihood.
 */
export type RiskLikelihood = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

/**
 * Exit strategy execution status.
 */
export type ExitStrategyStatus =
  | 'DOCUMENTED'
  | 'TESTED'
  | 'VALIDATED'
  | 'EXPIRED';

/**
 * Recovery runbook test result.
 */
export type RunbookTestResult = 'PASSED' | 'FAILED' | 'PARTIAL';

// ─── ICT Risk Register (Requirement 30.1) ────────────────────────────────────

/**
 * ICT risk entry for a critical AI/ML service.
 *
 * Validates: Requirement 30.1
 */
export interface ICTRiskEntry {
  /** Unique risk identifier. */
  riskId: string;

  /** The AI/ML service this risk applies to. */
  serviceId: string;

  /** Human-readable service name. */
  serviceName: string;

  /** Description of the ICT risk. */
  riskDescription: string;

  /** Impact assessment if risk materialises. */
  impactLevel: ImpactLevel;

  /** Likelihood of risk materialising. */
  likelihood: RiskLikelihood;

  /** Criticality tier of the service. */
  criticalityTier: CriticalityTier;

  /** Jurisdictions where this service operates. */
  jurisdictions: Jurisdiction[];

  /** Recovery priority order (lower = higher priority). */
  recoveryPriority: number;

  /** Identified mitigations for this risk. */
  mitigations: string[];

  /** Risk owner (team or individual). */
  riskOwner: string;

  /** Date the risk was last reviewed. */
  lastReviewedAt: ISO8601;

  /** Next scheduled review date (quarterly per DORA). */
  nextReviewDueAt: ISO8601;

  /** Whether this risk entry is active. */
  active: boolean;
}

/**
 * ICT Risk Register containing all risk entries for the platform.
 *
 * Validates: Requirement 30.1
 */
export interface ICTRiskRegister {
  /** Register identifier. */
  registerId: string;

  /** All risk entries. */
  entries: ICTRiskEntry[];

  /** Last quarterly review timestamp. */
  lastQuarterlyReviewAt: ISO8601;

  /** Next quarterly review due date. */
  nextQuarterlyReviewDueAt: ISO8601;

  /** Approver of the last review. */
  lastReviewApprover: string;

  /** Register creation date. */
  createdAt: ISO8601;

  /** Last updated timestamp. */
  updatedAt: ISO8601;
}

// ─── Third-Party Concentration Risk (Requirement 30.2) ───────────────────────

/**
 * Third-party vendor dependency record.
 *
 * Validates: Requirement 30.2
 */
export interface VendorDependency {
  /** Unique vendor identifier. */
  vendorId: string;

  /** Vendor name. */
  vendorName: string;

  /** Category of service the vendor provides. */
  category: VendorCategory;

  /** Services that depend on this vendor. */
  dependentServices: string[];

  /** Whether an alternative vendor exists. */
  hasAlternative: boolean;

  /** Alternative vendor ID (null if no alternative). */
  alternativeVendorId: string | null;

  /** Whether exit strategy is documented. */
  exitStrategyDocumented: boolean;

  /** Time estimate (days) to migrate away from this vendor. */
  estimatedMigrationDays: number;

  /** Jurisdictions where this vendor is used. */
  jurisdictions: Jurisdiction[];
}

/**
 * Concentration risk assessment result.
 *
 * Validates: Requirement 30.2
 */
export interface ConcentrationRiskAssessment {
  /** Assessment identifier. */
  assessmentId: string;

  /** Vendor being assessed. */
  vendorId: string;

  /** Whether this vendor constitutes a SPOF (single point of failure). */
  isSinglePointOfFailure: boolean;

  /** Number of critical services dependent on this vendor. */
  criticalDependencyCount: number;

  /** Whether the concentration risk is mitigated. */
  mitigated: boolean;

  /** Mitigation details (alternative vendors, multi-vendor strategy). */
  mitigationDetails: string;

  /** Assessment timestamp. */
  assessedAt: ISO8601;
}

// ─── Exit Strategy (Requirement 30.3) ────────────────────────────────────────

/**
 * Exit strategy for a vendor dependency.
 * Must be executable within 90 days per DORA requirements.
 *
 * Validates: Requirement 30.3
 */
export interface ExitStrategy {
  /** Strategy identifier. */
  strategyId: string;

  /** Vendor this strategy applies to. */
  vendorId: string;

  /** Vendor name for reference. */
  vendorName: string;

  /** Category of vendor. */
  vendorCategory: VendorCategory;

  /** Target migration vendor ID. */
  targetVendorId: string;

  /** Target vendor name. */
  targetVendorName: string;

  /** Detailed migration steps. */
  migrationSteps: MigrationStep[];

  /** Maximum allowed migration duration in days (must be ≤90). */
  maxMigrationDays: number;

  /** Estimated actual migration duration in days. */
  estimatedDays: number;

  /** Services affected by this exit. */
  affectedServices: string[];

  /** Data migration requirements. */
  dataMigrationPlan: string;

  /** Rollback procedure if migration fails. */
  rollbackProcedure: string;

  /** Current status of this exit strategy. */
  status: ExitStrategyStatus;

  /** Last test execution date. */
  lastTestedAt: ISO8601 | null;

  /** Next annual test due date. */
  nextTestDueAt: ISO8601;

  /** Document creation date. */
  createdAt: ISO8601;

  /** Last update timestamp. */
  updatedAt: ISO8601;
}

/**
 * Individual migration step within an exit strategy.
 */
export interface MigrationStep {
  /** Step order (1-based). */
  stepOrder: number;

  /** Step description. */
  description: string;

  /** Estimated duration in days. */
  estimatedDays: number;

  /** Team responsible for this step. */
  responsibleTeam: string;

  /** Dependencies on other steps (by stepOrder). */
  dependsOn: number[];

  /** Whether this step has been validated in testing. */
  validated: boolean;
}

// ─── Recovery Runbooks (Requirement 30.4) ─────────────────────────────────────

/**
 * Recovery runbook for a service tier.
 *
 * Validates: Requirement 30.4
 */
export interface RecoveryRunbook {
  /** Runbook identifier. */
  runbookId: string;

  /** Service this runbook applies to. */
  serviceId: string;

  /** Service name. */
  serviceName: string;

  /** Criticality tier of the service. */
  criticalityTier: CriticalityTier;

  /** Recovery Time Objective in minutes. */
  rtoMinutes: number;

  /** Recovery Point Objective in minutes. */
  rpoMinutes: number;

  /** Ordered recovery steps. */
  recoverySteps: RecoveryStep[];

  /** Escalation contacts by tier. */
  escalationContacts: EscalationContact[];

  /** Last semi-annual test date. */
  lastTestedAt: ISO8601 | null;

  /** Next semi-annual test due date. */
  nextTestDueAt: ISO8601;

  /** Result of last test. */
  lastTestResult: RunbookTestResult | null;

  /** Actual recovery time achieved in last test (minutes). */
  lastTestRecoveryMinutes: number | null;

  /** Runbook creation date. */
  createdAt: ISO8601;

  /** Last update timestamp. */
  updatedAt: ISO8601;
}

/**
 * Individual recovery step within a runbook.
 */
export interface RecoveryStep {
  /** Step order (1-based). */
  stepOrder: number;

  /** Step description. */
  description: string;

  /** Expected duration in minutes. */
  expectedDurationMinutes: number;

  /** Team responsible for execution. */
  responsibleTeam: string;

  /** Whether this step is automated. */
  automated: boolean;

  /** Verification criteria to confirm step completion. */
  verificationCriteria: string;
}

/**
 * Escalation contact for recovery procedures.
 */
export interface EscalationContact {
  /** Escalation level (1 = primary, 2 = secondary, etc.). */
  level: number;

  /** Contact name. */
  name: string;

  /** Contact role. */
  role: string;

  /** Contact method (phone, email, pager). */
  contactMethod: string;

  /** Response SLA in minutes. */
  responseSlaMinutes: number;
}

// ─── RTO/RPO Matrix (Requirement 30.4) ───────────────────────────────────────

/**
 * RTO/RPO targets by criticality tier.
 */
export interface RTORPOMatrix {
  CRITICAL: { rtoMinutes: number; rpoMinutes: number };
  HIGH: { rtoMinutes: number; rpoMinutes: number };
  MEDIUM: { rtoMinutes: number; rpoMinutes: number };
  LOW: { rtoMinutes: number; rpoMinutes: number };
}

// ─── Store Abstraction ───────────────────────────────────────────────────────

/**
 * Storage abstraction for the DORA resilience module.
 * Implementations can be in-memory (testing) or persistent (production).
 */
export interface DORAResilienceStore {
  /** Save or update the ICT risk register. */
  saveRiskRegister(register: ICTRiskRegister): Promise<void>;

  /** Retrieve the ICT risk register. */
  getRiskRegister(): Promise<ICTRiskRegister | null>;

  /** Save a vendor dependency record. */
  saveVendorDependency(vendor: VendorDependency): Promise<void>;

  /** Get all vendor dependencies. */
  getVendorDependencies(): Promise<VendorDependency[]>;

  /** Get a vendor dependency by ID. */
  getVendorDependency(vendorId: string): Promise<VendorDependency | null>;

  /** Save a concentration risk assessment. */
  saveConcentrationAssessment(assessment: ConcentrationRiskAssessment): Promise<void>;

  /** Get assessments for a vendor. */
  getConcentrationAssessments(vendorId: string): Promise<ConcentrationRiskAssessment[]>;

  /** Save an exit strategy. */
  saveExitStrategy(strategy: ExitStrategy): Promise<void>;

  /** Get exit strategy for a vendor. */
  getExitStrategy(vendorId: string): Promise<ExitStrategy | null>;

  /** Get all exit strategies. */
  getAllExitStrategies(): Promise<ExitStrategy[]>;

  /** Save a recovery runbook. */
  saveRecoveryRunbook(runbook: RecoveryRunbook): Promise<void>;

  /** Get runbook for a service. */
  getRecoveryRunbook(serviceId: string): Promise<RecoveryRunbook | null>;

  /** Get all recovery runbooks. */
  getAllRecoveryRunbooks(): Promise<RecoveryRunbook[]>;
}


// ─── AML / Sanctions End-to-End Flow Types ──────────────────────────────────

/**
 * Types for the AML/Sanctions end-to-end flow wiring.
 *
 * Defines adapter interfaces, flow configurations, and result types
 * for orchestrating AML Triage and Sanctions Screening through
 * RAG Pipeline, LLM Gateway, Guardrails, Human Review Queue, and Audit Service.
 *
 * Validates: Requirements 3.1, 4.3, 4.6
 */

// ─── Flow Status ─────────────────────────────────────────────────────────────

/** Status of an end-to-end flow execution. */
export type FlowStatus = 'COMPLETED' | 'FAILED' | 'PENDING_REVIEW';

// ─── Flow Step Tracking ──────────────────────────────────────────────────────

/** Result of an individual step within a flow. */
export interface FlowStepResult {
  /** Name of the step executed. */
  step: string;
  /** Outcome status of the step. */
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  /** Timestamp when the step completed. */
  timestamp: ISO8601;
  /** Step-specific output data. */
  output: Record<string, unknown>;
}

// ─── AML Flow Configuration ─────────────────────────────────────────────────

/** Configuration for the AML alert triage flow. */
export interface AMLFlowConfig {
  /** Service identifier for audit trail. */
  serviceId: string;
  /** Model version string. */
  modelVersion: string;
  /** Groundedness threshold below which content is flagged. */
  groundednessThreshold: number;
  /** Confidence threshold below which decisions route to human review. */
  confidenceThreshold: number;
  /** Maximum narrative generation time in milliseconds. */
  narrativeTimeoutMs: number;
}

// ─── Sanctions Flow Configuration ───────────────────────────────────────────

/** Configuration for the sanctions screening flow. */
export interface SanctionsFlowConfig {
  /** Service identifier for audit trail. */
  serviceId: string;
  /** Model version string. */
  modelVersion: string;
  /** Timeout for LLM disambiguation in milliseconds. */
  disambiguationTimeoutMs: number;
  /** Confidence threshold for human review routing. */
  confidenceThreshold: number;
}

// ─── AML Flow Input / Result ─────────────────────────────────────────────────

/** Input for the AML alert triage end-to-end flow. */
export interface AMLAlertInput {
  /** Unique alert identifier. */
  alertId: string;
  /** Type of AML alert. */
  alertType: 'TRANSACTION_MONITORING' | 'BEHAVIOUR' | 'NETWORK';
  /** Entity under investigation. */
  entityId: string;
  /** Alert payload data. */
  alertData: Record<string, unknown>;
  /** Jurisdiction for data residency. */
  jurisdiction: Jurisdiction;
  /** Tenant identifier for RAG scoping. */
  tenantId: string;
  /** Optional corpus IDs for RAG retrieval. */
  corpusIds?: string[];
}

/** Result of the AML end-to-end flow execution. */
export interface AMLFlowResult {
  /** Unique flow execution identifier. */
  flowId: string;
  /** Overall flow status. */
  status: FlowStatus;
  /** Alert that was processed. */
  alertId: string;
  /** Triage disposition. */
  disposition: string | undefined;
  /** Priority score assigned. */
  priorityScore: number | undefined;
  /** Confidence of the triage decision. */
  confidence: number | undefined;
  /** Reasoning summary for the disposition. */
  reasoningSummary: string | undefined;
  /** Number of RAG chunks retrieved. */
  ragChunksRetrieved: number;
  /** Groundedness score of retrieved context. */
  groundednessScore: number | undefined;
  /** Whether human review was triggered. */
  humanReviewRequired: boolean;
  /** Human review queue item ID. */
  reviewId: string | undefined;
  /** Persisted audit artefact ID. */
  auditArtefactId: string | undefined;
  /** Detailed step results. */
  steps: FlowStepResult[];
  /** Total flow duration in milliseconds. */
  totalDurationMs: number;
  /** Error message if flow failed. */
  error?: string;
}

// ─── Sanctions Flow Input / Result ───────────────────────────────────────────

/** Input for the sanctions screening end-to-end flow. */
export interface SanctionsScreeningInput {
  /** Unique screening request identifier. */
  requestId: string;
  /** Entity name to screen. */
  entityName: string;
  /** Type of entity. */
  entityType: 'INDIVIDUAL' | 'ORGANISATION' | 'VESSEL' | 'AIRCRAFT';
  /** Additional entity attributes for disambiguation. */
  attributes: Record<string, unknown>;
  /** Jurisdiction for data residency. */
  jurisdiction: Jurisdiction;
  /** Tenant identifier. */
  tenantId: string;
}

/** Result of the sanctions screening end-to-end flow execution. */
export interface SanctionsFlowResult {
  /** Unique flow execution identifier. */
  flowId: string;
  /** Overall flow status. */
  status: FlowStatus;
  /** Original screening request ID. */
  requestId: string;
  /** Final disposition. */
  disposition: string | undefined;
  /** Number of watchlist matches found. */
  matchCount: number;
  /** Whether LLM disambiguation was performed. */
  disambiguationPerformed: boolean;
  /** Whether guardrails checks passed. */
  guardrailsPassed: boolean;
  /** Whether human review was triggered. */
  humanReviewRequired: boolean;
  /** Human review queue item ID. */
  reviewId: string | undefined;
  /** Whether the rules-based fallback was used. */
  fallbackUsed: boolean;
  /** Persisted audit artefact ID. */
  auditArtefactId: string | undefined;
  /** Detailed step results. */
  steps: FlowStepResult[];
  /** Total flow duration in milliseconds. */
  totalDurationMs: number;
  /** Error message if flow failed. */
  error?: string;
}

// ─── Adapter Interfaces ──────────────────────────────────────────────────────

/**
 * Adapter for the AML Triage Service within the end-to-end flow.
 * Wraps the AML Triage Service to provide a flow-compatible interface.
 */
export interface AMLTriageAdapter {
  triageAlert(request: {
    alertId: string;
    alertType: 'TRANSACTION_MONITORING' | 'BEHAVIOUR' | 'NETWORK';
    entityId: string;
    alertData: Record<string, unknown>;
    jurisdiction: Jurisdiction;
  }): Promise<{
    disposition: string;
    priorityScore: number;
    confidence: number;
    reasoningSummary: string;
    auditArtefactId: string;
  }>;
}

/**
 * Adapter for the RAG Pipeline within the end-to-end flow.
 * Provides case history retrieval for AML narrative generation.
 */
export interface RAGPipelineAdapter {
  retrieveCaseHistory(request: {
    caseId: string;
    tenantId: string;
    jurisdiction: Jurisdiction;
    query: string;
    corpusIds: string[];
  }): Promise<{
    chunks: Array<{
      chunkId: string;
      content: string;
      source: { documentName: string; section: string; publicationDate: ISO8601 };
      relevanceScore: number;
    }>;
    groundednessScore: number;
    retrievalLatencyMs: number;
  }>;
}

/**
 * Adapter for the Sanctions Screening Service within the end-to-end flow.
 */
export interface SanctionsScreeningAdapter {
  screen(request: {
    requestId: string;
    entityName: string;
    entityType: 'INDIVIDUAL' | 'ORGANISATION' | 'VESSEL' | 'AIRCRAFT';
    attributes: Record<string, unknown>;
    jurisdiction: Jurisdiction;
    tenantId: string;
  }): Promise<{
    disposition: string;
    matchResults: Array<{ confidenceScore: number; [key: string]: unknown }>;
    reasoning: string;
    disambiguationResult?: { confidence: number; [key: string]: unknown };
    fallbackUsed: boolean;
    processingTimeMs: number;
    auditArtefactId: string;
  }>;
}

/**
 * Adapter for the LLM Gateway within the end-to-end flow.
 * Routes LLM inference requests through the gateway.
 */
export interface LLMGatewayAdapter {
  infer(request: {
    requestId: string;
    prompt: string;
    jurisdiction: Jurisdiction;
    tenantId: string;
    routingHints: {
      maxLatencyMs: number;
      costCeiling: string;
      qualityFloor: string;
    };
  }): Promise<{
    output: string;
    modelId: string;
    latencyMs: number;
    auditArtefactId: string;
  }>;
}

/**
 * Adapter for the Guardrails Engine within the end-to-end flow.
 * Applies safety checks to LLM inputs and outputs.
 */
export interface GuardrailsAdapter {
  check(request: {
    content: string;
    direction: 'INPUT' | 'OUTPUT';
    checks: string[];
    context: { tenantId: string; useCase: string };
  }): Promise<{
    passed: boolean;
    flags: Array<{ type: string; confidence: number; description: string }>;
    redactedContent?: string;
    blockReason?: string;
  }>;
}

/**
 * Adapter for the Human Review Queue within the end-to-end flow.
 * Routes decisions requiring human oversight.
 */
export interface HumanReviewAdapter {
  submitForReview(request: {
    useCase: string;
    jurisdiction: Jurisdiction;
    isHighImpact: boolean;
    highImpactActionType?: string;
    confidenceScore: number;
    aiDecision: string;
    decisionChain: Record<string, unknown>;
  }): Promise<{
    reviewId: string;
    status: string;
    isHighImpact: boolean;
  }>;
}

/**
 * Adapter for the Audit Service within the end-to-end flow.
 * Persists complete decision artefacts for 7-year retention.
 */
export interface AuditServiceAdapter {
  persistArtefact(artefact: {
    artefactId: string;
    timestamp: ISO8601;
    jurisdiction: Jurisdiction;
    serviceId: string;
    modelVersion: string;
    inputFeatures: Record<string, unknown>;
    modelOutput: Record<string, unknown>;
    confidenceScore: number;
    decision: string;
    retrievedContext?: Array<{
      chunkId: string;
      content: string;
      source: { documentName: string; section: string; publicationDate: ISO8601 };
      relevanceScore: number;
    }>;
  }): Promise<string>;
}
