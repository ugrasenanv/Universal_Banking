/**
 * Conversational AI Service Types
 *
 * Core interfaces for the multilingual virtual assistant serving
 * retail customers across mobile, IVR, and web channels with
 * cross-channel session state transfer and content safety.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10
 */

import type { ISO8601, LanguageCode } from '@afg/shared-types';

// ─── Channel & Session Types ───────────────────────────────────────────────────

/** Supported interaction channels. */
export type ConversationChannel = 'MOBILE' | 'IVR' | 'WEB' | 'HUMAN_AGENT';

/** Authentication status for the session. */
export type AuthStatus = 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'EXPIRED';

/** Escalation reason categories. */
export type EscalationReason =
  | 'LOW_CONFIDENCE'
  | 'CUSTOMER_REQUEST'
  | 'CONTENT_SAFETY_BLOCK'
  | 'REPEATED_FAILURE'
  | 'COMPLEX_QUERY';

// ─── Intent Recognition ────────────────────────────────────────────────────────

/** Recognised intent from customer input. */
export interface DetectedIntent {
  /** Primary intent name (e.g., 'balance_inquiry', 'fund_transfer'). */
  name: string;
  /** Confidence score 0.00-1.00. */
  confidence: number;
  /** Recognised entities/slots. */
  entities: Record<string, unknown>;
}

// ─── Conversation Request/Response ─────────────────────────────────────────────

/** Customer context carried into the conversation. */
export interface CustomerContext {
  customerId: string;
  segment: 'RETAIL' | 'SME' | 'WEALTH' | 'CORPORATE';
  preferredLanguage?: LanguageCode;
  jurisdiction: 'IN' | 'SG' | 'AE' | 'GB' | 'US';
}

/**
 * Request payload for conversational interaction.
 */
export interface ConversationRequest {
  sessionId: string;
  channel: ConversationChannel;
  input: string;
  language?: LanguageCode;
  customerContext: CustomerContext;
}

/** Action the assistant may trigger. */
export interface ConversationalAction {
  type: string;
  parameters: Record<string, unknown>;
}

/**
 * Response payload from conversational interaction.
 */
export interface ConversationResponse {
  sessionId: string;
  output: string;
  language: LanguageCode;
  intent: DetectedIntent;
  confidence: number;
  action?: ConversationalAction;
  escalationRequired: boolean;
  escalationReason?: EscalationReason;
  latencyMs: number;
  contentSafetyPassed: boolean;
}

// ─── Session State ─────────────────────────────────────────────────────────────

/** A single turn in the conversation history. */
export interface ConversationTurn {
  role: 'customer' | 'assistant';
  content: string;
  timestamp: ISO8601;
  language: LanguageCode;
  channel: ConversationChannel;
}

/**
 * Full session state that can be transferred across channels.
 * Transfer must complete within 3 seconds (Requirement 7.2).
 */
export interface SessionState {
  sessionId: string;
  conversationHistory: ConversationTurn[];
  detectedIntent: string;
  collectedFields: Record<string, unknown>;
  authenticationStatus: AuthStatus;
  channel: ConversationChannel;
  language: LanguageCode;
  createdAt: ISO8601;
  lastActivityAt: ISO8601;
  customerContext: CustomerContext;
}

// ─── Escalation ────────────────────────────────────────────────────────────────

/** Context package transferred to human agent on escalation. */
export interface EscalationContext {
  sessionId: string;
  conversationHistory: ConversationTurn[];
  detectedIntent: string;
  collectedFields: Record<string, unknown>;
  retrievedDocuments: string[];
  suggestedResolution: string;
  escalationReason: EscalationReason;
  timestamp: ISO8601;
}

// ─── Content Safety ────────────────────────────────────────────────────────────

/** Content safety classification result. */
export interface ContentSafetyResult {
  passed: boolean;
  /** Whether the content was flagged as toxic. */
  toxicityDetected: boolean;
  /** Whether the content contains discriminatory language. */
  discriminatoryContent: boolean;
  /** Whether the content contradicts bank policies. */
  policyContradiction: boolean;
  /** Specific reason for block (if not passed). */
  blockReason?: string;
}

// ─── Adapter Interfaces ────────────────────────────────────────────────────────

/**
 * Language detection adapter.
 * Detects the language of customer input.
 */
export interface LanguageDetectionAdapter {
  detect(text: string): Promise<LanguageDetectionResult>;
}

/** Language detection result. */
export interface LanguageDetectionResult {
  detectedLanguage: LanguageCode | null;
  confidence: number;
}

/**
 * Intent recognition adapter.
 * Classifies customer input into intents with ≥90% accuracy per language.
 */
export interface IntentRecognitionAdapter {
  recognize(input: string, language: LanguageCode): Promise<DetectedIntent>;
}

/**
 * Response generation adapter.
 * Generates natural language responses in the target language.
 */
export interface ResponseGenerationAdapter {
  generate(
    intent: DetectedIntent,
    sessionState: SessionState,
    language: LanguageCode
  ): Promise<GeneratedResponse>;
}

/** Result from response generation. */
export interface GeneratedResponse {
  text: string;
  confidence: number;
  action?: ConversationalAction;
}

/**
 * Content safety classifier adapter.
 * Blocks toxic, discriminatory, or policy-contradicting responses.
 */
export interface ContentSafetyAdapter {
  classify(content: string, language: LanguageCode): Promise<ContentSafetyResult>;
}

/**
 * Session store adapter for cross-channel state persistence.
 * Must support transfer within 3 seconds (Requirement 7.2).
 */
export interface SessionStoreAdapter {
  getSession(sessionId: string): Promise<SessionState | null>;
  saveSession(state: SessionState): Promise<void>;
  transferSession(
    sessionId: string,
    targetChannel: ConversationChannel
  ): Promise<SessionState>;
}

/**
 * Escalation adapter for human agent handoff.
 * Must complete within 10 seconds (Requirement 7.6).
 */
export interface EscalationAdapter {
  escalate(context: EscalationContext): Promise<EscalationResult>;
}

/** Result from escalation attempt. */
export interface EscalationResult {
  success: boolean;
  agentId?: string;
  queuePosition?: number;
  estimatedWaitMs?: number;
}

/**
 * Audit emitter for conversational AI interactions.
 */
export interface ConversationalAuditEmitter {
  emit(record: ConversationalAuditRecord): Promise<void>;
}

/** Audit record for a conversational interaction. */
export interface ConversationalAuditRecord {
  sessionId: string;
  timestamp: ISO8601;
  channel: ConversationChannel;
  input: string;
  output: string;
  language: LanguageCode;
  intent: DetectedIntent;
  confidence: number;
  escalationRequired: boolean;
  contentSafetyPassed: boolean;
  latencyMs: number;
}

// ─── Service Configuration ─────────────────────────────────────────────────────

/** Latency targets per channel (p95). */
export interface LatencyTargets {
  /** Maximum response latency for mobile channel (ms). */
  mobile: number;
  /** Maximum response latency for IVR channel (ms). */
  ivr: number;
  /** Maximum response latency for web channel (ms). */
  web: number;
}

/** Configuration for the Conversational AI Service. */
export interface ConversationalAIConfig {
  /** Supported languages for intent recognition and response generation. */
  supportedLanguages: LanguageCode[];
  /** Default fallback language when detection fails. */
  defaultLanguage: LanguageCode;
  /** Confidence threshold below which escalation is triggered. */
  escalationConfidenceThreshold: number;
  /** Maximum session transfer time in milliseconds. */
  maxSessionTransferMs: number;
  /** Maximum escalation time in milliseconds. */
  maxEscalationMs: number;
  /** Latency targets per channel (p95). */
  latencyTargets: LatencyTargets;
  /** Minimum intent recognition accuracy per language (0.00-1.00). */
  minIntentAccuracy: number;
}

/** Default configuration. */
export const DEFAULT_CONVERSATIONAL_AI_CONFIG: ConversationalAIConfig = {
  supportedLanguages: ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'zh', 'ar'],
  defaultLanguage: 'en',
  escalationConfidenceThreshold: 0.70,
  maxSessionTransferMs: 3000,
  maxEscalationMs: 10000,
  latencyTargets: {
    mobile: 5000,
    ivr: 3000,
    web: 5000,
  },
  minIntentAccuracy: 0.90,
};

/** All 11 supported languages. */
export const SUPPORTED_LANGUAGES: LanguageCode[] = [
  'en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'zh', 'ar',
];
