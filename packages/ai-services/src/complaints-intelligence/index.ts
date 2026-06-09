/**
 * Complaints Intelligence Service Module
 *
 * Exports the Complaints Intelligence Service and all associated types.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

export { ComplaintsIntelligenceService } from './complaints-intelligence-service.js';

export type {
  ComplaintCategory,
  ComplaintSubcategory,
  ResolutionTeam,
  CategoryTeamMapping,
  ComplaintClassificationRequest,
  ComplaintClassificationResponse,
  RBICMSComplaintSummary,
  ComplaintAuditRecord,
  ComplaintClassificationModelAdapter,
  ComplaintClassificationResult,
  ComplaintAuditEmitter,
  ComplaintsIntelligenceConfig,
} from './types.js';

export {
  DEFAULT_CATEGORY_TEAM_MAP,
  DEFAULT_COMPLAINTS_INTELLIGENCE_CONFIG,
} from './types.js';
