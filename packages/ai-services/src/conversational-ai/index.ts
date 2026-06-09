/**
 * Conversational AI Service Module
 *
 * Multilingual virtual assistant for retail banking customers
 * across mobile, IVR, and web channels.
 */

export { ConversationalAIService } from './conversational-ai-service.js';

export {
  DEFAULT_CONVERSATIONAL_AI_CONFIG,
  SUPPORTED_LANGUAGES,
} from './types.js';

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
} from './types.js';
