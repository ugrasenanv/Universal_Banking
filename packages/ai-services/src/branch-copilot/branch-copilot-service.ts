/**
 * Branch Copilot Service
 *
 * GenAI-powered internal assistant for branch operations staff.
 * Provides answers to questions about policies, circulars, and product
 * details using RAG with hybrid retrieval (BM25 + dense vector),
 * mandatory source citations, confidence-based refusal, and
 * incremental corpus updates within 1 hour.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import { randomUUID } from 'node:crypto';
import type {
  BranchCopilotConfig,
  BranchCopilotQuery,
  BranchCopilotResponse,
  BranchCopilotAnswer,
  BranchCopilotRefusal,
  BranchCorpusUpdateRequest,
  BranchCorpusUpdateResult,
  BranchCorpusCategory,
  SourceCitation,
  BranchAnswerGeneratorAdapter,
  BranchRetrievalAdapter,
  BranchCorpusUpdateAdapter,
  CorpusUpdateStatus,
} from './types.js';
import { DEFAULT_BRANCH_COPILOT_CONFIG } from './types.js';

/**
 * BranchCopilot is the main service class for branch operations staff.
 *
 * Key behaviours:
 * - Queries are answered with mandatory source citations (Req 12.1)
 * - Hybrid retrieval using BM25 + dense vector search (Req 12.2)
 * - Refuses to answer when retrieval confidence is below threshold (Req 12.3)
 * - Supports incremental corpus updates within 1 hour (Req 12.4)
 */
export class BranchCopilot {
  private readonly config: BranchCopilotConfig;
  private readonly retrieval: BranchRetrievalAdapter;
  private readonly answerGenerator: BranchAnswerGeneratorAdapter;
  private readonly corpusUpdater: BranchCorpusUpdateAdapter;

  constructor(
    retrieval: BranchRetrievalAdapter,
    answerGenerator: BranchAnswerGeneratorAdapter,
    corpusUpdater: BranchCorpusUpdateAdapter,
    config: Partial<BranchCopilotConfig> = {}
  ) {
    this.config = { ...DEFAULT_BRANCH_COPILOT_CONFIG, ...config };
    this.retrieval = retrieval;
    this.answerGenerator = answerGenerator;
    this.corpusUpdater = corpusUpdater;
  }

  /**
   * Query the Branch Copilot with a staff member's question.
   *
   * Performs hybrid retrieval, evaluates groundedness, and either
   * generates a cited answer or refuses with an escalation path.
   *
   * Requirements: 12.1, 12.2, 12.3
   */
  async query(request: BranchCopilotQuery): Promise<BranchCopilotResponse> {
    const startTime = performance.now();

    // Determine which corpus IDs to search
    const corpusIds = this.resolveCorpusIds(request.corpusCategories);

    // Determine query language (default to English)
    const queryLanguage = request.language ?? 'en';

    // Maximum citations to include
    const maxCitations = request.maxCitations ?? this.config.defaultMaxCitations;

    // Step 1: Perform hybrid retrieval (BM25 + dense vector)
    // Requirement 12.2: hybrid retrieval combining BM25 and dense vector search
    const retrievalResult = await this.retrieval.retrieve({
      query: request.question,
      queryLanguage,
      tenantId: request.tenantId,
      corpusIds,
      topK: maxCitations * 2, // Retrieve more for better groundedness
    });

    const latencyMs = Math.round(performance.now() - startTime);

    // Step 2: Check groundedness/confidence threshold
    // Requirement 12.3: refuse if confidence below threshold
    if (retrievalResult.groundednessScore < this.config.confidenceThreshold) {
      const refusal: BranchCopilotRefusal = {
        queryId: request.queryId,
        reason: `Unable to find sufficiently relevant source material for your query. ` +
          `Retrieval confidence (${(retrievalResult.groundednessScore * 100).toFixed(0)}%) ` +
          `is below the required threshold (${(this.config.confidenceThreshold * 100).toFixed(0)}%).`,
        confidenceScore: retrievalResult.groundednessScore,
        threshold: this.config.confidenceThreshold,
        escalationChannel: this.config.defaultEscalationChannel,
        latencyMs,
        refused: true,
      };
      return refusal;
    }

    // Step 3: Also refuse if no chunks were retrieved
    if (retrievalResult.chunks.length === 0) {
      const refusal: BranchCopilotRefusal = {
        queryId: request.queryId,
        reason: `No relevant source material found in the policy, circular, or product corpus for your query.`,
        confidenceScore: 0,
        threshold: this.config.confidenceThreshold,
        escalationChannel: this.config.defaultEscalationChannel,
        latencyMs,
        refused: true,
      };
      return refusal;
    }

    // Step 4: Build context with source citations for generation
    const contextChunks = retrievalResult.chunks
      .slice(0, maxCitations)
      .map((chunk) => ({
        content: chunk.content,
        source: {
          documentName: chunk.source.documentName,
          section: chunk.source.section,
          effectiveDate: chunk.source.publicationDate,
          relevanceScore: chunk.relevanceScore,
        },
      }));

    // Step 5: Generate answer grounded in retrieved context
    // Requirement 12.1: answer with mandatory source citations
    const generation = await this.answerGenerator.generateAnswer(
      request.question,
      contextChunks,
      queryLanguage
    );

    const totalLatencyMs = Math.round(performance.now() - startTime);

    // Step 6: Build citations from the retrieved sources
    const citations: SourceCitation[] = contextChunks.map((c) => c.source);

    const answer: BranchCopilotAnswer = {
      queryId: request.queryId,
      answer: generation.answer,
      citations,
      confidenceScore: retrievalResult.groundednessScore,
      latencyMs: totalLatencyMs,
      refused: false,
    };

    return answer;
  }

  /**
   * Perform an incremental corpus update.
   *
   * Processes document additions, updates, and removals without requiring
   * a full re-index of the existing corpus. Must complete within 1 hour.
   *
   * Requirement 12.4
   */
  async updateCorpus(request: BranchCorpusUpdateRequest): Promise<BranchCorpusUpdateResult> {
    const startTime = performance.now();
    const deadline = new Date(Date.now() + this.config.maxUpdateTimeMs);
    const updateId = randomUUID();

    let documentsProcessed = 0;
    let documentsRemoved = 0;
    let status: CorpusUpdateStatus = 'IN_PROGRESS';

    try {
      // Process removals first
      if (request.removals && request.removals.length > 0) {
        for (const documentId of request.removals) {
          // Check deadline
          if (Date.now() >= deadline.getTime()) {
            status = 'FAILED';
            break;
          }
          await this.corpusUpdater.removeDocument(documentId, request.tenantId);
          documentsRemoved++;
        }
      }

      // Process additions/updates
      if (status !== 'FAILED') {
        for (const doc of request.documents) {
          // Check deadline
          if (Date.now() >= deadline.getTime()) {
            status = 'FAILED';
            break;
          }

          const corpusId = this.config.corpusCategoryMapping[doc.category];
          await this.corpusUpdater.ingestDocument({
            documentId: doc.documentId,
            documentName: doc.documentName,
            content: doc.content,
            tenantId: request.tenantId,
            corpusId,
            language: doc.language,
            publicationDate: doc.effectiveDate,
          });
          documentsProcessed++;
        }
      }

      if (status !== 'FAILED') {
        status = 'COMPLETED';
      }
    } catch {
      status = 'FAILED';
    }

    const processingTimeMs = Math.round(performance.now() - startTime);

    return {
      updateId,
      status,
      documentsProcessed,
      documentsRemoved,
      processingTimeMs,
      deadline: deadline.toISOString(),
    };
  }

  /**
   * Get the current confidence threshold configuration.
   */
  get confidenceThreshold(): number {
    return this.config.confidenceThreshold;
  }

  /**
   * Get the configured escalation channel.
   */
  get escalationChannel(): string {
    return this.config.defaultEscalationChannel;
  }

  /**
   * Resolve corpus IDs from optional category filters.
   * If no categories specified, search all branch corpus categories.
   */
  private resolveCorpusIds(categories?: BranchCorpusCategory[]): string[] {
    if (categories && categories.length > 0) {
      return categories.map((cat) => this.config.corpusCategoryMapping[cat]);
    }
    // Default: search all branch corpuses
    return Object.values(this.config.corpusCategoryMapping);
  }
}
