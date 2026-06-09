/**
 * AML Triage Service Module
 *
 * Exports the AML Triage Service and all associated types.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

export { AMLTriageService } from './aml-triage-service.js';

export type {
  AMLAlertType,
  AMLDisposition,
  AlertPayload,
  AMLTriageRequest,
  AMLTriageResponse,
  NarrativeScope,
  NarrativeGenerationRequest,
  Citation,
  NarrativeGenerationResponse,
  DataSourceStatus,
  SARFilingRequest,
  SARFilingResponse,
  AMLClassificationModelAdapter,
  ClassificationResult,
  AMLRAGAdapter,
  RAGCaseHistoryResult,
  RAGChunk,
  AMLNarrativeGeneratorAdapter,
  NarrativeResult,
  AMLAuditEmitter,
  AMLAuditArtefactInput,
  AMLTriageConfig,
} from './types.js';

export { DEFAULT_AML_TRIAGE_CONFIG } from './types.js';
