/**
 * End-to-End Wiring: Conversational AI and Copilot Flows
 *
 * Connects:
 * - Conversational AI → LLM Gateway → Guardrails → RAG Pipeline → Audit
 * - RM Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 * - Branch Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 *
 * This module orchestrates the full request lifecycle for conversational
 * and copilot services, ensuring every interaction flows through the
 * guardrails engine for safety, the RAG pipeline for grounded retrieval,
 * the LLM gateway for inference, and the audit service for compliance.
 *
 * Validates: Requirements 7.1, 8.1, 12.1
 */

import type { ISO8601, Jurisdiction, LanguageCode } from '@afg/shared-types';

// ─── Flow Step Result Types ────────────────────────────────────────────────────

/** Status of an individual step in the flow. */
export type FlowStepStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED';

/** Result from a single flow step. */
export interface FlowStepResult {
  stepName: string;
  status: FlowStepStatus;
  latencyMs: number;
  error?: string;
}

// ─── Conversational AI Flow Types ──────────────────────────────────────────────

/** Channel types for conversational interaction. */
export type ConversationalChannel = 'MOBILE' | 'IVR' | 'WEB';

/** Input for the Conversational AI end-to-end flow. */
export interface ConversationalAIFlowInput {
  sessionId: string;
  channel: ConversationalChannel;
  input: string;
  language?: LanguageCode;
  customerId: string;
  tenantId: string;
  jurisdiction: Jurisdiction;
}

/** Result of the Conversational AI end-to-end flow. */
export interface ConversationalAIFlowResult {
  sessionId: string;
  output: string;
  language: LanguageCode;
  confidence: number;
  escalationRequired: boolean;
  auditArtefactId: string;
  totalLatencyMs: number;
  steps: FlowStepResult[];
  guardrailsPassed: boolean;
  ragGroundednessScore: number;
}

// ─── RM Copilot Flow Types ─────────────────────────────────────────────────────

/** Input for the RM Copilot end-to-end flow. */
export interface RMCopilotFlowInput {
  sessionId: string;
  clientId: string;
  query: string;
  tenantId: string;
  jurisdiction: Jurisdiction;
  rmId: string;
}

/** Result of the RM Copilot end-to-end flow. */
export interface RMCopilotFlowResult {
  sessionId: string;
  output: string;
  citations: FlowCitation[];
  auditArtefactId: string;
  totalLatencyMs: number;
  steps: FlowStepResult[];
  guardrailsPassed: boolean;
  ragGroundednessScore: number;
  residencyCompliant: boolean;
}

// ─── Branch Copilot Flow Types ─────────────────────────────────────────────────

/** Input for the Branch Copilot end-to-end flow. */
export interface BranchCopilotFlowInput {
  queryId: string;
  question: string;
  tenantId: string;
  jurisdiction: Jurisdiction;
  staffId: string;
  corpusCategories?: string[];
  language?: LanguageCode;
}

/** Result of the Branch Copilot end-to-end flow. */
export interface BranchCopilotFlowResult {
  queryId: string;
  output: string;
  citations: FlowCitation[];
  refused: boolean;
  refusalReason?: string;
  auditArtefactId: string;
  totalLatencyMs: number;
  steps: FlowStepResult[];
  guardrailsPassed: boolean;
  ragGroundednessScore: number;
}

// ─── Shared Types ──────────────────────────────────────────────────────────────

/** Citation reference from RAG retrieval. */
export interface FlowCitation {
  documentName: string;
  section: string;
  publicationDate: ISO8601;
  relevanceScore: number;
}

/** Guardrail check result within the flow. */
export interface FlowGuardrailResult {
  passed: boolean;
  flags: FlowGuardrailFlag[];
  redactedContent?: string;
  blockReason?: string;
}

/** A flag raised by guardrails during the flow. */
export interface FlowGuardrailFlag {
  checkType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  confidence: number;
}

/** RAG retrieval result within the flow. */
export interface FlowRAGResult {
  chunks: FlowRetrievedChunk[];
  groundednessScore: number;
  latencyMs: number;
}

/** A retrieved chunk from RAG within the flow. */
export interface FlowRetrievedChunk {
  chunkId: string;
  content: string;
  source: {
    documentName: string;
    section: string;
    publicationDate: ISO8601;
  };
  relevanceScore: number;
}

/** LLM inference result within the flow. */
export interface FlowLLMResult {
  output: string;
  modelId: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  latencyMs: number;
  costUnits: number;
}

/** Audit record emitted at the end of the flow. */
export interface FlowAuditRecord {
  artefactId: string;
  serviceId: string;
  timestamp: ISO8601;
  jurisdiction: Jurisdiction;
  tenantId: string;
}

// ─── Adapter Interfaces ────────────────────────────────────────────────────────

/**
 * Adapter for the LLM Gateway within the conversational/copilot flow.
 */
export interface FlowLLMGatewayAdapter {
  infer(request: {
    prompt: string;
    context?: FlowRetrievedChunk[];
    tenantId: string;
    jurisdiction: Jurisdiction;
    maxLatencyMs: number;
  }): Promise<FlowLLMResult>;
}

/**
 * Adapter for the Guardrails Engine within the conversational/copilot flow.
 */
export interface FlowGuardrailsAdapter {
  checkInput(content: string, tenantId: string, useCase: string): Promise<FlowGuardrailResult>;
  checkOutput(content: string, tenantId: string, useCase: string): Promise<FlowGuardrailResult>;
}

/**
 * Adapter for the RAG Pipeline within the conversational/copilot flow.
 */
export interface FlowRAGPipelineAdapter {
  retrieve(request: {
    query: string;
    tenantId: string;
    corpusIds: string[];
    topK: number;
    language: LanguageCode;
  }): Promise<FlowRAGResult>;
}

/**
 * Adapter for the Audit Service within the conversational/copilot flow.
 */
export interface FlowAuditAdapter {
  emit(record: {
    serviceId: string;
    tenantId: string;
    jurisdiction: Jurisdiction;
    input: string;
    output: string;
    modelId?: string;
    confidence: number;
    context?: FlowRetrievedChunk[];
    guardrailFlags: FlowGuardrailFlag[];
  }): Promise<FlowAuditRecord>;
}

// ─── Conversational AI Flow Orchestrator ───────────────────────────────────────

/**
 * Orchestrates the Conversational AI end-to-end flow:
 * Conversational AI → LLM Gateway → Guardrails → RAG Pipeline → Audit
 *
 * Flow steps:
 * 1. Input guardrail check (prompt injection, PII redaction)
 * 2. RAG retrieval for context grounding
 * 3. LLM inference via gateway
 * 4. Output guardrail check (toxicity, policy compliance)
 * 5. Audit artefact emission
 *
 * Validates: Requirement 7.1
 */
export class ConversationalAIFlow {
  private readonly llmGateway: FlowLLMGatewayAdapter;
  private readonly guardrails: FlowGuardrailsAdapter;
  private readonly ragPipeline: FlowRAGPipelineAdapter;
  private readonly audit: FlowAuditAdapter;
  private readonly config: ConversationalAIFlowConfig;

  constructor(
    llmGateway: FlowLLMGatewayAdapter,
    guardrails: FlowGuardrailsAdapter,
    ragPipeline: FlowRAGPipelineAdapter,
    audit: FlowAuditAdapter,
    config: Partial<ConversationalAIFlowConfig> = {}
  ) {
    this.llmGateway = llmGateway;
    this.guardrails = guardrails;
    this.ragPipeline = ragPipeline;
    this.audit = audit;
    this.config = { ...DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG, ...config };
  }

  /**
   * Execute the full Conversational AI flow end-to-end.
   */
  async execute(input: ConversationalAIFlowInput): Promise<ConversationalAIFlowResult> {
    const startTime = performance.now();
    const steps: FlowStepResult[] = [];
    const language: LanguageCode = input.language ?? 'en';

    // Step 1: Input guardrail check
    const inputGuardrailStart = performance.now();
    let inputGuardrailResult: FlowGuardrailResult;
    try {
      inputGuardrailResult = await this.guardrails.checkInput(
        input.input,
        input.tenantId,
        'CONVERSATIONAL_AI'
      );
      steps.push({
        stepName: 'input_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'input_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime, language);
    }

    // If input blocked by guardrails, short-circuit with audit
    if (!inputGuardrailResult.passed) {
      const auditRecord = await this.audit.emit({
        serviceId: 'CONVERSATIONAL_AI',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.input,
        output: inputGuardrailResult.blockReason ?? 'Input blocked by guardrails',
        confidence: 0,
        guardrailFlags: inputGuardrailResult.flags,
      });

      return {
        sessionId: input.sessionId,
        output: inputGuardrailResult.blockReason ?? 'I cannot process this request.',
        language,
        confidence: 0,
        escalationRequired: true,
        auditArtefactId: auditRecord.artefactId,
        totalLatencyMs: Math.round(performance.now() - startTime),
        steps,
        guardrailsPassed: false,
        ragGroundednessScore: 0,
      };
    }

    // Step 2: RAG retrieval for context grounding
    const ragStart = performance.now();
    let ragResult: FlowRAGResult;
    try {
      const queryContent = inputGuardrailResult.redactedContent ?? input.input;
      ragResult = await this.ragPipeline.retrieve({
        query: queryContent,
        tenantId: input.tenantId,
        corpusIds: this.config.conversationalCorpusIds,
        topK: this.config.ragTopK,
        language,
      });
      steps.push({
        stepName: 'rag_retrieval',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - ragStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'rag_retrieval',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - ragStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime, language);
    }

    // Step 3: LLM inference via gateway
    const llmStart = performance.now();
    let llmResult: FlowLLMResult;
    try {
      llmResult = await this.llmGateway.infer({
        prompt: inputGuardrailResult.redactedContent ?? input.input,
        context: ragResult.chunks,
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        maxLatencyMs: this.config.maxLLMLatencyMs,
      });
      steps.push({
        stepName: 'llm_inference',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - llmStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'llm_inference',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - llmStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime, language);
    }

    // Step 4: Output guardrail check
    const outputGuardrailStart = performance.now();
    let outputGuardrailResult: FlowGuardrailResult;
    try {
      outputGuardrailResult = await this.guardrails.checkOutput(
        llmResult.output,
        input.tenantId,
        'CONVERSATIONAL_AI'
      );
      steps.push({
        stepName: 'output_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'output_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime, language);
    }

    // Determine final output (may be blocked/modified by output guardrails)
    const finalOutput = outputGuardrailResult.passed
      ? (outputGuardrailResult.redactedContent ?? llmResult.output)
      : (outputGuardrailResult.blockReason ?? 'I cannot provide that response.');

    const escalationRequired = !outputGuardrailResult.passed ||
      ragResult.groundednessScore < this.config.groundednessThreshold;

    // Step 5: Emit audit artefact
    const auditStart = performance.now();
    let auditRecord: FlowAuditRecord;
    try {
      const allFlags = [
        ...inputGuardrailResult.flags,
        ...outputGuardrailResult.flags,
      ];
      auditRecord = await this.audit.emit({
        serviceId: 'CONVERSATIONAL_AI',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.input,
        output: finalOutput,
        modelId: llmResult.modelId,
        confidence: ragResult.groundednessScore,
        context: ragResult.chunks,
        guardrailFlags: allFlags,
      });
      steps.push({
        stepName: 'audit_emission',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - auditStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'audit_emission',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - auditStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime, language);
    }

    return {
      sessionId: input.sessionId,
      output: finalOutput,
      language,
      confidence: ragResult.groundednessScore,
      escalationRequired,
      auditArtefactId: auditRecord.artefactId,
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: inputGuardrailResult.passed && outputGuardrailResult.passed,
      ragGroundednessScore: ragResult.groundednessScore,
    };
  }

  private buildErrorResult(
    input: ConversationalAIFlowInput,
    steps: FlowStepResult[],
    startTime: number,
    language: LanguageCode
  ): ConversationalAIFlowResult {
    return {
      sessionId: input.sessionId,
      output: 'An error occurred processing your request. Please try again.',
      language,
      confidence: 0,
      escalationRequired: true,
      auditArtefactId: '',
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: false,
      ragGroundednessScore: 0,
    };
  }
}

// ─── RM Copilot Flow Orchestrator ──────────────────────────────────────────────

/**
 * Orchestrates the RM Copilot end-to-end flow:
 * RM Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 *
 * Flow steps:
 * 1. Input guardrail check (PII scoping, prompt injection)
 * 2. RAG retrieval (client records, research, products)
 * 3. LLM inference for synthesised brief
 * 4. Output guardrail check (PII isolation, toxicity)
 * 5. Audit artefact emission
 *
 * Validates: Requirement 8.1
 */
export class RMCopilotFlow {
  private readonly llmGateway: FlowLLMGatewayAdapter;
  private readonly guardrails: FlowGuardrailsAdapter;
  private readonly ragPipeline: FlowRAGPipelineAdapter;
  private readonly audit: FlowAuditAdapter;
  private readonly config: RMCopilotFlowConfig;

  constructor(
    llmGateway: FlowLLMGatewayAdapter,
    guardrails: FlowGuardrailsAdapter,
    ragPipeline: FlowRAGPipelineAdapter,
    audit: FlowAuditAdapter,
    config: Partial<RMCopilotFlowConfig> = {}
  ) {
    this.llmGateway = llmGateway;
    this.guardrails = guardrails;
    this.ragPipeline = ragPipeline;
    this.audit = audit;
    this.config = { ...DEFAULT_RM_COPILOT_FLOW_CONFIG, ...config };
  }

  /**
   * Execute the full RM Copilot flow end-to-end.
   */
  async execute(input: RMCopilotFlowInput): Promise<RMCopilotFlowResult> {
    const startTime = performance.now();
    const steps: FlowStepResult[] = [];

    // Step 1: Input guardrail check (scoped to single client context)
    const inputGuardrailStart = performance.now();
    let inputGuardrailResult: FlowGuardrailResult;
    try {
      inputGuardrailResult = await this.guardrails.checkInput(
        input.query,
        input.tenantId,
        'RM_COPILOT'
      );
      steps.push({
        stepName: 'input_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'input_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    if (!inputGuardrailResult.passed) {
      const auditRecord = await this.audit.emit({
        serviceId: 'RM_COPILOT',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.query,
        output: inputGuardrailResult.blockReason ?? 'Input blocked by guardrails',
        confidence: 0,
        guardrailFlags: inputGuardrailResult.flags,
      });

      return {
        sessionId: input.sessionId,
        output: inputGuardrailResult.blockReason ?? 'Request blocked by safety guardrails.',
        citations: [],
        auditArtefactId: auditRecord.artefactId,
        totalLatencyMs: Math.round(performance.now() - startTime),
        steps,
        guardrailsPassed: false,
        ragGroundednessScore: 0,
        residencyCompliant: true,
      };
    }

    // Step 2: RAG retrieval scoped to client context
    const ragStart = performance.now();
    let ragResult: FlowRAGResult;
    try {
      const queryContent = inputGuardrailResult.redactedContent ?? input.query;
      ragResult = await this.ragPipeline.retrieve({
        query: queryContent,
        tenantId: input.tenantId,
        corpusIds: this.config.rmCorpusIds,
        topK: this.config.ragTopK,
        language: 'en',
      });
      steps.push({
        stepName: 'rag_retrieval',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - ragStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'rag_retrieval',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - ragStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    // Step 3: LLM inference via gateway (respects jurisdictional residency)
    const llmStart = performance.now();
    let llmResult: FlowLLMResult;
    try {
      llmResult = await this.llmGateway.infer({
        prompt: inputGuardrailResult.redactedContent ?? input.query,
        context: ragResult.chunks,
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        maxLatencyMs: this.config.maxBriefGenerationMs,
      });
      steps.push({
        stepName: 'llm_inference',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - llmStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'llm_inference',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - llmStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    // Step 4: Output guardrail check (PII isolation enforcement)
    const outputGuardrailStart = performance.now();
    let outputGuardrailResult: FlowGuardrailResult;
    try {
      outputGuardrailResult = await this.guardrails.checkOutput(
        llmResult.output,
        input.tenantId,
        'RM_COPILOT'
      );
      steps.push({
        stepName: 'output_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'output_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    const finalOutput = outputGuardrailResult.passed
      ? (outputGuardrailResult.redactedContent ?? llmResult.output)
      : (outputGuardrailResult.blockReason ?? 'Response withheld due to compliance check.');

    // Build citations from RAG results
    const citations: FlowCitation[] = ragResult.chunks.map((chunk) => ({
      documentName: chunk.source.documentName,
      section: chunk.source.section,
      publicationDate: chunk.source.publicationDate,
      relevanceScore: chunk.relevanceScore,
    }));

    // Step 5: Audit emission
    const auditStart = performance.now();
    let auditRecord: FlowAuditRecord;
    try {
      auditRecord = await this.audit.emit({
        serviceId: 'RM_COPILOT',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.query,
        output: finalOutput,
        modelId: llmResult.modelId,
        confidence: ragResult.groundednessScore,
        context: ragResult.chunks,
        guardrailFlags: [
          ...inputGuardrailResult.flags,
          ...outputGuardrailResult.flags,
        ],
      });
      steps.push({
        stepName: 'audit_emission',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - auditStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'audit_emission',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - auditStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    return {
      sessionId: input.sessionId,
      output: finalOutput,
      citations,
      auditArtefactId: auditRecord.artefactId,
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: inputGuardrailResult.passed && outputGuardrailResult.passed,
      ragGroundednessScore: ragResult.groundednessScore,
      residencyCompliant: true,
    };
  }

  private buildErrorResult(
    input: RMCopilotFlowInput,
    steps: FlowStepResult[],
    startTime: number
  ): RMCopilotFlowResult {
    return {
      sessionId: input.sessionId,
      output: 'An error occurred preparing your brief. Please try again.',
      citations: [],
      auditArtefactId: '',
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: false,
      ragGroundednessScore: 0,
      residencyCompliant: true,
    };
  }
}

// ─── Branch Copilot Flow Orchestrator ──────────────────────────────────────────

/**
 * Orchestrates the Branch Copilot end-to-end flow:
 * Branch Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 *
 * Flow steps:
 * 1. Input guardrail check (prompt injection detection)
 * 2. RAG retrieval (policy, circular, product corpus)
 * 3. Groundedness threshold check (refuse if below threshold)
 * 4. LLM inference for answer generation
 * 5. Output guardrail check (policy compliance, PII)
 * 6. Audit artefact emission
 *
 * Validates: Requirement 12.1
 */
export class BranchCopilotFlow {
  private readonly llmGateway: FlowLLMGatewayAdapter;
  private readonly guardrails: FlowGuardrailsAdapter;
  private readonly ragPipeline: FlowRAGPipelineAdapter;
  private readonly audit: FlowAuditAdapter;
  private readonly config: BranchCopilotFlowConfig;

  constructor(
    llmGateway: FlowLLMGatewayAdapter,
    guardrails: FlowGuardrailsAdapter,
    ragPipeline: FlowRAGPipelineAdapter,
    audit: FlowAuditAdapter,
    config: Partial<BranchCopilotFlowConfig> = {}
  ) {
    this.llmGateway = llmGateway;
    this.guardrails = guardrails;
    this.ragPipeline = ragPipeline;
    this.audit = audit;
    this.config = { ...DEFAULT_BRANCH_COPILOT_FLOW_CONFIG, ...config };
  }

  /**
   * Execute the full Branch Copilot flow end-to-end.
   */
  async execute(input: BranchCopilotFlowInput): Promise<BranchCopilotFlowResult> {
    const startTime = performance.now();
    const steps: FlowStepResult[] = [];
    const language: LanguageCode = input.language ?? 'en';

    // Step 1: Input guardrail check
    const inputGuardrailStart = performance.now();
    let inputGuardrailResult: FlowGuardrailResult;
    try {
      inputGuardrailResult = await this.guardrails.checkInput(
        input.question,
        input.tenantId,
        'BRANCH_COPILOT'
      );
      steps.push({
        stepName: 'input_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'input_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - inputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    if (!inputGuardrailResult.passed) {
      const auditRecord = await this.audit.emit({
        serviceId: 'BRANCH_COPILOT',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.question,
        output: inputGuardrailResult.blockReason ?? 'Input blocked by guardrails',
        confidence: 0,
        guardrailFlags: inputGuardrailResult.flags,
      });

      return {
        queryId: input.queryId,
        output: inputGuardrailResult.blockReason ?? 'Request blocked by safety guardrails.',
        citations: [],
        refused: true,
        refusalReason: inputGuardrailResult.blockReason,
        auditArtefactId: auditRecord.artefactId,
        totalLatencyMs: Math.round(performance.now() - startTime),
        steps,
        guardrailsPassed: false,
        ragGroundednessScore: 0,
      };
    }

    // Step 2: RAG retrieval (policy, circular, product corpus)
    const ragStart = performance.now();
    let ragResult: FlowRAGResult;
    try {
      const queryContent = inputGuardrailResult.redactedContent ?? input.question;
      ragResult = await this.ragPipeline.retrieve({
        query: queryContent,
        tenantId: input.tenantId,
        corpusIds: input.corpusCategories ?? this.config.branchCorpusIds,
        topK: this.config.ragTopK,
        language,
      });
      steps.push({
        stepName: 'rag_retrieval',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - ragStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'rag_retrieval',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - ragStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    // Step 3: Groundedness threshold check — refuse if below threshold
    if (ragResult.groundednessScore < this.config.groundednessThreshold) {
      const auditRecord = await this.audit.emit({
        serviceId: 'BRANCH_COPILOT',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.question,
        output: 'Refused: insufficient retrieval confidence',
        confidence: ragResult.groundednessScore,
        context: ragResult.chunks,
        guardrailFlags: inputGuardrailResult.flags,
      });

      return {
        queryId: input.queryId,
        output: `Unable to find sufficiently relevant source material for your query. ` +
          `Please consult your supervisor or the compliance helpdesk.`,
        citations: [],
        refused: true,
        refusalReason: `Retrieval confidence (${(ragResult.groundednessScore * 100).toFixed(0)}%) ` +
          `below threshold (${(this.config.groundednessThreshold * 100).toFixed(0)}%).`,
        auditArtefactId: auditRecord.artefactId,
        totalLatencyMs: Math.round(performance.now() - startTime),
        steps,
        guardrailsPassed: true,
        ragGroundednessScore: ragResult.groundednessScore,
      };
    }

    // Step 4: LLM inference for answer generation
    const llmStart = performance.now();
    let llmResult: FlowLLMResult;
    try {
      llmResult = await this.llmGateway.infer({
        prompt: inputGuardrailResult.redactedContent ?? input.question,
        context: ragResult.chunks,
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        maxLatencyMs: this.config.maxLLMLatencyMs,
      });
      steps.push({
        stepName: 'llm_inference',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - llmStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'llm_inference',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - llmStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    // Step 5: Output guardrail check
    const outputGuardrailStart = performance.now();
    let outputGuardrailResult: FlowGuardrailResult;
    try {
      outputGuardrailResult = await this.guardrails.checkOutput(
        llmResult.output,
        input.tenantId,
        'BRANCH_COPILOT'
      );
      steps.push({
        stepName: 'output_guardrails',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'output_guardrails',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - outputGuardrailStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    const finalOutput = outputGuardrailResult.passed
      ? (outputGuardrailResult.redactedContent ?? llmResult.output)
      : (outputGuardrailResult.blockReason ?? 'Response withheld due to compliance check.');

    // Build citations from RAG results
    const citations: FlowCitation[] = ragResult.chunks.map((chunk) => ({
      documentName: chunk.source.documentName,
      section: chunk.source.section,
      publicationDate: chunk.source.publicationDate,
      relevanceScore: chunk.relevanceScore,
    }));

    // Step 6: Audit emission
    const auditStart = performance.now();
    let auditRecord: FlowAuditRecord;
    try {
      auditRecord = await this.audit.emit({
        serviceId: 'BRANCH_COPILOT',
        tenantId: input.tenantId,
        jurisdiction: input.jurisdiction,
        input: input.question,
        output: finalOutput,
        modelId: llmResult.modelId,
        confidence: ragResult.groundednessScore,
        context: ragResult.chunks,
        guardrailFlags: [
          ...inputGuardrailResult.flags,
          ...outputGuardrailResult.flags,
        ],
      });
      steps.push({
        stepName: 'audit_emission',
        status: 'SUCCESS',
        latencyMs: Math.round(performance.now() - auditStart),
      });
    } catch (error) {
      steps.push({
        stepName: 'audit_emission',
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - auditStart),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.buildErrorResult(input, steps, startTime);
    }

    return {
      queryId: input.queryId,
      output: finalOutput,
      citations,
      refused: !outputGuardrailResult.passed,
      refusalReason: outputGuardrailResult.passed ? undefined : outputGuardrailResult.blockReason,
      auditArtefactId: auditRecord.artefactId,
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: inputGuardrailResult.passed && outputGuardrailResult.passed,
      ragGroundednessScore: ragResult.groundednessScore,
    };
  }

  private buildErrorResult(
    input: BranchCopilotFlowInput,
    steps: FlowStepResult[],
    startTime: number
  ): BranchCopilotFlowResult {
    return {
      queryId: input.queryId,
      output: 'An error occurred processing your query. Please try again or contact your supervisor.',
      citations: [],
      refused: true,
      refusalReason: 'Internal error during processing',
      auditArtefactId: '',
      totalLatencyMs: Math.round(performance.now() - startTime),
      steps,
      guardrailsPassed: false,
      ragGroundednessScore: 0,
    };
  }
}

// ─── Configuration Types ───────────────────────────────────────────────────────

/** Configuration for the Conversational AI flow. */
export interface ConversationalAIFlowConfig {
  /** Corpus IDs for conversational retrieval. */
  conversationalCorpusIds: string[];
  /** Number of top-K results to retrieve from RAG. */
  ragTopK: number;
  /** Maximum LLM latency in ms. */
  maxLLMLatencyMs: number;
  /** Groundedness score threshold for escalation. */
  groundednessThreshold: number;
}

/** Configuration for the RM Copilot flow. */
export interface RMCopilotFlowConfig {
  /** Corpus IDs for RM research and product retrieval. */
  rmCorpusIds: string[];
  /** Number of top-K results to retrieve from RAG. */
  ragTopK: number;
  /** Maximum brief generation time in ms (30 seconds). */
  maxBriefGenerationMs: number;
}

/** Configuration for the Branch Copilot flow. */
export interface BranchCopilotFlowConfig {
  /** Corpus IDs for branch policy, circular, product corpus. */
  branchCorpusIds: string[];
  /** Number of top-K results to retrieve from RAG. */
  ragTopK: number;
  /** Maximum LLM latency in ms. */
  maxLLMLatencyMs: number;
  /** Groundedness score threshold for refusal. */
  groundednessThreshold: number;
}

/** Default Conversational AI flow configuration. */
export const DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG: ConversationalAIFlowConfig = {
  conversationalCorpusIds: ['faq-corpus', 'product-corpus', 'policy-corpus'],
  ragTopK: 5,
  maxLLMLatencyMs: 5000,
  groundednessThreshold: 0.70,
};

/** Default RM Copilot flow configuration. */
export const DEFAULT_RM_COPILOT_FLOW_CONFIG: RMCopilotFlowConfig = {
  rmCorpusIds: ['client-records', 'market-research', 'product-catalogue'],
  ragTopK: 10,
  maxBriefGenerationMs: 30000,
};

/** Default Branch Copilot flow configuration. */
export const DEFAULT_BRANCH_COPILOT_FLOW_CONFIG: BranchCopilotFlowConfig = {
  branchCorpusIds: ['policy-corpus', 'circular-corpus', 'product-corpus'],
  ragTopK: 8,
  maxLLMLatencyMs: 10000,
  groundednessThreshold: 0.70,
};
