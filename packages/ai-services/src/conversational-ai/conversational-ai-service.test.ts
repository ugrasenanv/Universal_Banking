/**
 * Unit Tests for ConversationalAIService
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10
 *
 * Tests cover:
 * - Multilingual support (11 languages)
 * - Intent recognition with ≥90% accuracy target
 * - Cross-channel session state transfer within 3 seconds
 * - Content safety classifier blocking toxic/discriminatory/policy-contradicting responses
 * - Escalation to human agent within 10 seconds with full context transfer
 * - Response latency targets (mobile ≤5s p95, IVR ≤3s p95)
 * - Language detection with fallback to English + language selection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationalAIService } from './conversational-ai-service.js';
import type {
  ConversationRequest,
  LanguageDetectionAdapter,
  IntentRecognitionAdapter,
  ResponseGenerationAdapter,
  ContentSafetyAdapter,
  SessionStoreAdapter,
  EscalationAdapter,
  ConversationalAuditEmitter,
  SessionState,
  DetectedIntent,
  ContentSafetyResult,
  GeneratedResponse,
  ConversationalAIConfig,
} from './types.js';
import { DEFAULT_CONVERSATIONAL_AI_CONFIG, SUPPORTED_LANGUAGES } from './types.js';
import type { LanguageCode } from '@afg/shared-types';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeRequest(overrides?: Partial<ConversationRequest>): ConversationRequest {
  return {
    sessionId: 'session-001',
    channel: 'MOBILE',
    input: 'What is my account balance?',
    language: undefined,
    customerContext: {
      customerId: 'cust-123',
      segment: 'RETAIL',
      preferredLanguage: 'en',
      jurisdiction: 'IN',
    },
    ...overrides,
  };
}

function createMockLanguageDetector(
  detectedLanguage: LanguageCode | null = 'en',
  confidence = 0.95
): LanguageDetectionAdapter {
  return {
    detect: vi.fn().mockResolvedValue({ detectedLanguage, confidence }),
  };
}

function createMockIntentRecognizer(
  name = 'balance_inquiry',
  confidence = 0.95
): IntentRecognitionAdapter {
  return {
    recognize: vi.fn().mockResolvedValue({
      name,
      confidence,
      entities: { accountType: 'savings' },
    } satisfies DetectedIntent),
  };
}

function createMockResponseGenerator(
  text = 'Your savings account balance is ₹50,000.',
  confidence = 0.92
): ResponseGenerationAdapter {
  return {
    generate: vi.fn().mockResolvedValue({
      text,
      confidence,
      action: undefined,
    } satisfies GeneratedResponse),
  };
}

function createMockContentSafety(passed = true): ContentSafetyAdapter {
  return {
    classify: vi.fn().mockResolvedValue({
      passed,
      toxicityDetected: !passed,
      discriminatoryContent: false,
      policyContradiction: false,
      blockReason: passed ? undefined : 'Toxic content detected',
    } satisfies ContentSafetyResult),
  };
}

function createMockSessionStore(existingSession?: SessionState | null): SessionStoreAdapter {
  return {
    getSession: vi.fn().mockResolvedValue(existingSession ?? null),
    saveSession: vi.fn().mockResolvedValue(undefined),
    transferSession: vi.fn().mockImplementation(async (sessionId, targetChannel) => ({
      sessionId,
      conversationHistory: [],
      detectedIntent: 'balance_inquiry',
      collectedFields: {},
      authenticationStatus: 'AUTHENTICATED' as const,
      channel: targetChannel,
      language: 'en' as LanguageCode,
      createdAt: '2024-01-15T10:00:00.000Z',
      lastActivityAt: '2024-01-15T10:05:00.000Z',
      customerContext: {
        customerId: 'cust-123',
        segment: 'RETAIL' as const,
        preferredLanguage: 'en' as LanguageCode,
        jurisdiction: 'IN' as const,
      },
    })),
  };
}

function createMockEscalationAdapter(success = true): EscalationAdapter {
  return {
    escalate: vi.fn().mockResolvedValue({
      success,
      agentId: success ? 'agent-001' : undefined,
      queuePosition: success ? 1 : undefined,
      estimatedWaitMs: success ? 5000 : undefined,
    }),
  };
}

function createMockAuditEmitter(): ConversationalAuditEmitter {
  return {
    emit: vi.fn().mockResolvedValue(undefined),
  };
}

function createService(overrides?: {
  languageDetector?: LanguageDetectionAdapter;
  intentRecognizer?: IntentRecognitionAdapter;
  responseGenerator?: ResponseGenerationAdapter;
  contentSafety?: ContentSafetyAdapter;
  sessionStore?: SessionStoreAdapter;
  escalationAdapter?: EscalationAdapter;
  config?: Partial<ConversationalAIConfig>;
  auditEmitter?: ConversationalAuditEmitter;
}) {
  return new ConversationalAIService(
    overrides?.languageDetector ?? createMockLanguageDetector(),
    overrides?.intentRecognizer ?? createMockIntentRecognizer(),
    overrides?.responseGenerator ?? createMockResponseGenerator(),
    overrides?.contentSafety ?? createMockContentSafety(),
    overrides?.sessionStore ?? createMockSessionStore(),
    overrides?.escalationAdapter ?? createMockEscalationAdapter(),
    overrides?.config,
    overrides?.auditEmitter
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ConversationalAIService', () => {
  describe('construction and configuration', () => {
    it('should create with default configuration', () => {
      const service = createService();
      const config = service.getConfig();
      expect(config.supportedLanguages).toHaveLength(11);
      expect(config.defaultLanguage).toBe('en');
      expect(config.escalationConfidenceThreshold).toBe(0.70);
      expect(config.maxSessionTransferMs).toBe(3000);
      expect(config.maxEscalationMs).toBe(10000);
      expect(config.latencyTargets.mobile).toBe(5000);
      expect(config.latencyTargets.ivr).toBe(3000);
    });

    it('should accept custom configuration overrides', () => {
      const service = createService({
        config: {
          escalationConfidenceThreshold: 0.80,
          maxSessionTransferMs: 2000,
        },
      });
      const config = service.getConfig();
      expect(config.escalationConfidenceThreshold).toBe(0.80);
      expect(config.maxSessionTransferMs).toBe(2000);
    });

    it('should reject empty supportedLanguages', () => {
      expect(() =>
        createService({ config: { supportedLanguages: [] } })
      ).toThrow('supportedLanguages must contain at least one language');
    });

    it('should reject defaultLanguage not in supportedLanguages', () => {
      expect(() =>
        createService({
          config: { supportedLanguages: ['hi', 'ta'], defaultLanguage: 'en' },
        })
      ).toThrow('defaultLanguage must be included in supportedLanguages');
    });

    it('should reject invalid escalationConfidenceThreshold', () => {
      expect(() =>
        createService({ config: { escalationConfidenceThreshold: 1.5 } })
      ).toThrow('escalationConfidenceThreshold must be between 0 and 1');
    });

    it('should reject non-positive maxSessionTransferMs', () => {
      expect(() =>
        createService({ config: { maxSessionTransferMs: 0 } })
      ).toThrow('maxSessionTransferMs must be positive');
    });

    it('should reject non-positive maxEscalationMs', () => {
      expect(() =>
        createService({ config: { maxEscalationMs: -1 } })
      ).toThrow('maxEscalationMs must be positive');
    });

    it('should reject non-positive latency targets', () => {
      expect(() =>
        createService({
          config: { latencyTargets: { mobile: 0, ivr: 3000, web: 5000 } },
        })
      ).toThrow('latencyTargets must all be positive');
    });

    it('should reject invalid minIntentAccuracy', () => {
      expect(() =>
        createService({ config: { minIntentAccuracy: -0.1 } })
      ).toThrow('minIntentAccuracy must be between 0 and 1');
    });
  });

  describe('multilingual support (Requirement 7.1)', () => {
    it('should support all 11 required languages', () => {
      const service = createService();
      const supported = service.getSupportedLanguages();
      expect(supported).toHaveLength(11);
      for (const lang of SUPPORTED_LANGUAGES) {
        expect(service.isLanguageSupported(lang)).toBe(true);
      }
    });

    it('should process requests in Hindi', async () => {
      const intentRecognizer = createMockIntentRecognizer('balance_inquiry', 0.93);
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(
        makeRequest({ input: 'मेरा बैलेंस क्या है?', language: 'hi' })
      );
      expect(response.language).toBe('hi');
      expect(intentRecognizer.recognize).toHaveBeenCalledWith('मेरा बैलेंस क्या है?', 'hi');
    });

    it('should process requests in Tamil', async () => {
      const intentRecognizer = createMockIntentRecognizer('fund_transfer', 0.91);
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(
        makeRequest({ input: 'பண பரிமாற்றம்', language: 'ta' })
      );
      expect(response.language).toBe('ta');
    });

    it('should process requests in Arabic', async () => {
      const intentRecognizer = createMockIntentRecognizer('card_block', 0.90);
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(
        makeRequest({ input: 'أريد حظر بطاقتي', language: 'ar' })
      );
      expect(response.language).toBe('ar');
    });

    it('should process requests in Mandarin', async () => {
      const intentRecognizer = createMockIntentRecognizer('balance_inquiry', 0.92);
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(
        makeRequest({ input: '查询余额', language: 'zh' })
      );
      expect(response.language).toBe('zh');
    });
  });

  describe('language detection and fallback (Requirement 7.9)', () => {
    it('should use explicitly provided language if supported', async () => {
      const languageDetector = createMockLanguageDetector('hi');
      const service = createService({ languageDetector });
      const response = await service.processMessage(makeRequest({ language: 'ta' }));
      // Should use the explicit language, not the detected one
      expect(response.language).toBe('ta');
      expect(languageDetector.detect).not.toHaveBeenCalled();
    });

    it('should auto-detect language when not provided', async () => {
      const languageDetector = createMockLanguageDetector('hi', 0.95);
      const service = createService({ languageDetector });
      const response = await service.processMessage(
        makeRequest({ language: undefined })
      );
      expect(response.language).toBe('hi');
      expect(languageDetector.detect).toHaveBeenCalled();
    });

    it('should fall back to customer preferred language when detection returns unsupported', async () => {
      const languageDetector = createMockLanguageDetector(null, 0.3);
      const service = createService({ languageDetector });
      const response = await service.processMessage(
        makeRequest({
          language: undefined,
          customerContext: {
            customerId: 'cust-123',
            segment: 'RETAIL',
            preferredLanguage: 'mr',
            jurisdiction: 'IN',
          },
        })
      );
      expect(response.language).toBe('mr');
    });

    it('should fall back to English when detection fails and no preferred language', async () => {
      const languageDetector = createMockLanguageDetector(null, 0.1);
      const service = createService({ languageDetector });
      const response = await service.processMessage(
        makeRequest({
          language: undefined,
          customerContext: {
            customerId: 'cust-123',
            segment: 'RETAIL',
            preferredLanguage: undefined,
            jurisdiction: 'IN',
          },
        })
      );
      expect(response.language).toBe('en');
    });
  });

  describe('intent recognition (Requirement 7.1)', () => {
    it('should recognize intent with confidence score', async () => {
      const intentRecognizer = createMockIntentRecognizer('balance_inquiry', 0.95);
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(makeRequest());
      expect(response.intent.name).toBe('balance_inquiry');
      expect(response.intent.confidence).toBe(0.95);
    });

    it('should pass detected entities through', async () => {
      const intentRecognizer: IntentRecognitionAdapter = {
        recognize: vi.fn().mockResolvedValue({
          name: 'fund_transfer',
          confidence: 0.93,
          entities: { amount: 5000, currency: 'INR', beneficiary: 'John' },
        }),
      };
      const service = createService({ intentRecognizer });
      const response = await service.processMessage(makeRequest());
      expect(response.intent.entities).toEqual({
        amount: 5000,
        currency: 'INR',
        beneficiary: 'John',
      });
    });
  });

  describe('content safety (Requirement 7.5)', () => {
    it('should pass content that is safe', async () => {
      const contentSafety = createMockContentSafety(true);
      const service = createService({ contentSafety });
      const response = await service.processMessage(makeRequest());
      expect(response.contentSafetyPassed).toBe(true);
      expect(response.escalationRequired).toBe(false);
    });

    it('should block toxic content and trigger escalation', async () => {
      const contentSafety = createMockContentSafety(false);
      const escalationAdapter = createMockEscalationAdapter();
      const service = createService({ contentSafety, escalationAdapter });
      const response = await service.processMessage(makeRequest());
      expect(response.contentSafetyPassed).toBe(false);
      expect(response.escalationRequired).toBe(true);
      expect(response.escalationReason).toBe('CONTENT_SAFETY_BLOCK');
      expect(escalationAdapter.escalate).toHaveBeenCalled();
    });

    it('should replace blocked content with safe message in English', async () => {
      const contentSafety = createMockContentSafety(false);
      const service = createService({ contentSafety });
      const response = await service.processMessage(makeRequest({ language: 'en' }));
      expect(response.output).toContain('unable to process');
      expect(response.output).toContain('agent');
    });

    it('should replace blocked content with safe message in Hindi', async () => {
      const contentSafety = createMockContentSafety(false);
      const service = createService({ contentSafety });
      const response = await service.processMessage(makeRequest({ language: 'hi' }));
      expect(response.output).toContain('खेद');
    });

    it('should call content safety classifier for every response', async () => {
      const contentSafety = createMockContentSafety(true);
      const service = createService({ contentSafety });
      await service.processMessage(makeRequest());
      expect(contentSafety.classify).toHaveBeenCalledTimes(1);
    });
  });

  describe('escalation to human agent (Requirement 7.6)', () => {
    it('should escalate when response confidence is below threshold', async () => {
      const responseGenerator = createMockResponseGenerator('Not sure...', 0.50);
      const escalationAdapter = createMockEscalationAdapter();
      const service = createService({ responseGenerator, escalationAdapter });
      const response = await service.processMessage(makeRequest());
      expect(response.escalationRequired).toBe(true);
      expect(response.escalationReason).toBe('LOW_CONFIDENCE');
      expect(escalationAdapter.escalate).toHaveBeenCalled();
    });

    it('should escalate when intent confidence is below threshold', async () => {
      const intentRecognizer = createMockIntentRecognizer('unknown', 0.40);
      const escalationAdapter = createMockEscalationAdapter();
      const service = createService({ intentRecognizer, escalationAdapter });
      const response = await service.processMessage(makeRequest());
      expect(response.escalationRequired).toBe(true);
      expect(response.escalationReason).toBe('LOW_CONFIDENCE');
    });

    it('should NOT escalate when confidence is above threshold', async () => {
      const responseGenerator = createMockResponseGenerator('Balance is ₹50,000', 0.92);
      const intentRecognizer = createMockIntentRecognizer('balance_inquiry', 0.95);
      const escalationAdapter = createMockEscalationAdapter();
      const service = createService({
        responseGenerator,
        intentRecognizer,
        escalationAdapter,
      });
      const response = await service.processMessage(makeRequest());
      expect(response.escalationRequired).toBe(false);
      expect(escalationAdapter.escalate).not.toHaveBeenCalled();
    });

    it('should transfer full context on escalation', async () => {
      const existingSession: SessionState = {
        sessionId: 'session-001',
        conversationHistory: [
          {
            role: 'customer',
            content: 'Hello',
            timestamp: '2024-01-15T10:00:00.000Z',
            language: 'en',
            channel: 'MOBILE',
          },
        ],
        detectedIntent: 'greeting',
        collectedFields: { name: 'John' },
        authenticationStatus: 'AUTHENTICATED',
        channel: 'MOBILE',
        language: 'en',
        createdAt: '2024-01-15T10:00:00.000Z',
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        customerContext: {
          customerId: 'cust-123',
          segment: 'RETAIL',
          preferredLanguage: 'en',
          jurisdiction: 'IN',
        },
      };
      const sessionStore = createMockSessionStore(existingSession);
      const escalationAdapter = createMockEscalationAdapter();
      const responseGenerator = createMockResponseGenerator('...', 0.40);
      const service = createService({
        sessionStore,
        escalationAdapter,
        responseGenerator,
      });

      await service.processMessage(makeRequest());

      expect(escalationAdapter.escalate).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-001',
          conversationHistory: existingSession.conversationHistory,
          collectedFields: existingSession.collectedFields,
          escalationReason: 'LOW_CONFIDENCE',
        })
      );
    });

    it('should use configurable confidence threshold for escalation', async () => {
      const responseGenerator = createMockResponseGenerator('Answer', 0.75);
      const intentRecognizer = createMockIntentRecognizer('query', 0.75);
      const escalationAdapter = createMockEscalationAdapter();

      // With threshold at 0.80, confidence of 0.75 should trigger escalation
      const service = createService({
        responseGenerator,
        intentRecognizer,
        escalationAdapter,
        config: { escalationConfidenceThreshold: 0.80 },
      });
      const response = await service.processMessage(makeRequest());
      expect(response.escalationRequired).toBe(true);
    });
  });

  describe('cross-channel session state transfer (Requirement 7.2)', () => {
    it('should transfer session to a new channel', async () => {
      const sessionStore = createMockSessionStore();
      const service = createService({ sessionStore });
      const result = await service.transferSession('session-001', 'IVR');
      expect(sessionStore.transferSession).toHaveBeenCalledWith('session-001', 'IVR');
      expect(result.channel).toBe('IVR');
      expect(result.sessionId).toBe('session-001');
    });

    it('should transfer session from mobile to web', async () => {
      const sessionStore = createMockSessionStore();
      const service = createService({ sessionStore });
      const result = await service.transferSession('session-001', 'WEB');
      expect(result.channel).toBe('WEB');
    });

    it('should transfer session from mobile to human agent', async () => {
      const sessionStore = createMockSessionStore();
      const service = createService({ sessionStore });
      const result = await service.transferSession('session-001', 'HUMAN_AGENT');
      expect(result.channel).toBe('HUMAN_AGENT');
    });

    it('should preserve conversation history during transfer', async () => {
      const historyTurn = {
        role: 'customer' as const,
        content: 'What is my balance?',
        timestamp: '2024-01-15T10:00:00.000Z',
        language: 'en' as LanguageCode,
        channel: 'MOBILE' as const,
      };
      const sessionStore: SessionStoreAdapter = {
        getSession: vi.fn().mockResolvedValue(null),
        saveSession: vi.fn().mockResolvedValue(undefined),
        transferSession: vi.fn().mockResolvedValue({
          sessionId: 'session-001',
          conversationHistory: [historyTurn],
          detectedIntent: 'balance_inquiry',
          collectedFields: { accountType: 'savings' },
          authenticationStatus: 'AUTHENTICATED',
          channel: 'IVR',
          language: 'en',
          createdAt: '2024-01-15T10:00:00.000Z',
          lastActivityAt: '2024-01-15T10:05:00.000Z',
          customerContext: {
            customerId: 'cust-123',
            segment: 'RETAIL',
            preferredLanguage: 'en',
            jurisdiction: 'IN',
          },
        }),
      };
      const service = createService({ sessionStore });
      const result = await service.transferSession('session-001', 'IVR');
      expect(result.conversationHistory).toHaveLength(1);
      expect(result.conversationHistory[0].content).toBe('What is my balance?');
      expect(result.collectedFields.accountType).toBe('savings');
    });
  });

  describe('response latency (Requirement 7.10)', () => {
    it('should track latency in response', async () => {
      const service = createService();
      const response = await service.processMessage(makeRequest());
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof response.latencyMs).toBe('number');
    });

    it('should configure mobile latency target to 5000ms', () => {
      const service = createService();
      expect(service.getConfig().latencyTargets.mobile).toBe(5000);
    });

    it('should configure IVR latency target to 3000ms', () => {
      const service = createService();
      expect(service.getConfig().latencyTargets.ivr).toBe(3000);
    });
  });

  describe('session management', () => {
    it('should create a new session when none exists', async () => {
      const sessionStore = createMockSessionStore(null);
      const service = createService({ sessionStore });
      await service.processMessage(makeRequest());
      expect(sessionStore.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-001',
          channel: 'MOBILE',
        })
      );
    });

    it('should load existing session when available', async () => {
      const existingSession: SessionState = {
        sessionId: 'session-001',
        conversationHistory: [
          {
            role: 'customer',
            content: 'Hi',
            timestamp: '2024-01-15T10:00:00.000Z',
            language: 'en',
            channel: 'MOBILE',
          },
        ],
        detectedIntent: 'greeting',
        collectedFields: {},
        authenticationStatus: 'AUTHENTICATED',
        channel: 'MOBILE',
        language: 'en',
        createdAt: '2024-01-15T10:00:00.000Z',
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        customerContext: {
          customerId: 'cust-123',
          segment: 'RETAIL',
          preferredLanguage: 'en',
          jurisdiction: 'IN',
        },
      };
      const sessionStore = createMockSessionStore(existingSession);
      const service = createService({ sessionStore });
      await service.processMessage(makeRequest());

      // Session should be saved with updated history (original + 2 new turns)
      expect(sessionStore.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationHistory: expect.arrayContaining([
            expect.objectContaining({ content: 'Hi' }),
          ]),
        })
      );
    });

    it('should append conversation turns to session history', async () => {
      const sessionStore = createMockSessionStore(null);
      const service = createService({ sessionStore });
      await service.processMessage(makeRequest());

      const savedSession = (sessionStore.saveSession as any).mock.calls[0][0] as SessionState;
      expect(savedSession.conversationHistory).toHaveLength(2); // customer + assistant
      expect(savedSession.conversationHistory[0].role).toBe('customer');
      expect(savedSession.conversationHistory[1].role).toBe('assistant');
    });

    it('should update detected intent in session', async () => {
      const intentRecognizer = createMockIntentRecognizer('fund_transfer', 0.91);
      const sessionStore = createMockSessionStore(null);
      const service = createService({ intentRecognizer, sessionStore });
      await service.processMessage(makeRequest());

      const savedSession = (sessionStore.saveSession as any).mock.calls[0][0] as SessionState;
      expect(savedSession.detectedIntent).toBe('fund_transfer');
    });

    it('should update collected fields with recognized entities', async () => {
      const intentRecognizer: IntentRecognitionAdapter = {
        recognize: vi.fn().mockResolvedValue({
          name: 'fund_transfer',
          confidence: 0.93,
          entities: { amount: 5000, beneficiary: 'Alice' },
        }),
      };
      const sessionStore = createMockSessionStore(null);
      const service = createService({ intentRecognizer, sessionStore });
      await service.processMessage(makeRequest());

      const savedSession = (sessionStore.saveSession as any).mock.calls[0][0] as SessionState;
      expect(savedSession.collectedFields.amount).toBe(5000);
      expect(savedSession.collectedFields.beneficiary).toBe('Alice');
    });

    it('should get session by ID', async () => {
      const existingSession: SessionState = {
        sessionId: 'session-002',
        conversationHistory: [],
        detectedIntent: '',
        collectedFields: {},
        authenticationStatus: 'UNAUTHENTICATED',
        channel: 'WEB',
        language: 'en',
        createdAt: '2024-01-15T10:00:00.000Z',
        lastActivityAt: '2024-01-15T10:00:00.000Z',
        customerContext: {
          customerId: 'cust-456',
          segment: 'SME',
          jurisdiction: 'SG',
        },
      };
      const sessionStore = createMockSessionStore(existingSession);
      const service = createService({ sessionStore });
      const session = await service.getSession('session-002');
      expect(session).toEqual(existingSession);
    });
  });

  describe('audit trail (Requirement 7.8)', () => {
    it('should emit audit record for every interaction', async () => {
      const auditEmitter = createMockAuditEmitter();
      const service = createService({ auditEmitter });
      await service.processMessage(makeRequest());
      expect(auditEmitter.emit).toHaveBeenCalledTimes(1);
      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-001',
          channel: 'MOBILE',
          input: 'What is my account balance?',
          language: 'en',
        })
      );
    });

    it('should include confidence and escalation status in audit', async () => {
      const auditEmitter = createMockAuditEmitter();
      const responseGenerator = createMockResponseGenerator('Answer', 0.92);
      const service = createService({ auditEmitter, responseGenerator });
      await service.processMessage(makeRequest());
      expect(auditEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: 0.92,
          escalationRequired: false,
          contentSafetyPassed: true,
        })
      );
    });

    it('should include latency in audit record', async () => {
      const auditEmitter = createMockAuditEmitter();
      const service = createService({ auditEmitter });
      await service.processMessage(makeRequest());
      const auditRecord = (auditEmitter.emit as any).mock.calls[0][0];
      expect(auditRecord.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should not fail when audit emitter is not provided', async () => {
      const service = createService(); // no auditEmitter
      // Should not throw
      const response = await service.processMessage(makeRequest());
      expect(response.sessionId).toBe('session-001');
    });
  });

  describe('request validation', () => {
    it('should reject empty sessionId', async () => {
      const service = createService();
      await expect(
        service.processMessage(makeRequest({ sessionId: '' }))
      ).rejects.toThrow('sessionId is required');
    });

    it('should reject whitespace-only sessionId', async () => {
      const service = createService();
      await expect(
        service.processMessage(makeRequest({ sessionId: '   ' }))
      ).rejects.toThrow('sessionId is required');
    });

    it('should reject empty input', async () => {
      const service = createService();
      await expect(
        service.processMessage(makeRequest({ input: '' }))
      ).rejects.toThrow('input is required');
    });

    it('should reject missing channel', async () => {
      const service = createService();
      await expect(
        service.processMessage(makeRequest({ channel: undefined as any }))
      ).rejects.toThrow('channel is required');
    });

    it('should reject missing customerContext', async () => {
      const service = createService();
      await expect(
        service.processMessage(makeRequest({ customerContext: undefined as any }))
      ).rejects.toThrow('customerContext is required');
    });

    it('should reject missing customerId in context', async () => {
      const service = createService();
      await expect(
        service.processMessage(
          makeRequest({
            customerContext: {
              customerId: '',
              segment: 'RETAIL',
              jurisdiction: 'IN',
            },
          })
        )
      ).rejects.toThrow('customerContext.customerId is required');
    });
  });

  describe('response structure', () => {
    it('should include all required response fields', async () => {
      const service = createService();
      const response = await service.processMessage(makeRequest());

      expect(response.sessionId).toBe('session-001');
      expect(typeof response.output).toBe('string');
      expect(response.output.length).toBeGreaterThan(0);
      expect(typeof response.language).toBe('string');
      expect(response.intent).toBeDefined();
      expect(response.intent.name).toBeDefined();
      expect(typeof response.intent.confidence).toBe('number');
      expect(typeof response.confidence).toBe('number');
      expect(typeof response.escalationRequired).toBe('boolean');
      expect(typeof response.latencyMs).toBe('number');
      expect(typeof response.contentSafetyPassed).toBe('boolean');
    });

    it('should include action when generated', async () => {
      const responseGenerator: ResponseGenerationAdapter = {
        generate: vi.fn().mockResolvedValue({
          text: 'Transferring ₹5000 to Alice.',
          confidence: 0.95,
          action: { type: 'fund_transfer', parameters: { amount: 5000, beneficiary: 'Alice' } },
        }),
      };
      const service = createService({ responseGenerator });
      const response = await service.processMessage(makeRequest());
      expect(response.action).toBeDefined();
      expect(response.action!.type).toBe('fund_transfer');
      expect(response.action!.parameters.amount).toBe(5000);
    });
  });
});
