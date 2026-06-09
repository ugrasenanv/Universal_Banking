/**
 * Branch Copilot Module
 *
 * Exports the Branch Copilot service and all related types.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

export { BranchCopilot } from './branch-copilot-service.js';
export { DEFAULT_BRANCH_COPILOT_CONFIG, isBranchCopilotRefusal } from './types.js';

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
} from './types.js';
