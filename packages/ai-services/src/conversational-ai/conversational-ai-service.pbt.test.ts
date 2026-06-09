/**
 * Property-Based Tests: Cross-Channel Session State Preservation
 *
 * **Validates: Requirements 7.2**
 *
 * Property 18: Cross-Channel Session State Preservation
 * For any active conversation session, transferring between channels
 * (mobile, IVR, web, human agent) SHALL preserve all session state fields
 * (conversation history, detected intent, collected data fields,
 * authentication status), and the transferred session SHALL be usable
 * on the destination channel without data loss.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConversationalAIService } from './conversational-ai-service.js';
import type {
  SessionState,
  ConversationChannel,
  ConversationTurn,
  AuthStatus,
  CustomerContext,
  SessionStoreAdapter,
  LanguageDetectionAdapter,
  IntentRecognitionAdapter,
  ResponseGenerationAdapter,
  ContentSafetyAdapter,
  EscalationAdapter,
} from './types.js';
import type { LanguageCode } from '@afg/shared-types';

// ─── Arbitraries / Generators ──────────────────────────────────────────────────

/** All valid conversation channels. */
const CHANNELS: ConversationChannel[] = ['MOBILE', 'IVR', 'WEB', 'HUMAN_AGENT'];

/** Generates a valid ConversationChannel. */
const channelArb: fc.Arbitrary<ConversationChannel> = fc.constantFrom(...CHANNELS);

/** Generates a valid authentication status. */
const authStatusArb: fc.Arbitrary<AuthStatus> = fc.constantFrom(
  'AUTHENTICATED',
  'UNAUTHENTICATED',
  'EXPIRED'
);

/** Generates a supported language code. */
const languageArb: fc.Arbitrary<LanguageCode> = fc.constantFrom(
  'en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'zh', 'ar'
) as fc.Arbitrary<LanguageCode>;

/** Generates a valid jurisdiction. */
const jurisdictionArb = fc.constantFrom('IN', 'SG', 'AE', 'GB', 'US') as fc.Arbitrary<
  'IN' | 'SG' | 'AE' | 'GB' | 'US'
>;

/** Generates a valid customer segment. */
const segmentArb = fc.constantFrom('RETAIL', 'SME', 'WEALTH', 'CORPORATE') as fc.Arbitrary<
  'RETAIL' | 'SME' | 'WEALTH' | 'CORPORATE'
>;

/** Generates an ISO8601 timestamp string. */
const timestampArb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

/** Generates a valid CustomerContext. */
const customerContextArb: fc.Arbitrary<CustomerContext> = fc.record({
  customerId: fc.uuid(),
  segment: segmentArb,
  preferredLanguage: fc.option(languageArb, { nil: undefined }),
  jurisdiction: jurisdictionArb,
});

/** Generates a single conversation turn. */
const conversationTurnArb: fc.Arbitrary<ConversationTurn> = fc.record({
  role: fc.constantFrom('customer', 'assistant') as fc.Arbitrary<'customer' | 'assistant'>,
  content: fc.string({ minLength: 1, maxLength: 200 }),
  timestamp: timestampArb,
  language: languageArb,
  channel: channelArb,
});

/** Generates collected fields (arbitrary key-value pairs). */
const collectedFieldsArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
  fc.oneof(
    fc.string({ maxLength: 50 }),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.boolean()
  ),
  { minKeys: 0, maxKeys: 10 }
);

/** Generates a valid SessionState with realistic data. */
const sessionStateArb: fc.Arbitrary<SessionState> = fc.record({
  sessionId: fc.uuid(),
  conversationHistory: fc.array(conversationTurnArb, { minLength: 0, maxLength: 20 }),
  detectedIntent: fc.string({ minLength: 0, maxLength: 50 }),
  collectedFields: collectedFieldsArb,
  authenticationStatus: authStatusArb,
  channel: channelArb,
  language: languageArb,
  createdAt: timestampArb,
  lastActivityAt: timestampArb,
  customerContext: customerContextArb,
});

// ─── Adapter Stubs ─────────────────────────────────────────────────────────────

/**
 * Creates a SessionStoreAdapter that faithfully transfers session state
 * to the target channel (simulating the real cross-channel transfer behaviour).
 * This preserves all fields and only updates the channel field.
 */
function createFaithfulSessionStore(session: SessionState): SessionStoreAdapter {
  return {
    getSession: async (sessionId: string) =>
      sessionId === session.sessionId ? session : null,
    saveSession: async () => {},
    transferSession: async (
      sessionId: string,
      targetChannel: ConversationChannel
    ): Promise<SessionState> => {
      if (sessionId !== session.sessionId) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      // Transfer preserves all state, only updating the channel
      return {
        ...session,
        channel: targetChannel,
      };
    },
  };
}

/** Minimal stub adapters for service construction. */
function createStubLanguageDetector(): LanguageDetectionAdapter {
  return { detect: async () => ({ detectedLanguage: 'en' as LanguageCode, confidence: 0.95 }) };
}

function createStubIntentRecognizer(): IntentRecognitionAdapter {
  return {
    recognize: async () => ({ name: 'general', confidence: 0.9, entities: {} }),
  };
}

function createStubResponseGenerator(): ResponseGenerationAdapter {
  return {
    generate: async () => ({ text: 'Response', confidence: 0.9, action: undefined }),
  };
}

function createStubContentSafety(): ContentSafetyAdapter {
  return {
    classify: async () => ({
      passed: true,
      toxicityDetected: false,
      discriminatoryContent: false,
      policyContradiction: false,
    }),
  };
}

function createStubEscalationAdapter(): EscalationAdapter {
  return {
    escalate: async () => ({ success: true, agentId: 'agent-1' }),
  };
}

/**
 * Creates a ConversationalAIService with a faithful session store
 * containing the given session.
 */
function createServiceWithSession(session: SessionState): ConversationalAIService {
  return new ConversationalAIService(
    createStubLanguageDetector(),
    createStubIntentRecognizer(),
    createStubResponseGenerator(),
    createStubContentSafety(),
    createFaithfulSessionStore(session),
    createStubEscalationAdapter()
  );
}

// ─── Property Tests ────────────────────────────────────────────────────────────

describe('Property 18: Cross-Channel Session State Preservation', () => {
  describe('18.1: Conversation history is preserved exactly during transfer', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * For any session transferred between channels (MOBILE, IVR, WEB, HUMAN_AGENT),
     * the conversation history is preserved exactly — same turns, same order,
     * same content.
     */
    it('conversation history is identical after transfer to any channel', async () => {
      await fc.assert(
        fc.asyncProperty(sessionStateArb, channelArb, async (session, targetChannel) => {
          const service = createServiceWithSession(session);

          const transferred = await service.transferSession(
            session.sessionId,
            targetChannel
          );

          // Conversation history must be preserved exactly
          expect(transferred.conversationHistory).toEqual(session.conversationHistory);
          expect(transferred.conversationHistory.length).toBe(
            session.conversationHistory.length
          );
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('18.2: Collected fields are never lost during transfer', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * For any session transferred between channels, all collected fields
     * (entities) present before the transfer must be present after the transfer
     * with the same values.
     */
    it('all collected fields are preserved after channel transfer', async () => {
      await fc.assert(
        fc.asyncProperty(sessionStateArb, channelArb, async (session, targetChannel) => {
          const service = createServiceWithSession(session);

          const transferred = await service.transferSession(
            session.sessionId,
            targetChannel
          );

          // Every key-value pair in collectedFields must be preserved
          expect(transferred.collectedFields).toEqual(session.collectedFields);

          // Double-check: no keys are lost
          for (const key of Object.keys(session.collectedFields)) {
            expect(transferred.collectedFields).toHaveProperty(key);
            expect(transferred.collectedFields[key]).toEqual(session.collectedFields[key]);
          }
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('18.3: Authentication status is maintained across channel transfers', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * For any session transferred between channels, the authentication status
     * must remain unchanged — the customer should not need to re-authenticate
     * after a channel transfer.
     */
    it('authentication status is unchanged after transfer', async () => {
      await fc.assert(
        fc.asyncProperty(sessionStateArb, channelArb, async (session, targetChannel) => {
          const service = createServiceWithSession(session);

          const transferred = await service.transferSession(
            session.sessionId,
            targetChannel
          );

          // Authentication status must be preserved
          expect(transferred.authenticationStatus).toBe(session.authenticationStatus);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('18.4: Transfer always produces a valid SessionState', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * The transfer operation always produces a valid SessionState object
     * (never null/undefined) with all required fields present and the
     * channel updated to the target channel.
     */
    it('transfer result is never null/undefined and has all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(sessionStateArb, channelArb, async (session, targetChannel) => {
          const service = createServiceWithSession(session);

          const transferred = await service.transferSession(
            session.sessionId,
            targetChannel
          );

          // Result must not be null or undefined
          expect(transferred).not.toBeNull();
          expect(transferred).not.toBeUndefined();

          // All required SessionState fields must be present
          expect(transferred.sessionId).toBeDefined();
          expect(transferred.sessionId).toBe(session.sessionId);
          expect(transferred.conversationHistory).toBeDefined();
          expect(Array.isArray(transferred.conversationHistory)).toBe(true);
          expect(transferred.detectedIntent).toBeDefined();
          expect(transferred.collectedFields).toBeDefined();
          expect(typeof transferred.collectedFields).toBe('object');
          expect(transferred.authenticationStatus).toBeDefined();
          expect(['AUTHENTICATED', 'UNAUTHENTICATED', 'EXPIRED']).toContain(
            transferred.authenticationStatus
          );
          expect(transferred.channel).toBe(targetChannel);
          expect(transferred.language).toBeDefined();
          expect(transferred.createdAt).toBeDefined();
          expect(transferred.lastActivityAt).toBeDefined();
          expect(transferred.customerContext).toBeDefined();
          expect(transferred.customerContext.customerId).toBeDefined();
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('18.5: Transfer is deterministic — same inputs produce identical state', () => {
    /**
     * **Validates: Requirements 7.2**
     *
     * Transferring the same session to the same target channel always produces
     * an identical SessionState. The operation is pure with respect to its inputs.
     */
    it('same session transferred to same channel produces identical results', async () => {
      await fc.assert(
        fc.asyncProperty(sessionStateArb, channelArb, async (session, targetChannel) => {
          const service = createServiceWithSession(session);

          const transferred1 = await service.transferSession(
            session.sessionId,
            targetChannel
          );
          const transferred2 = await service.transferSession(
            session.sessionId,
            targetChannel
          );

          // Both transfers must produce identical results
          expect(transferred1).toEqual(transferred2);
        }),
        { numRuns: 200 }
      );
    });
  });
});
