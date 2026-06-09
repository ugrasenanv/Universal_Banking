/**
 * @afg/ai-services
 *
 * AI/ML inference services including Fraud Detection, AML Triage,
 * Sanctions Screening, Credit Underwriting, Conversational AI,
 * Document Intelligence, NBA Engine, and Complaints Intelligence.
 */

// Guardrails Engine (export first since llm-gateway depends on it)
export {
  GuardrailsEngine,
  DEFAULT_GUARDRAIL_CONFIG,
  detectPromptInjection,
  detectJailbreak,
  detectPII,
  redactPII,
  PIITokenStore,
  detectToxicity,
  checkPolicyCompliance,
  detectIndirectInjection,
} from './guardrails/index.js';

export type {
  GuardrailDirection,
  GuardrailCheck,
  GuardrailSeverity,
  GuardrailFlag,
  GuardrailCheckRequest,
  GuardrailCheckResponse,
  PIIType,
  PIIMatch,
  PIITokenMapping,
  DetectorResult,
  GuardrailConfig,
  ToxicityCategory,
} from './guardrails/index.js';

// RAG Pipeline
export {
  EmbeddingService,
  RetrievalEngine,
  VectorIndexService,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_RETRIEVAL_CONFIG,
  isRAGRefusal,
} from './rag-pipeline/index.js';

export type {
  RetrievalStrategy,
  RAGRetrievalRequest,
  RAGRetrievalResponse,
  RetrievedChunk,
  VectorDocument,
  EmbeddingConfig,
  RetrievalConfig,
  BM25Result,
  DenseSearchResult,
  RerankResult,
  GroundednessResult,
  EmbeddingModelAdapter,
  VectorStoreAdapter,
  BM25Adapter,
  CrossEncoderAdapter,
  GroundednessScorer,
  RAGRefusalResponse,
  RAGResult,
  IndexDocumentRequest,
} from './rag-pipeline/index.js';

// RAG Pipeline
export {
  DocumentChunker,
  DocumentIngestionService,
  estimateTokenCount,
  computeContentHash,
  detectSemanticBoundaries,
  findNearestBoundaryAfter,
  findNearestBoundaryBefore,
  getSectionTitle,
  CHUNKING_CONFIGS,
} from './rag-pipeline/index.js';

export type {
  CorpusType,
  ChunkingStrategy,
  ChunkingConfig,
  SectionBoundary,
  DocumentChunk,
  DocumentIngestionRequest,
  DocumentIngestionResult,
  UpdateStatus,
  CorpusUpdate,
  CorpusMetadata,
  ChunkStore,
} from './rag-pipeline/index.js';

// AML Triage Service
export { AMLTriageService, DEFAULT_AML_TRIAGE_CONFIG } from './aml/index.js';

export type {
  AMLAlertType,
  AMLDisposition,
  AlertPayload,
  AMLTriageRequest,
  AMLTriageResponse,
  NarrativeScope,
  NarrativeGenerationRequest,
  Citation,
  NarrativeGenerationResponse,
  DataSourceStatus,
  SARFilingRequest,
  SARFilingResponse,
  AMLClassificationModelAdapter,
  ClassificationResult,
  AMLRAGAdapter,
  RAGCaseHistoryResult,
  RAGChunk,
  AMLNarrativeGeneratorAdapter,
  NarrativeResult,
  AMLAuditEmitter,
  AMLAuditArtefactInput,
  AMLTriageConfig,
} from './aml/index.js';

// LLM Gateway (re-exports GuardrailFlag from guardrails/types internally)
export {
  LLMGateway,
  ModelRouter,
  DEFAULT_MODEL_TIERS,
  SemanticCache,
  RateLimiter,
  PromptRegistry,
  EvaluationGateService,
  QUALITY_TIER_SCORES,
  COST_TIER_LIMITS,
} from './llm-gateway/index.js';

export type {
  LLMGatewayConfig,
  ModelInferenceAdapter,
  AuditEmitter,
  SemanticCacheConfig,
  LLMInferenceRequest,
  LLMInferenceResponse,
  LLMAuditRecord,
  ModelTier,
  ModelProvider,
  TaskComplexity,
  ModelRoutingPolicy,
  CostConstraint,
  RoutingHints,
  TokenUsage,
  RetrievedContext,
  SemanticCacheEntry,
  RateLimitConfig,
  QuotaConfig,
  RateLimitResult,
  PromptTemplate,
  EvaluationGate,
  EvaluationCondition,
  EvaluationResult,
} from './llm-gateway/index.js';

// Sanctions Screening Service
export {
  SanctionsScreeningService,
  DEFAULT_SANCTIONS_THRESHOLDS,
  DEFAULT_SANCTIONS_CONFIG,
} from './sanctions/index.js';

export type {
  ScreeningEntityType,
  MatchType,
  ScreeningDisposition,
  WatchlistSource,
  ScreeningRequest,
  ScreeningResponse,
  WatchlistEntry,
  MatchResult,
  DisambiguationResult,
  SanctionsThresholdConfig,
  SanctionsScreeningConfig,
  NameMatchingAdapter,
  LLMDisambiguationAdapter,
  SanctionsAuditEmitter,
  SanctionsDispositionRecord,
  RulesBasedScreeningAdapter,
  RulesBasedResult,
} from './sanctions/index.js';

// Conversational AI Service
export {
  ConversationalAIService,
  DEFAULT_CONVERSATIONAL_AI_CONFIG,
  SUPPORTED_LANGUAGES,
} from './conversational-ai/index.js';

export type {
  ConversationChannel,
  AuthStatus,
  EscalationReason,
  DetectedIntent,
  CustomerContext,
  ConversationRequest,
  ConversationalAction,
  ConversationResponse,
  ConversationTurn,
  SessionState,
  EscalationContext,
  ContentSafetyResult,
  LanguageDetectionAdapter,
  LanguageDetectionResult,
  IntentRecognitionAdapter,
  ResponseGenerationAdapter,
  GeneratedResponse,
  ContentSafetyAdapter,
  SessionStoreAdapter,
  EscalationAdapter,
  EscalationResult,
  ConversationalAuditEmitter,
  ConversationalAuditRecord,
  LatencyTargets,
  ConversationalAIConfig,
} from './conversational-ai/index.js';

// RM Copilot
export {
  RMCopilot,
  DEFAULT_RM_COPILOT_CONFIG,
  RESIDENCY_ENFORCED_JURISDICTIONS,
} from './rm-copilot/index.js';

export type {
  RMCopilotBriefRequest,
  RMCopilotBriefResponse,
  SynthesisedBrief,
  RMCitation,
  CRMClientRecord,
  PortfolioSummary,
  HoldingRecord,
  RelationshipEvent,
  ClientPreferences,
  MarketResearchDocument,
  ProductCatalogueEntry,
  RMSessionContext,
  ResidencyCheckResult,
  CRMAdapter,
  MarketResearchAdapter,
  MarketResearchRetrievalResult,
  ProductCatalogueAdapter,
  RMBriefGeneratorAdapter,
  BriefGenerationResult,
  ResidencyEnforcementAdapter,
  LocalModelAdapter,
  RMCopilotAuditEmitter,
  RMCopilotAuditInput,
  RMCopilotConfig,
} from './rm-copilot/index.js';

// Branch Copilot
export { BranchCopilot, DEFAULT_BRANCH_COPILOT_CONFIG, isBranchCopilotRefusal } from './branch-copilot/index.js';

export type {
  SourceCitation,
  BranchCorpusCategory,
  BranchCopilotQuery,
  BranchCopilotAnswer,
  BranchCopilotRefusal,
  BranchCopilotResponse,
  CorpusUpdateStatus,
  BranchCorpusDocument,
  BranchCorpusUpdateRequest,
  BranchCorpusUpdateResult,
  BranchCopilotConfig,
  BranchAnswerGeneratorAdapter,
  BranchRetrievalAdapter,
  BranchRetrievalResult,
  BranchCorpusUpdateAdapter,
} from './branch-copilot/index.js';

// Document Intelligence Service
export {
  DocumentIntelligenceService,
  computeDocumentHash,
  computeOverallConfidence,
  isTradeFinanceDocument,
  DEFAULT_DOCUMENT_INTELLIGENCE_CONFIG,
  TRADE_FINANCE_DOCUMENT_TYPES,
  KYC_DOCUMENT_TYPES,
  LC_REQUIRED_FIELDS,
  BOL_REQUIRED_FIELDS,
  COMMERCIAL_INVOICE_REQUIRED_FIELDS,
  BANK_GUARANTEE_REQUIRED_FIELDS,
  getTradeFinanceRules,
  isCriticalField,
  CRITICAL_FIELD_PATTERNS,
} from './document-intelligence/index.js';

export type {
  DocumentType,
  BoundingBox,
  ExtractedField,
  DocumentExtractionRequest,
  DocumentExtractionResponse,
  TradeFinanceValidationRule,
  TradeFinanceValidationResult,
  TradeFinanceValidationError,
  RejectionReason,
  DocumentRejectionResponse,
  ExtractionCacheEntry,
  OCREngineAdapter,
  OCRExtractionResult,
  ExtractionCacheAdapter,
  DocumentAuditEmitter,
  DocumentAuditArtefactInput,
  HumanReviewRouterAdapter,
  DocumentIntelligenceConfig,
} from './document-intelligence/index.js';

// Credit Underwriting Service
export {
  FairnessMetricsService,
  BehaviouralCreditLineService,
  AdverseActionNoticeGenerator,
  ChallengerModelService,
  ALL_PROTECTED_CATEGORIES,
  DISPARATE_IMPACT_THRESHOLD,
  MIN_ADVERSE_ACTION_REASONS,
  MAX_ADVERSE_ACTION_REASONS,
  MAX_READING_LEVEL,
  MAX_GENERATION_TIME_MS,
  MINIMUM_SHADOW_PERIOD_DAYS,
  DEFAULT_BEHAVIOURAL_CREDIT_LINE_CONFIG,
  THIN_FILE_THRESHOLD_MONTHS,
  MIN_ADVERSE_ACTION_FACTORS,
  ADVERSE_ACTION_DELIVERY_DAYS,
  DECISION_SLA_HOURS,
  DEFAULT_CREDIT_UNDERWRITING_CONFIG,
} from './credit-underwriting/index.js';

export type {
  CreditApplicationType,
  CreditDecision,
  RiskFactor,
  AdverseActionNotice,
  CohortMetric,
  FairnessReport,
  ApplicantProfile,
  CreditDecisionRequest,
  CreditDecisionResponse,
  AlternateDataSignals,
  CreditModelOutput,
  CreditModelAdapter,
  CreditFeatureStoreAdapter,
  AlternateDataAdapter,
  CreditAuditEmitter,
  CreditUnderwritingConfig,
  ProtectedCategory,
  FairnessEvaluationResult,
  FairnessBlockRecord,
  BehaviouralSignals,
  CreditLineAdjustmentType,
  CreditLineAdjustmentRecommendation,
  CreditLineAdjustmentRequest,
  CreditLineAdverseActionNotice,
  ChallengerModelConfig,
  ShadowScoringResult,
  MonthlyComparisonReport,
  ModelPerformanceStats,
  BehaviouralSignalAdapter,
  CreditLineModelAdapter,
  FairnessReviewAdapter,
  CohortStatisticsAdapter,
  ShadowScoringStore,
  ChallengerCreditModelAdapter,
  CreditLineAuditEmitter,
  BehaviouralCreditLineConfig,
  AdverseActionNoticeInput,
} from './credit-underwriting/index.js';

// Complaints Intelligence Service
export {
  ComplaintsIntelligenceService,
  DEFAULT_CATEGORY_TEAM_MAP,
  DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG,
} from './complaints-intelligence/index.js';

export type {
  ComplaintCategory,
  ComplaintSubcategory,
  ResolutionTeam,
  CategoryTeamMapping,
  ComplaintClassificationRequest,
  ComplaintClassificationResponse,
  RBICMSComplaintSummary,
  ComplaintAuditRecord,
  ComplaintClassificationModelAdapter,
  ComplaintClassificationResult,
  ComplaintAuditEmitter,
  ComplaintsIntelligenceConfig,
} from './complaints-intelligence/index.js';

// NBA Engine
export { NBAEngine, DEFAULT_NBA_ENGINE_CONFIG } from './nba-engine/index.js';

export type {
  CustomerSegment,
  ProductCategory,
  RecommendationChannel,
  LifeEvent,
  CustomerSignal,
  CustomerSignals,
  TransactionRecencySignal,
  ChannelEngagementSignal,
  LifeEventSignal,
  ProductRecommendation,
  MobileRecommendationRequest,
  MobileRecommendationResponse,
  RMActionRequest,
  RMAction,
  RMActionResponse,
  SegmentFairnessMetrics,
  FairnessReport,
  FairnessReportRequest,
  SignalFetchAdapter,
  RecommendationModelAdapter,
  RMActionModelAdapter,
  FairnessDataAdapter,
  NBAAuditEmitter,
  NBAAuditRecord,
  NBAEngineConfig,
} from './nba-engine/index.js';

// FinOps Service
export { FinOpsService, DEFAULT_FINOPS_CONFIG } from './finops/index.js';

export type {
  CostDrivers,
  CostRecord,
  CostDriverEntry,
  TrendData,
  Recommendation,
  LineOfBusinessReport,
  UnitEconomics,
  CostReport,
  GPUUtilisationSample,
  GPUUtilisationAlert,
  CostRecordStore,
  CostQueryParams,
  GPUMetricsAdapter,
  AlertEmitter,
  FinOpsServiceConfig,
} from './finops/index.js';
