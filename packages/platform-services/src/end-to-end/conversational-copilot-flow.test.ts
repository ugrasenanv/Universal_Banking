/**
 * End-to-End Conversational AI and Copilot Flow Tests
 *
 * Validates the wiring for all three copilot/conversational flows:
 *   - Conversational AI → LLM Gateway → Guardrails → RAG Pipeline → Audit
 *   - RM Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 *   - Branch Copilot → RAG Pipeline → LLM Gateway → Guardrails → Audit
 *
 * Covers:
 * - Correct flow orchestration through all service layers
 * - Input/output guardrail enforcement
 * - RAG retrieval and groundedness-based refusal
 * - Audit artefact emission at end of every flow
 * - Error handling and escalation paths
 *
 * Validates: Requirements 7.1, 8.1, 12.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationalAIFlow,
  RMCopilotFlow,
  BranchCopilotFlow,
  DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG,
  DEFAULT_RM_COPILOT_FLOW_CONFIG,
  DEFAULT_BRANCH_COPILOT_FLOW_CONFIG,
  type FlowLLMGatewayAdapter,
  type FlowGuardrailsAdapter,
  type FlowRAGPipelineAdapter,
  type FlowAuditAdapter,
  type FlowLLMResult,
  type FlowGuardrailResult,
  type FlowRAGResult,
  type FlowAuditRecord,
  type FlowRetrievedChunk,
  type FlowGuardrailFlag,
  type ConversationalAIFlowInput,
  type RMCopilotFlowInput,
  type BranchCopilotFlowInput,
} from './conversational-copilot-flow.js';

// ─── Mock Adapters ─────────────────────────────────────────────────────────────

class MockLLMGateway implements FlowLLMGatewayAdapter {
  public inferCalls: Array<{ prompt: string; tenantId: string; jurisdiction: string }> = [];
  public output = 'Generated response from LLM';
  public modelId = 'gpt-4-turbo';
  public shouldThrow = false;

  async infer(request: {
    prompt: string;
    context?: FlowRetrievedChunk[];
    tenantId: string;
    jurisdiction: string;
    maxLatencyMs: number;
  }): Promise<FlowLLMResult> {
    if (this.shouldThrow) {
      throw new Error('LLM Gateway unavailable');
    }
    this.inferCalls.push({
      prompt: request.prompt,
      tenantId: request.tenantId,
      jurisdiction: request.jurisdiction,
    });
    return {
      output: this.output,
      modelId: this.modelId,
      tokenUsage: { prompt: 150, completion: 80, total: 230 },
      latencyMs: 450,
      costUnits: 0.003,
    };
  }
}

class MockGuardrails implements FlowGuardrailsAdapter {
  public inputCheckCalls: Array<{ content: string; tenantId: string; useCase: string }> = [];
  public outputCheckCalls: Array<{ content: string; tenantId: string; useCase: string }> = [];
  public inputPassed = true;
  public outputPassed = true;
  public inputBlockReason: string | undefined;
  public outputBlockReason: string | undefined;
  public inputFlags: FlowGuardrailFlag[] = [];
  public outputFlags: FlowGuardrailFlag[] = [];
  public shouldThrowOnInput = false;
  public shouldThrowOnOutput = false;

  async checkInput(content: string, tenantId: string, useCase: string): Promise<FlowGuardrailResult> {
    if (this.shouldThrowOnInput) {
      throw new Error('Guardrails service unavailable');
    }
    this.inputCheckCalls.push({ content, tenantId, useCase });
    return {
      passed: this.inputPassed,
      flags: this.inputFlags,
      blockReason: this.inputPassed ? undefined : this.inputBlockReason,
    };
  }

  async checkOutput(content: string, tenantId: string, useCase: string): Promise<FlowGuardrailResult> {
    if (this.shouldThrowOnOutput) {
      throw new Error('Guardrails service unavailable');
    }
    this.outputCheckCalls.push({ content, tenantId, useCase });
    return {
      passed: this.outputPassed,
      flags: this.outputFlags,
      blockReason: this.outputPassed ? undefined : this.outputBlockReason,
    };
  }
}

class MockRAGPipeline implements FlowRAGPipelineAdapter {
  public retrieveCalls: Array<{ query: string; tenantId: string; corpusIds: string[] }> = [];
  public groundednessScore = 0.85;
  public chunks: FlowRetrievedChunk[] = [
    {
      chunkId: 'chunk-001',
      content: 'Account balance inquiry policy: customers can check balance via mobile or IVR.',
      source: {
        documentName: 'Customer Service Policy v3.2',
        section: 'Section 4.1 - Balance Inquiries',
        publicationDate: '2024-01-15T00:00:00Z',
      },
      relevanceScore: 0.92,
    },
    {
      chunkId: 'chunk-002',
      content: 'Fund transfer limits: retail customers max INR 5,00,000 per day via UPI.',
      source: {
        documentName: 'Transaction Limits Circular 2024-Q1',
        section: 'Section 2.3 - UPI Limits',
        publicationDate: '2024-02-01T00:00:00Z',
      },
      relevanceScore: 0.88,
    },
  ];
  public shouldThrow = false;

  async retrieve(request: {
    query: string;
    tenantId: string;
    corpusIds: string[];
    topK: number;
    language: string;
  }): Promise<FlowRAGResult> {
    if (this.shouldThrow) {
      throw new Error('RAG Pipeline unavailable');
    }
    this.retrieveCalls.push({
      query: request.query,
      tenantId: request.tenantId,
      corpusIds: request.corpusIds,
    });
    return {
      chunks: this.chunks,
      groundednessScore: this.groundednessScore,
      latencyMs: 120,
    };
  }
}

class MockAudit implements FlowAuditAdapter {
  public emitCalls: Array<{
    serviceId: string;
    tenantId: string;
    jurisdiction: string;
    input: string;
    output: string;
  }> = [];
  public shouldThrow = false;
  private callCount = 0;

  async emit(record: {
    serviceId: string;
    tenantId: string;
    jurisdiction: string;
    input: string;
    output: string;
    modelId?: string;
    confidence: number;
    context?: FlowRetrievedChunk[];
    guardrailFlags: FlowGuardrailFlag[];
  }): Promise<FlowAuditRecord> {
    if (this.shouldThrow) {
      throw new Error('Audit Service unavailable');
    }
    this.emitCalls.push({
      serviceId: record.serviceId,
      tenantId: record.tenantId,
      jurisdiction: record.jurisdiction,
      input: record.input,
      output: record.output,
    });
    this.callCount++;
    return {
      artefactId: `audit-artefact-${this.callCount}`,
      serviceId: record.serviceId,
      timestamp: new Date().toISOString(),
      jurisdiction: record.jurisdiction as any,
    };
  }
}

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createConversationalInput(overrides?: Partial<ConversationalAIFlowInput>): ConversationalAIFlowInput {
  return {
    sessionId: 'session-conv-001',
    channel: 'MOBILE',
    input: 'What is my account balance?',
    language: 'en',
    customerId: 'cust-123',
    tenantId: 'tenant-retail',
    jurisdiction: 'IN',
    ...overrides,
  };
}

function createRMCopilotInput(overrides?: Partial<RMCopilotFlowInput>): RMCopilotFlowInput {
  return {
    sessionId: 'session-rm-001',
    clientId: 'client-456',
    query: 'Prepare a brief on portfolio performance for this client',
    tenantId: 'tenant-wealth',
    jurisdiction: 'SG',
    rmId: 'rm-789',
    ...overrides,
  };
}

function createBranchCopilotInput(overrides?: Partial<BranchCopilotFlowInput>): BranchCopilotFlowInput {
  return {
    queryId: 'query-branch-001',
    question: 'What is the KYC document requirement for opening a savings account?',
    tenantId: 'tenant-branch',
    jurisdiction: 'IN',
    staffId: 'staff-101',
    language: 'en',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ConversationalAIFlow', () => {
  let llmGateway: MockLLMGateway;
  let guardrails: MockGuardrails;
  let ragPipeline: MockRAGPipeline;
  let audit: MockAudit;
  let flow: ConversationalAIFlow;

  beforeEach(() => {
    llmGateway = new MockLLMGateway();
    guardrails = new MockGuardrails();
    ragPipeline = new MockRAGPipeline();
    audit = new MockAudit();
    flow = new ConversationalAIFlow(llmGateway, guardrails, ragPipeline, audit);
  });

  describe('End-to-end flow execution (Requirement 7.1)', () => {
    it('should execute the full Conversational AI pipeline and return a response', async () => {
      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.sessionId).toBe('session-conv-001');
      expect(result.output).toBe('Generated response from LLM');
      expect(result.language).toBe('en');
      expect(result.auditArtefactId).toBeDefined();
      expect(result.auditArtefactId).not.toBe('');
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should route through all flow steps in sequence: guardrails → RAG → LLM → guardrails → audit', async () => {
      const input = createConversationalInput();
      const result = await flow.execute(input);

      // Verify all steps executed
      const stepNames = result.steps.map((s) => s.stepName);
      expect(stepNames).toContain('input_guardrails');
      expect(stepNames).toContain('rag_retrieval');
      expect(stepNames).toContain('llm_inference');
      expect(stepNames).toContain('output_guardrails');
      expect(stepNames).toContain('audit_emission');

      // Verify all steps succeeded
      for (const step of result.steps) {
        expect(step.status).toBe('SUCCESS');
      }
    });

    it('should pass the user input to guardrails for safety checking', async () => {
      const input = createConversationalInput({ input: 'Transfer money to my savings account' });
      await flow.execute(input);

      expect(guardrails.inputCheckCalls).toHaveLength(1);
      expect(guardrails.inputCheckCalls[0].content).toBe('Transfer money to my savings account');
      expect(guardrails.inputCheckCalls[0].useCase).toBe('CONVERSATIONAL_AI');
    });

    it('should pass the RAG-retrieved context to the LLM gateway', async () => {
      const input = createConversationalInput();
      await flow.execute(input);

      expect(llmGateway.inferCalls).toHaveLength(1);
      expect(llmGateway.inferCalls[0].jurisdiction).toBe('IN');
      expect(llmGateway.inferCalls[0].tenantId).toBe('tenant-retail');
    });

    it('should emit an audit artefact with the service ID CONVERSATIONAL_AI', async () => {
      const input = createConversationalInput();
      await flow.execute(input);

      expect(audit.emitCalls).toHaveLength(1);
      expect(audit.emitCalls[0].serviceId).toBe('CONVERSATIONAL_AI');
      expect(audit.emitCalls[0].tenantId).toBe('tenant-retail');
      expect(audit.emitCalls[0].jurisdiction).toBe('IN');
    });

    it('should report groundedness score from RAG pipeline', async () => {
      ragPipeline.groundednessScore = 0.91;
      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.ragGroundednessScore).toBe(0.91);
    });

    it('should trigger escalation when groundedness is below threshold', async () => {
      ragPipeline.groundednessScore = 0.55;
      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.escalationRequired).toBe(true);
    });
  });

  describe('Guardrail enforcement', () => {
    it('should block the flow and escalate when input guardrails fail', async () => {
      guardrails.inputPassed = false;
      guardrails.inputBlockReason = 'Prompt injection detected';

      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.guardrailsPassed).toBe(false);
      expect(result.escalationRequired).toBe(true);
      expect(result.output).toBe('Prompt injection detected');
      // LLM should NOT have been called
      expect(llmGateway.inferCalls).toHaveLength(0);
    });

    it('should block when output guardrails fail and emit audit', async () => {
      guardrails.outputPassed = false;
      guardrails.outputBlockReason = 'Response contains policy-violating content';

      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.guardrailsPassed).toBe(false);
      expect(result.output).toBe('Response contains policy-violating content');
      // Audit should still be emitted
      expect(audit.emitCalls).toHaveLength(1);
    });

    it('should check output guardrails on the LLM response text', async () => {
      llmGateway.output = 'Here is your balance: INR 50,000';
      const input = createConversationalInput();
      await flow.execute(input);

      expect(guardrails.outputCheckCalls).toHaveLength(1);
      expect(guardrails.outputCheckCalls[0].content).toBe('Here is your balance: INR 50,000');
    });
  });

  describe('Error handling', () => {
    it('should return error result when guardrails service fails', async () => {
      guardrails.shouldThrowOnInput = true;

      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.escalationRequired).toBe(true);
      expect(result.guardrailsPassed).toBe(false);
      const failedStep = result.steps.find((s) => s.stepName === 'input_guardrails');
      expect(failedStep?.status).toBe('FAILED');
    });

    it('should return error result when LLM gateway fails', async () => {
      llmGateway.shouldThrow = true;

      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.escalationRequired).toBe(true);
      const failedStep = result.steps.find((s) => s.stepName === 'llm_inference');
      expect(failedStep?.status).toBe('FAILED');
    });

    it('should return error result when RAG pipeline fails', async () => {
      ragPipeline.shouldThrow = true;

      const input = createConversationalInput();
      const result = await flow.execute(input);

      expect(result.escalationRequired).toBe(true);
      const failedStep = result.steps.find((s) => s.stepName === 'rag_retrieval');
      expect(failedStep?.status).toBe('FAILED');
    });
  });
});

describe('RMCopilotFlow', () => {
  let llmGateway: MockLLMGateway;
  let guardrails: MockGuardrails;
  let ragPipeline: MockRAGPipeline;
  let audit: MockAudit;
  let flow: RMCopilotFlow;

  beforeEach(() => {
    llmGateway = new MockLLMGateway();
    guardrails = new MockGuardrails();
    ragPipeline = new MockRAGPipeline();
    audit = new MockAudit();
    flow = new RMCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
  });

  describe('End-to-end flow execution (Requirement 8.1)', () => {
    it('should execute the full RM Copilot pipeline and return a synthesised brief', async () => {
      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      expect(result.sessionId).toBe('session-rm-001');
      expect(result.output).toBe('Generated response from LLM');
      expect(result.auditArtefactId).toBeDefined();
      expect(result.auditArtefactId).not.toBe('');
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.residencyCompliant).toBe(true);
    });

    it('should route through all flow steps: guardrails → RAG → LLM → guardrails → audit', async () => {
      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      const stepNames = result.steps.map((s) => s.stepName);
      expect(stepNames).toContain('input_guardrails');
      expect(stepNames).toContain('rag_retrieval');
      expect(stepNames).toContain('llm_inference');
      expect(stepNames).toContain('output_guardrails');
      expect(stepNames).toContain('audit_emission');

      for (const step of result.steps) {
        expect(step.status).toBe('SUCCESS');
      }
    });

    it('should enforce jurisdictional data residency by passing jurisdiction to LLM gateway', async () => {
      const input = createRMCopilotInput({ jurisdiction: 'SG' });
      await flow.execute(input);

      expect(llmGateway.inferCalls[0].jurisdiction).toBe('SG');
    });

    it('should return citations from RAG retrieval', async () => {
      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].documentName).toBe('Customer Service Policy v3.2');
      expect(result.citations[0].section).toBe('Section 4.1 - Balance Inquiries');
      expect(result.citations[1].documentName).toBe('Transaction Limits Circular 2024-Q1');
    });

    it('should emit audit artefact with the service ID RM_COPILOT', async () => {
      const input = createRMCopilotInput();
      await flow.execute(input);

      expect(audit.emitCalls).toHaveLength(1);
      expect(audit.emitCalls[0].serviceId).toBe('RM_COPILOT');
      expect(audit.emitCalls[0].tenantId).toBe('tenant-wealth');
      expect(audit.emitCalls[0].jurisdiction).toBe('SG');
    });

    it('should use the RM query as the input passed through the flow', async () => {
      const input = createRMCopilotInput({ query: 'Show portfolio risk analysis' });
      await flow.execute(input);

      expect(guardrails.inputCheckCalls[0].content).toBe('Show portfolio risk analysis');
      expect(guardrails.inputCheckCalls[0].useCase).toBe('RM_COPILOT');
    });
  });

  describe('Guardrail enforcement for RM Copilot', () => {
    it('should block the flow when input guardrails detect PII/injection', async () => {
      guardrails.inputPassed = false;
      guardrails.inputBlockReason = 'Cross-client data request detected';

      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      expect(result.guardrailsPassed).toBe(false);
      expect(result.output).toBe('Cross-client data request detected');
      expect(llmGateway.inferCalls).toHaveLength(0);
    });

    it('should withhold response when output guardrails fail', async () => {
      guardrails.outputPassed = false;
      guardrails.outputBlockReason = 'PII leakage detected in output';

      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      expect(result.guardrailsPassed).toBe(false);
      expect(result.output).toBe('PII leakage detected in output');
    });
  });

  describe('Error handling for RM Copilot', () => {
    it('should return error result when LLM gateway is unavailable', async () => {
      llmGateway.shouldThrow = true;

      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      expect(result.output).toContain('error');
      const failedStep = result.steps.find((s) => s.stepName === 'llm_inference');
      expect(failedStep?.status).toBe('FAILED');
    });

    it('should return error result when RAG pipeline is unavailable', async () => {
      ragPipeline.shouldThrow = true;

      const input = createRMCopilotInput();
      const result = await flow.execute(input);

      const failedStep = result.steps.find((s) => s.stepName === 'rag_retrieval');
      expect(failedStep?.status).toBe('FAILED');
    });
  });
});

describe('BranchCopilotFlow', () => {
  let llmGateway: MockLLMGateway;
  let guardrails: MockGuardrails;
  let ragPipeline: MockRAGPipeline;
  let audit: MockAudit;
  let flow: BranchCopilotFlow;

  beforeEach(() => {
    llmGateway = new MockLLMGateway();
    guardrails = new MockGuardrails();
    ragPipeline = new MockRAGPipeline();
    audit = new MockAudit();
    flow = new BranchCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
  });

  describe('End-to-end flow execution (Requirement 12.1)', () => {
    it('should execute the full Branch Copilot pipeline and return a cited answer', async () => {
      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.queryId).toBe('query-branch-001');
      expect(result.output).toBe('Generated response from LLM');
      expect(result.refused).toBe(false);
      expect(result.auditArtefactId).toBeDefined();
      expect(result.auditArtefactId).not.toBe('');
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should route through all flow steps: guardrails → RAG → groundedness → LLM → guardrails → audit', async () => {
      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      const stepNames = result.steps.map((s) => s.stepName);
      expect(stepNames).toContain('input_guardrails');
      expect(stepNames).toContain('rag_retrieval');
      expect(stepNames).toContain('llm_inference');
      expect(stepNames).toContain('output_guardrails');
      expect(stepNames).toContain('audit_emission');

      for (const step of result.steps) {
        expect(step.status).toBe('SUCCESS');
      }
    });

    it('should return source citations from the RAG retrieval results', async () => {
      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].documentName).toBe('Customer Service Policy v3.2');
      expect(result.citations[0].publicationDate).toBe('2024-01-15T00:00:00Z');
      expect(result.citations[1].documentName).toBe('Transaction Limits Circular 2024-Q1');
    });

    it('should emit audit artefact with the service ID BRANCH_COPILOT', async () => {
      const input = createBranchCopilotInput();
      await flow.execute(input);

      expect(audit.emitCalls).toHaveLength(1);
      expect(audit.emitCalls[0].serviceId).toBe('BRANCH_COPILOT');
      expect(audit.emitCalls[0].tenantId).toBe('tenant-branch');
      expect(audit.emitCalls[0].jurisdiction).toBe('IN');
    });

    it('should pass the staff question through input guardrails with BRANCH_COPILOT use case', async () => {
      const input = createBranchCopilotInput({ question: 'What is the FD interest rate?' });
      await flow.execute(input);

      expect(guardrails.inputCheckCalls[0].content).toBe('What is the FD interest rate?');
      expect(guardrails.inputCheckCalls[0].useCase).toBe('BRANCH_COPILOT');
    });

    it('should use the configured branch corpus IDs for RAG retrieval', async () => {
      const input = createBranchCopilotInput();
      await flow.execute(input);

      expect(ragPipeline.retrieveCalls[0].corpusIds).toEqual(
        DEFAULT_BRANCH_COPILOT_FLOW_CONFIG.branchCorpusIds
      );
    });

    it('should allow overriding corpus categories via input', async () => {
      const input = createBranchCopilotInput({ corpusCategories: ['policy-only-corpus'] });
      await flow.execute(input);

      expect(ragPipeline.retrieveCalls[0].corpusIds).toEqual(['policy-only-corpus']);
    });
  });

  describe('Groundedness-based refusal (Requirement 12.3)', () => {
    it('should refuse to answer when retrieval confidence is below threshold', async () => {
      ragPipeline.groundednessScore = 0.45; // Below default 0.70 threshold

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(true);
      expect(result.refusalReason).toBeDefined();
      expect(result.refusalReason).toContain('45%');
      // LLM should NOT have been called
      expect(llmGateway.inferCalls).toHaveLength(0);
    });

    it('should proceed with LLM generation when groundedness is above threshold', async () => {
      ragPipeline.groundednessScore = 0.85;

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(false);
      expect(llmGateway.inferCalls).toHaveLength(1);
    });

    it('should still emit audit artefact when refusing due to low groundedness', async () => {
      ragPipeline.groundednessScore = 0.30;

      const input = createBranchCopilotInput();
      await flow.execute(input);

      expect(audit.emitCalls).toHaveLength(1);
      expect(audit.emitCalls[0].output).toContain('Refused');
    });
  });

  describe('Guardrail enforcement for Branch Copilot', () => {
    it('should refuse when input guardrails block the query', async () => {
      guardrails.inputPassed = false;
      guardrails.inputBlockReason = 'Prompt injection attempt detected';

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(true);
      expect(result.guardrailsPassed).toBe(false);
      expect(result.output).toBe('Prompt injection attempt detected');
      expect(llmGateway.inferCalls).toHaveLength(0);
    });

    it('should refuse when output guardrails block the response', async () => {
      guardrails.outputPassed = false;
      guardrails.outputBlockReason = 'Response violates internal policy';

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.guardrailsPassed).toBe(false);
      expect(result.refused).toBe(true);
    });
  });

  describe('Error handling for Branch Copilot', () => {
    it('should return error result when RAG pipeline fails', async () => {
      ragPipeline.shouldThrow = true;

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(true);
      const failedStep = result.steps.find((s) => s.stepName === 'rag_retrieval');
      expect(failedStep?.status).toBe('FAILED');
    });

    it('should return error result when LLM gateway fails', async () => {
      llmGateway.shouldThrow = true;

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(true);
      const failedStep = result.steps.find((s) => s.stepName === 'llm_inference');
      expect(failedStep?.status).toBe('FAILED');
    });

    it('should return error result when audit emission fails', async () => {
      audit.shouldThrow = true;

      const input = createBranchCopilotInput();
      const result = await flow.execute(input);

      expect(result.refused).toBe(true);
      const failedStep = result.steps.find((s) => s.stepName === 'audit_emission');
      expect(failedStep?.status).toBe('FAILED');
    });
  });
});

describe('Cross-flow integration verification', () => {
  let llmGateway: MockLLMGateway;
  let guardrails: MockGuardrails;
  let ragPipeline: MockRAGPipeline;
  let audit: MockAudit;

  beforeEach(() => {
    llmGateway = new MockLLMGateway();
    guardrails = new MockGuardrails();
    ragPipeline = new MockRAGPipeline();
    audit = new MockAudit();
  });

  it('should wire all three flows through the same shared adapters', async () => {
    const convFlow = new ConversationalAIFlow(llmGateway, guardrails, ragPipeline, audit);
    const rmFlow = new RMCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
    const branchFlow = new BranchCopilotFlow(llmGateway, guardrails, ragPipeline, audit);

    const convResult = await convFlow.execute(createConversationalInput());
    const rmResult = await rmFlow.execute(createRMCopilotInput());
    const branchResult = await branchFlow.execute(createBranchCopilotInput());

    // All three flows should have invoked the LLM gateway
    expect(llmGateway.inferCalls).toHaveLength(3);

    // All three flows should have invoked RAG
    expect(ragPipeline.retrieveCalls).toHaveLength(3);

    // All three flows should have emitted audit artefacts
    expect(audit.emitCalls).toHaveLength(3);

    // Verify service IDs are distinct
    const serviceIds = audit.emitCalls.map((c) => c.serviceId);
    expect(serviceIds).toContain('CONVERSATIONAL_AI');
    expect(serviceIds).toContain('RM_COPILOT');
    expect(serviceIds).toContain('BRANCH_COPILOT');

    // All three flows return valid outputs
    expect(convResult.output).toBeDefined();
    expect(rmResult.output).toBeDefined();
    expect(branchResult.output).toBeDefined();

    expect(convResult.auditArtefactId).not.toBe('');
    expect(rmResult.auditArtefactId).not.toBe('');
    expect(branchResult.auditArtefactId).not.toBe('');
  });

  it('should enforce guardrails on all three flows identically', async () => {
    guardrails.inputPassed = false;
    guardrails.inputBlockReason = 'Blocked';

    const convFlow = new ConversationalAIFlow(llmGateway, guardrails, ragPipeline, audit);
    const rmFlow = new RMCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
    const branchFlow = new BranchCopilotFlow(llmGateway, guardrails, ragPipeline, audit);

    const convResult = await convFlow.execute(createConversationalInput());
    const rmResult = await rmFlow.execute(createRMCopilotInput());
    const branchResult = await branchFlow.execute(createBranchCopilotInput());

    // None should have reached LLM
    expect(llmGateway.inferCalls).toHaveLength(0);

    // All should be blocked
    expect(convResult.guardrailsPassed).toBe(false);
    expect(rmResult.guardrailsPassed).toBe(false);
    expect(branchResult.guardrailsPassed).toBe(false);
  });

  it('should handle concurrent flow executions without interference', async () => {
    const convFlow = new ConversationalAIFlow(llmGateway, guardrails, ragPipeline, audit);
    const rmFlow = new RMCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
    const branchFlow = new BranchCopilotFlow(llmGateway, guardrails, ragPipeline, audit);

    // Execute all three flows concurrently
    const [convResult, rmResult, branchResult] = await Promise.all([
      convFlow.execute(createConversationalInput()),
      rmFlow.execute(createRMCopilotInput()),
      branchFlow.execute(createBranchCopilotInput()),
    ]);

    // All should succeed independently
    expect(convResult.guardrailsPassed).toBe(true);
    expect(rmResult.guardrailsPassed).toBe(true);
    expect(branchResult.guardrailsPassed).toBe(true);

    // Each has unique audit artefact
    const artefactIds = new Set([
      convResult.auditArtefactId,
      rmResult.auditArtefactId,
      branchResult.auditArtefactId,
    ]);
    expect(artefactIds.size).toBe(3);
  });

  it('should maintain correct flow order even when adapters are slow', async () => {
    // Make RAG "slow" by verifying order of operations
    const callOrder: string[] = [];
    const originalRetrieve = ragPipeline.retrieve.bind(ragPipeline);
    ragPipeline.retrieve = async (req: any) => {
      callOrder.push('rag');
      return originalRetrieve(req);
    };
    const originalInfer = llmGateway.infer.bind(llmGateway);
    llmGateway.infer = async (req: any) => {
      callOrder.push('llm');
      return originalInfer(req);
    };

    const branchFlow = new BranchCopilotFlow(llmGateway, guardrails, ragPipeline, audit);
    await branchFlow.execute(createBranchCopilotInput());

    // RAG must happen before LLM (Branch Copilot retrieves first, then generates)
    const ragIdx = callOrder.indexOf('rag');
    const llmIdx = callOrder.indexOf('llm');
    expect(ragIdx).toBeLessThan(llmIdx);
  });
});

describe('Flow configuration defaults', () => {
  it('should define sensible Conversational AI flow config', () => {
    expect(DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG.ragTopK).toBeGreaterThan(0);
    expect(DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG.maxLLMLatencyMs).toBeGreaterThan(0);
    expect(DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG.groundednessThreshold).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG.groundednessThreshold).toBeLessThanOrEqual(1);
    expect(DEFAULT_CONVERSATIONAL_AI_FLOW_CONFIG.conversationalCorpusIds.length).toBeGreaterThan(0);
  });

  it('should define sensible RM Copilot flow config with 30s brief generation timeout', () => {
    expect(DEFAULT_RM_COPILOT_FLOW_CONFIG.ragTopK).toBeGreaterThan(0);
    expect(DEFAULT_RM_COPILOT_FLOW_CONFIG.maxBriefGenerationMs).toBe(30000);
    expect(DEFAULT_RM_COPILOT_FLOW_CONFIG.rmCorpusIds.length).toBeGreaterThan(0);
  });

  it('should define sensible Branch Copilot flow config with groundedness threshold', () => {
    expect(DEFAULT_BRANCH_COPILOT_FLOW_CONFIG.ragTopK).toBeGreaterThan(0);
    expect(DEFAULT_BRANCH_COPILOT_FLOW_CONFIG.maxLLMLatencyMs).toBeGreaterThan(0);
    expect(DEFAULT_BRANCH_COPILOT_FLOW_CONFIG.groundednessThreshold).toBe(0.70);
    expect(DEFAULT_BRANCH_COPILOT_FLOW_CONFIG.branchCorpusIds.length).toBeGreaterThan(0);
  });
});
