/**
 * @afg/platform-services
 *
 * Platform infrastructure services including Identity, Streaming Backbone,
 * Feature Store, Audit Service, Guardrails Engine, and LLM Gateway.
 */

// Identity Service
export { IdentityService } from './identity/index.js';
export type {
  IdentityServiceConfig,
  AuthProtocol,
  SCAMethod,
  SessionConfig,
  AuthenticationFlow,
  AuthenticationRequest,
  AuthenticationResult,
  AuthenticationError,
  AuthCredentials,
  Session,
  Role,
  Permission,
  AttributeCondition,
  SegregationRule,
  AccessPolicy,
  AccessRequest,
  AccessDecision,
} from './identity/index.js';

// Audit Service
export { AuditService, IcebergAuditStore } from './audit/index.js';
export type {
  AuditArtefactInput,
  AuditQueryRequest,
  AuditQueryResponse,
  AuditStore,
  IntegrityVerificationResult,
  PartitionSpec,
} from './audit/index.js';

// Human Review Queue
export { HumanReviewQueue, InMemoryReviewQueueStore } from './human-review-queue/index.js';
export type {
  ConfidenceThresholdConfig,
  CustomerNotification,
  DecisionChain,
  HighImpactActionType,
  NotificationService,
  RecordReviewDecisionRequest,
  ReviewDecision,
  ReviewFeedback,
  ReviewItem,
  ReviewItemStatus,
  ReviewOutcome,
  ReviewQueueStore,
  ReviewUseCase,
  SubmitForReviewRequest,
} from './human-review-queue/index.js';

// End-to-End Integration Flows
export { FraudScoringFlow, DEFAULT_FLOW_CONFIG, DEFAULT_LATENCY_BUDGET } from './end-to-end/index.js';
export type {
  SPIFFEIdentity,
  MTLSContext,
  LatencyBreakdown,
  LatencyBudget,
  FraudScoringFlowRequest,
  FraudScoringFlowResult,
  FraudAuditEvent,
  FraudScoringFlowConfig,
  SPIFFEVerifier,
  FeatureStoreClient,
  FraudInferenceClient,
  StreamingClient,
  AuditClient,
} from './end-to-end/index.js';

// Credit and Document End-to-End Flows
export { CreditDocumentFlowOrchestrator, DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG } from './end-to-end/index.js';
export type {
  CreditUnderwritingAdapter,
  FeatureStoreAdapter,
  HumanReviewAdapter,
  AuditAdapter,
  DocumentIntelligenceAdapter,
  NBAEngineAdapter,
  LLMGatewayAdapter,
  CreditApplicationInput,
  CreditDecisionOutput,
  CreditRiskFactor,
  FeatureRetrievalRequest,
  FeatureRetrievalResponse,
  HumanReviewSubmission,
  HumanReviewResult,
  CreditDocumentAuditInput,
  DocumentSubmissionInput,
  DocumentExtractionOutput,
  DocumentExtractedField,
  NBARecommendationInput,
  NBARecommendationOutput,
  NBARecommendation,
  LLMInferenceInput,
  LLMInferenceOutput,
  FlowStatus,
  CreditFlowResult,
  DocumentFlowResult,
  NBAFlowResult,
  CreditDocumentFlowConfig,
} from './end-to-end/index.js';

// Model Registry and Governance Framework
export { ModelRegistry, InMemoryModelStore } from './model-registry/index.js';
export type {
  RegisterModelInput,
  RiskTier,
  ValidationStatus,
  ModelDomain,
  ModelRecord,
  ModelProvenance,
  TrainingDataSource,
  EvaluationResult,
  ApprovalRecord,
  ValidationIndependencePolicy,
  ValidationIndependenceResult,
  DriftMetric,
  DriftAlert,
  DriftDetectionConfig,
  DriftThresholdConfig,
  ChallengerPairing,
  ChallengerReport,
  ModelStore,
  ModelListFilters,
} from './model-registry/index.js';
