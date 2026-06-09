/**
 * End-to-End Integration Flows
 *
 * Orchestrates the wiring of all platform services into complete
 * request flows with mTLS + SPIFFE identity enforcement.
 */

export {
  FraudScoringFlow,
  DEFAULT_FLOW_CONFIG,
  DEFAULT_LATENCY_BUDGET,
} from './fraud-scoring-flow.js';

export { AMLSanctionsFlow } from './aml-sanctions-flow.js';

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
} from './fraud-scoring-flow.js';

export type {
  AMLFlowConfig,
  SanctionsFlowConfig,
  AMLFlowResult,
  SanctionsFlowResult,
  AMLTriageAdapter,
  RAGPipelineAdapter,
  SanctionsScreeningAdapter,
  GuardrailsAdapter,
  AuditServiceAdapter,
  AMLAlertInput,
  SanctionsScreeningInput,
} from './types.js';

export {
  CreditDocumentFlowOrchestrator,
  DEFAULT_CREDIT_DOCUMENT_FLOW_CONFIG,
} from './credit-document-flow.js';

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
  AuditArtefactInput as CreditDocumentAuditInput,
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
} from './credit-document-flow.js';

export {
  ConversationalAIFlow,
  RMCopilotFlow,
  BranchCopilotFlow,
  DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG,
  DEFAULT_RM_COPILOT_FLOW_CONFIG,
  DEFAULT_BRANCH_COPILOT_FLOW_CONFIG,
} from './conversational-copilot-flow.js';

export type {
  ConversationalAIFlowInput,
  ConversationalAIFlowResult,
  RMCopilotFlowInput,
  RMCopilotFlowResult,
  BranchCopilotFlowInput,
  BranchCopilotFlowResult,
  FlowLLMGatewayAdapter,
  FlowGuardrailsAdapter,
  FlowRAGPipelineAdapter,
  FlowAuditAdapter,
  FlowCitation,
  FlowStepResult,
  FlowStepStatus,
  FlowGuardrailResult,
  FlowGuardrailFlag,
  FlowRAGResult,
  FlowRetrievedChunk,
  FlowLLMResult,
  FlowAuditRecord,
  ConversationalAIFlowConfig,
  RMCopilotFlowConfig,
  BranchCopilotFlowConfig,
} from './conversational-copilot-flow.js';
