/**
 * Conversational AI Service
 *
 * Multilingual virtual assistant for retail banking customers
 * across mobile, IVR, and web channels. Supports 11 languages,
 * cross-channel session state transfer, content safety classification,
 * and escalation to human agents.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10
 */

import type { LanguageCode, ISO8601 } from '@afg/shared-types';
import type {
  ConversationRequest,
  ConversationResponse,
  ConversationalAIConfig,
  SessionState,
  ConversationTurn,
  EscalationContext,
  DetectedIntent,
  ContentSafetyResult,
  LanguageDetectionAdapter,
  IntentRecognitionAdapter,
  ResponseGenerationAdapter,
  ContentSafetyAdapter,
  SessionStoreAdapter,
  EscalationAdapter,
  ConversationalAuditEmitter,
  ConversationChannel,
  EscalationReason,
} from './types.js';
import { DEFAULT_CONVERSATIONAL_AI_CONFIG, SUPPORTED_LANGUAGES } from './types.js';

/**
 * ConversationalAIService provides a multilingual virtual assistant
 * for retail banking customers. Key capabilities:
 *
 * - 11 language support with auto-detection and fallback to English
 * - Intent recognition with ≥90% accuracy target per language
 * - Cross-channel session state transfer within 3 seconds
 * - Content safety classification blocking toxic/discriminatory responses
 * - Escalation to human agent within 10 seconds with full context
 * - Response latency targets: mobile ≤5s p95, IVR ≤3s p95
 */
export class ConversationalAIService {
  private readonly config: ConversationalAIConfig;
  private readonly languageDetector: LanguageDetectionAdapter;
  private readonly intentRecognizer: IntentRecognitionAdapter;
  private readonly responseGenerator: ResponseGenerationAdapter;
  private readonly contentSafety: ContentSafetyAdapter;
  private readonly sessionStore: SessionStoreAdapter;
  private readonly escalationAdapter: EscalationAdapter;
  private readonly auditEmitter?: ConversationalAuditEmitter;

  constructor(
    languageDetector: LanguageDetectionAdapter,
    intentRecognizer: IntentRecognitionAdapter,
    responseGenerator: ResponseGenerationAdapter,
    contentSafety: ContentSafetyAdapter,
    sessionStore: SessionStoreAdapter,
    escalationAdapter: EscalationAdapter,
    config?: Partial<ConversationalAIConfig>,
    auditEmitter?: ConversationalAuditEmitter
  ) {
    this.config = { ...DEFAULT_CONVERSATIONAL_AI_CONFIG, ...config };
    this.languageDetector = languageDetector;
    this.intentRecognizer = intentRecognizer;
    this.responseGenerator = responseGenerator;
    this.contentSafety = contentSafety;
    this.sessionStore = sessionStore;
    this.escalationAdapter = escalationAdapter;
    this.auditEmitter = auditEmitter;

    this.validateConfig(this.config);
  }

  /**
   * Process a customer conversation input and generate a response.
   *
   * Flow:
   * 1. Detect/resolve language (auto-detect or use provided)
   * 2. Load or create session state
   * 3. Recognize intent
   * 4. Generate response
   * 5. Run content safety classifier
   * 6. Handle escalation if needed
   * 7. Update session state
   * 8. Emit audit record
   */
  async processMessage(request: ConversationRequest): Promise<ConversationResponse> {
    const startTime = Date.now();

    this.validateRequest(request);

    // Step 1: Resolve language
    const language = await this.resolveLanguage(request);

    // Step 2: Load or create session
    let session = await this.loadOrCreateSession(request, language);

    // Step 3: Recognize intent
    const intent = await this.intentRecognizer.recognize(request.input, language);

    // Step 4: Generate response
    const generatedResponse = await this.responseGenerator.generate(
      intent,
      session,
      language
    );

    // Step 5: Content safety check
    const safetyResult = await this.contentSafety.classify(
      generatedResponse.text,
      language
    );

    // Step 6: Determine if escalation is needed
    const escalationRequired = this.shouldEscalate(
      intent,
      generatedResponse.confidence,
      safetyResult
    );

    let escalationReason: EscalationReason | undefined;
    let outputText = generatedResponse.text;

    if (!safetyResult.passed) {
      escalationReason = 'CONTENT_SAFETY_BLOCK';
      outputText = this.getSafetyBlockMessage(language);
    } else if (escalationRequired) {
      escalationReason = this.getEscalationReason(intent, generatedResponse.confidence);
    }

    // Step 7: Perform escalation if required
    if (escalationRequired) {
      const escalationContext = this.buildEscalationContext(
        session,
        intent,
        escalationReason!
      );
      await this.escalationAdapter.escalate(escalationContext);
    }

    // Step 8: Update session state
    const now = new Date().toISOString() as ISO8601;
    session = this.updateSessionState(session, request, outputText, language, intent, now);
    await this.sessionStore.saveSession(session);

    const latencyMs = Date.now() - startTime;

    // Step 9: Build response
    const response: ConversationResponse = {
      sessionId: request.sessionId,
      output: outputText,
      language,
      intent,
      confidence: generatedResponse.confidence,
      action: generatedResponse.action,
      escalationRequired,
      escalationReason,
      latencyMs,
      contentSafetyPassed: safetyResult.passed,
    };

    // Step 10: Emit audit
    if (this.auditEmitter) {
      await this.auditEmitter.emit({
        sessionId: request.sessionId,
        timestamp: now,
        channel: request.channel,
        input: request.input,
        output: outputText,
        language,
        intent,
        confidence: generatedResponse.confidence,
        escalationRequired,
        contentSafetyPassed: safetyResult.passed,
        latencyMs,
      });
    }

    return response;
  }

  /**
   * Transfer session state to a different channel.
   * Must complete within 3 seconds (Requirement 7.2).
   */
  async transferSession(
    sessionId: string,
    targetChannel: ConversationChannel
  ): Promise<SessionState> {
    const startTime = Date.now();

    const session = await this.sessionStore.transferSession(sessionId, targetChannel);

    const transferTime = Date.now() - startTime;
    if (transferTime > this.config.maxSessionTransferMs) {
      // Log warning but don't fail — the transfer completed
      console.warn(
        `Session transfer exceeded target: ${transferTime}ms > ${this.config.maxSessionTransferMs}ms`
      );
    }

    return session;
  }

  /**
   * Get the current session state for a given session ID.
   */
  async getSession(sessionId: string): Promise<SessionState | null> {
    return this.sessionStore.getSession(sessionId);
  }

  /**
   * Get the current service configuration.
   */
  getConfig(): ConversationalAIConfig {
    return { ...this.config };
  }

  /**
   * Check if a language is supported.
   */
  isLanguageSupported(language: LanguageCode): boolean {
    return this.config.supportedLanguages.includes(language);
  }

  /**
   * Get the list of supported languages.
   */
  getSupportedLanguages(): LanguageCode[] {
    return [...this.config.supportedLanguages];
  }

  // ─── Private Methods ──────────────────────────────────────────────────────────

  /**
   * Resolve the language for this interaction:
   * 1. If explicitly provided in request, use it (if supported)
   * 2. Auto-detect from input text
   * 3. Fall back to customer's preferred language
   * 4. Fall back to English (Requirement 7.9)
   */
  private async resolveLanguage(request: ConversationRequest): Promise<LanguageCode> {
    // If language explicitly specified and supported, use it
    if (request.language && this.isLanguageSupported(request.language)) {
      return request.language;
    }

    // Auto-detect language from input
    const detection = await this.languageDetector.detect(request.input);

    if (detection.detectedLanguage && this.isLanguageSupported(detection.detectedLanguage)) {
      return detection.detectedLanguage;
    }

    // Fall back to customer's preferred language if available
    if (
      request.customerContext.preferredLanguage &&
      this.isLanguageSupported(request.customerContext.preferredLanguage)
    ) {
      return request.customerContext.preferredLanguage;
    }

    // Final fallback: English (Requirement 7.9)
    return this.config.defaultLanguage;
  }

  /**
   * Load existing session or create a new one.
   */
  private async loadOrCreateSession(
    request: ConversationRequest,
    language: LanguageCode
  ): Promise<SessionState> {
    const existing = await this.sessionStore.getSession(request.sessionId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString() as ISO8601;
    return {
      sessionId: request.sessionId,
      conversationHistory: [],
      detectedIntent: '',
      collectedFields: {},
      authenticationStatus: 'UNAUTHENTICATED',
      channel: request.channel,
      language,
      createdAt: now,
      lastActivityAt: now,
      customerContext: request.customerContext,
    };
  }

  /**
   * Determine whether escalation to a human agent is required.
   */
  private shouldEscalate(
    intent: DetectedIntent,
    responseConfidence: number,
    safetyResult: ContentSafetyResult
  ): boolean {
    // Escalate if content safety fails
    if (!safetyResult.passed) {
      return true;
    }

    // Escalate if confidence below threshold (Requirement 7.6)
    if (responseConfidence < this.config.escalationConfidenceThreshold) {
      return true;
    }

    // Escalate if intent confidence is too low
    if (intent.confidence < this.config.escalationConfidenceThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Determine the reason for escalation.
   */
  private getEscalationReason(
    intent: DetectedIntent,
    responseConfidence: number
  ): EscalationReason {
    if (
      intent.confidence < this.config.escalationConfidenceThreshold ||
      responseConfidence < this.config.escalationConfidenceThreshold
    ) {
      return 'LOW_CONFIDENCE';
    }
    return 'COMPLEX_QUERY';
  }

  /**
   * Build the escalation context for human agent handoff.
   */
  private buildEscalationContext(
    session: SessionState,
    intent: DetectedIntent,
    reason: EscalationReason
  ): EscalationContext {
    return {
      sessionId: session.sessionId,
      conversationHistory: session.conversationHistory,
      detectedIntent: intent.name,
      collectedFields: session.collectedFields,
      retrievedDocuments: [],
      suggestedResolution: `Intent: ${intent.name}, Confidence: ${intent.confidence}`,
      escalationReason: reason,
      timestamp: new Date().toISOString() as ISO8601,
    };
  }

  /**
   * Get the safety block message in the appropriate language.
   * When content is blocked, return a safe message to the customer.
   */
  private getSafetyBlockMessage(language: LanguageCode): string {
    const messages: Record<string, string> = {
      en: 'I apologize, but I am unable to process that request. Let me connect you with an agent who can help.',
      hi: 'मुझे खेद है, लेकिन मैं उस अनुरोध को संसाधित करने में असमर्थ हूँ। मैं आपको एक एजेंट से जोड़ता हूँ।',
      ta: 'மன்னிக்கவும், அந்த கோரிக்கையை செயல்படுத்த இயலவில்லை. உதவக்கூடிய ஒரு ஏஜெண்டுடன் இணைக்கிறேன்.',
      te: 'క్షమించండి, ఆ అభ్యర్థనను ప్రాసెస్ చేయడం సాధ్యం కాదు. మీకు సహాయం చేయగల ఏజెంట్‌తో కనెక్ట్ చేస్తాను.',
      mr: 'माफ करा, मी ती विनंती प्रक्रिया करू शकत नाही. मी तुम्हाला मदत करू शकणाऱ्या एजंटशी जोडतो.',
      bn: 'দুঃখিত, আমি সেই অনুরোধটি প্রক্রিয়া করতে অক্ষম। আমি আপনাকে একজন এজেন্টের সাথে সংযুক্ত করছি।',
      kn: 'ಕ್ಷಮಿಸಿ, ಆ ವಿನಂತಿಯನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಹುದಾದ ಏಜೆಂಟ್‌ಗೆ ಸಂಪರ್ಕಿಸುತ್ತೇನೆ.',
      ml: 'ക്ഷമിക്കണം, ആ അഭ്യർത്ഥന പ്രോസസ്സ് ചെയ്യാൻ കഴിയുന്നില്ല. നിങ്ങളെ സഹായിക്കാൻ കഴിയുന്ന ഒരു ഏജന്റുമായി ബന്ധിപ്പിക്കുന്നു.',
      gu: 'માફ કરશો, હું તે વિનંતી પ્રક્રિયા કરવામાં અસમર્થ છું. હું તમને મદદ કરી શકે તેવા એજન્ટ સાથે જોડું છું.',
      zh: '抱歉，我无法处理该请求。让我为您转接一位客服人员。',
      ar: 'أعتذر، لا أستطيع معالجة هذا الطلب. دعني أوصلك بوكيل يمكنه المساعدة.',
    };
    return messages[language] || messages.en;
  }

  /**
   * Update session state with the latest turn.
   */
  private updateSessionState(
    session: SessionState,
    request: ConversationRequest,
    output: string,
    language: LanguageCode,
    intent: DetectedIntent,
    timestamp: ISO8601
  ): SessionState {
    const customerTurn: ConversationTurn = {
      role: 'customer',
      content: request.input,
      timestamp,
      language,
      channel: request.channel,
    };

    const assistantTurn: ConversationTurn = {
      role: 'assistant',
      content: output,
      timestamp,
      language,
      channel: request.channel,
    };

    return {
      ...session,
      conversationHistory: [...session.conversationHistory, customerTurn, assistantTurn],
      detectedIntent: intent.name,
      collectedFields: { ...session.collectedFields, ...intent.entities },
      channel: request.channel,
      language,
      lastActivityAt: timestamp,
    };
  }

  /**
   * Validate the service configuration.
   */
  private validateConfig(config: ConversationalAIConfig): void {
    if (config.supportedLanguages.length === 0) {
      throw new Error('supportedLanguages must contain at least one language');
    }
    if (!config.supportedLanguages.includes(config.defaultLanguage)) {
      throw new Error('defaultLanguage must be included in supportedLanguages');
    }
    if (config.escalationConfidenceThreshold < 0 || config.escalationConfidenceThreshold > 1) {
      throw new Error('escalationConfidenceThreshold must be between 0 and 1');
    }
    if (config.maxSessionTransferMs <= 0) {
      throw new Error('maxSessionTransferMs must be positive');
    }
    if (config.maxEscalationMs <= 0) {
      throw new Error('maxEscalationMs must be positive');
    }
    if (config.latencyTargets.mobile <= 0 || config.latencyTargets.ivr <= 0 || config.latencyTargets.web <= 0) {
      throw new Error('latencyTargets must all be positive');
    }
    if (config.minIntentAccuracy < 0 || config.minIntentAccuracy > 1) {
      throw new Error('minIntentAccuracy must be between 0 and 1');
    }
  }

  /**
   * Validate the incoming request.
   */
  private validateRequest(request: ConversationRequest): void {
    if (!request.sessionId || request.sessionId.trim() === '') {
      throw new Error('sessionId is required');
    }
    if (!request.input || request.input.trim() === '') {
      throw new Error('input is required');
    }
    if (!request.channel) {
      throw new Error('channel is required');
    }
    if (!request.customerContext) {
      throw new Error('customerContext is required');
    }
    if (!request.customerContext.customerId) {
      throw new Error('customerContext.customerId is required');
    }
  }
}
