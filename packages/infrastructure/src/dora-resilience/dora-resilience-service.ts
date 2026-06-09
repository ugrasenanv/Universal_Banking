/**
 * DORA-Aligned Operational Resilience Service.
 *
 * Manages the ICT risk register, validates third-party concentration risk,
 * verifies exit strategy compliance, and maintains service criticality
 * classifications with recovery runbooks.
 *
 * Requirements: 30.1, 30.2, 30.3, 30.4
 */

import type { ISO8601 } from '@afg/shared-types';
import type {
  IctRiskRegisterEntry,
  ConcentrationRiskAssessment,
  ExitStrategy,
  RecoveryRunbook,
  DoraComplianceResult,
  DoraRequirementResult,
  ComplianceFinding,
  CriticalityTier,
  VendorCategory,
  DoraJurisdiction,
} from './types.js';

/** RTO targets by criticality tier (in minutes). */
const RTO_BY_TIER: Record<CriticalityTier, number> = {
  CRITICAL: 5,
  HIGH: 30,
  MEDIUM: 120,
  LOW: 480,
};

/** RPO targets by criticality tier (in minutes). */
const RPO_BY_TIER: Record<CriticalityTier, number> = {
  CRITICAL: 1,
  HIGH: 15,
  MEDIUM: 60,
  LOW: 240,
};

/** Maximum days allowed for exit strategy execution (DORA Req 30.2, 30.3). */
const MAX_EXIT_DAYS = 90;

/** Maximum days before a review is considered overdue. */
const REVIEW_OVERDUE_DAYS = 7;

export class DoraResilienceService {
  private riskRegister: Map<string, IctRiskRegisterEntry> = new Map();
  private exitStrategies: Map<string, ExitStrategy> = new Map();
  private runbooks: Map<string, RecoveryRunbook> = new Map();

  // ─── Risk Register Management (Req 30.1) ─────────────────────────────────

  /**
   * Add or update an entry in the ICT risk register.
   */
  addRiskEntry(entry: IctRiskRegisterEntry): void {
    this.riskRegister.set(entry.entryId, entry);
  }

  /**
   * Get a risk register entry by ID.
   */
  getRiskEntry(entryId: string): IctRiskRegisterEntry | undefined {
    return this.riskRegister.get(entryId);
  }

  /**
   * Get all risk register entries.
   */
  getAllRiskEntries(): IctRiskRegisterEntry[] {
    return Array.from(this.riskRegister.values());
  }

  /**
   * Get risk entries filtered by jurisdiction.
   */
  getRiskEntriesByJurisdiction(jurisdiction: DoraJurisdiction): IctRiskRegisterEntry[] {
    return this.getAllRiskEntries().filter(
      (entry) => entry.jurisdictions.includes(jurisdiction)
    );
  }

  /**
   * Get risk entries filtered by criticality tier.
   */
  getRiskEntriesByTier(tier: CriticalityTier): IctRiskRegisterEntry[] {
    return this.getAllRiskEntries().filter(
      (entry) => entry.criticalityTier === tier
    );
  }

  /**
   * Check if a risk entry review is overdue (Req 30.1: reviewed quarterly).
   */
  isReviewOverdue(entry: IctRiskRegisterEntry, currentDate: ISO8601): boolean {
    const nextReview = new Date(entry.nextReviewDate);
    const current = new Date(currentDate);
    const overdueThreshold = new Date(nextReview);
    overdueThreshold.setDate(overdueThreshold.getDate() + REVIEW_OVERDUE_DAYS);
    return current > overdueThreshold;
  }

  /**
   * Get entries with overdue reviews.
   */
  getOverdueReviews(currentDate: ISO8601): IctRiskRegisterEntry[] {
    return this.getAllRiskEntries().filter((entry) =>
      this.isReviewOverdue(entry, currentDate)
    );
  }

  // ─── Exit Strategy Management (Req 30.2, 30.3) ───────────────────────────

  /**
   * Add or update an exit strategy.
   */
  addExitStrategy(strategy: ExitStrategy): void {
    this.exitStrategies.set(strategy.strategyId, strategy);
  }

  /**
   * Get an exit strategy by ID.
   */
  getExitStrategy(strategyId: string): ExitStrategy | undefined {
    return this.exitStrategies.get(strategyId);
  }

  /**
   * Get all exit strategies.
   */
  getAllExitStrategies(): ExitStrategy[] {
    return Array.from(this.exitStrategies.values());
  }

  /**
   * Validate that an exit strategy is executable within 90 days.
   * Checks:
   * - maxExecutionDays <= 90
   * - Sum of step durations (critical path) <= 90 days
   * - All steps have assigned responsible teams
   */
  validateExitStrategy(strategy: ExitStrategy): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check max execution days
    if (strategy.maxExecutionDays > MAX_EXIT_DAYS) {
      issues.push(
        `Exit strategy exceeds 90-day limit: ${strategy.maxExecutionDays} days`
      );
    }

    // Calculate critical path duration
    const criticalPathDays = this.calculateCriticalPath(strategy);
    if (criticalPathDays > MAX_EXIT_DAYS) {
      issues.push(
        `Critical path duration (${criticalPathDays} days) exceeds 90-day limit`
      );
    }

    // Verify all steps have responsible teams
    const stepsWithoutTeam = strategy.steps.filter(
      (step) => !step.responsibleTeam || step.responsibleTeam.trim() === ''
    );
    if (stepsWithoutTeam.length > 0) {
      issues.push(
        `${stepsWithoutTeam.length} step(s) missing responsible team assignment`
      );
    }

    // Verify target vendors exist
    if (strategy.targetVendors.length === 0) {
      issues.push('No target vendors specified for migration');
    }

    // Verify affected services are documented
    if (strategy.affectedServices.length === 0) {
      issues.push('No affected services documented');
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Calculate the critical path duration in days for an exit strategy.
   * Uses topological ordering respecting step dependencies.
   */
  calculateCriticalPath(strategy: ExitStrategy): number {
    if (strategy.steps.length === 0) return 0;

    // Build a map of step durations and dependencies
    const stepDurations = new Map<number, number>();
    const stepDeps = new Map<number, number[]>();

    for (const step of strategy.steps) {
      stepDurations.set(step.stepNumber, step.estimatedDurationDays);
      stepDeps.set(step.stepNumber, step.dependencies);
    }

    // Calculate earliest completion time for each step (critical path)
    const earliestCompletion = new Map<number, number>();

    const getEarliestCompletion = (stepNum: number): number => {
      if (earliestCompletion.has(stepNum)) {
        return earliestCompletion.get(stepNum)!;
      }

      const deps = stepDeps.get(stepNum) ?? [];
      const duration = stepDurations.get(stepNum) ?? 0;

      if (deps.length === 0) {
        earliestCompletion.set(stepNum, duration);
        return duration;
      }

      const maxDepCompletion = Math.max(
        ...deps.map((dep) => getEarliestCompletion(dep))
      );
      const completion = maxDepCompletion + duration;
      earliestCompletion.set(stepNum, completion);
      return completion;
    };

    // Calculate for all steps and find the maximum
    let maxCompletion = 0;
    for (const step of strategy.steps) {
      const completion = getEarliestCompletion(step.stepNumber);
      maxCompletion = Math.max(maxCompletion, completion);
    }

    return maxCompletion;
  }

  // ─── Recovery Runbook Management (Req 30.4) ───────────────────────────────

  /**
   * Add or update a recovery runbook.
   */
  addRunbook(runbook: RecoveryRunbook): void {
    this.runbooks.set(runbook.runbookId, runbook);
  }

  /**
   * Get a recovery runbook by ID.
   */
  getRunbook(runbookId: string): RecoveryRunbook | undefined {
    return this.runbooks.get(runbookId);
  }

  /**
   * Get all runbooks.
   */
  getAllRunbooks(): RecoveryRunbook[] {
    return Array.from(this.runbooks.values());
  }

  /**
   * Get runbooks by criticality tier.
   */
  getRunbooksByTier(tier: CriticalityTier): RecoveryRunbook[] {
    return this.getAllRunbooks().filter(
      (runbook) => runbook.criticalityTier === tier
    );
  }

  /**
   * Validate a runbook against its tier's RTO target.
   * Estimated recovery must be <= the tier's RTO.
   */
  validateRunbookRto(runbook: RecoveryRunbook): {
    valid: boolean;
    targetRtoMinutes: number;
    estimatedMinutes: number;
  } {
    const targetRto = RTO_BY_TIER[runbook.criticalityTier];
    return {
      valid: runbook.estimatedRecoveryMinutes <= targetRto,
      targetRtoMinutes: targetRto,
      estimatedMinutes: runbook.estimatedRecoveryMinutes,
    };
  }

  /**
   * Check if a runbook test is overdue (Req 30.4: tested semi-annually).
   */
  isRunbookTestOverdue(runbook: RecoveryRunbook, currentDate: ISO8601): boolean {
    if (!runbook.nextTestDate) return true;
    const nextTest = new Date(runbook.nextTestDate);
    const current = new Date(currentDate);
    return current > nextTest;
  }

  /**
   * Get runbooks with overdue tests.
   */
  getOverdueRunbookTests(currentDate: ISO8601): RecoveryRunbook[] {
    return this.getAllRunbooks().filter((runbook) =>
      this.isRunbookTestOverdue(runbook, currentDate)
    );
  }

  // ─── Concentration Risk Assessment (Req 30.2) ────────────────────────────

  /**
   * Assess third-party concentration risk across all registered services.
   * Groups vendor dependencies by category and identifies SPOFs.
   */
  assessConcentrationRisk(): ConcentrationRiskAssessment[] {
    const categoryVendors = new Map<VendorCategory, Set<string>>();
    const categoryServices = new Map<VendorCategory, Set<string>>();
    const categorySpofs = new Map<VendorCategory, boolean>();

    for (const entry of this.riskRegister.values()) {
      for (const dep of entry.vendorDependencies) {
        if (!categoryVendors.has(dep.category)) {
          categoryVendors.set(dep.category, new Set());
          categoryServices.set(dep.category, new Set());
          categorySpofs.set(dep.category, false);
        }
        categoryVendors.get(dep.category)!.add(dep.vendorName);
        categoryServices.get(dep.category)!.add(entry.serviceId);
        if (dep.isSinglePointOfFailure) {
          categorySpofs.set(dep.category, true);
        }
      }
    }

    const assessments: ConcentrationRiskAssessment[] = [];

    for (const [category, vendors] of categoryVendors.entries()) {
      const hasSpof = categorySpofs.get(category) ?? false;
      const services = Array.from(categoryServices.get(category) ?? []);

      // Check if there's an exit strategy for SPOF vendors
      let exitStrategyId: string | undefined;
      let exitStrategyTested = false;

      if (hasSpof) {
        const strategy = this.getAllExitStrategies().find(
          (s) => s.category === category
        );
        if (strategy) {
          exitStrategyId = strategy.strategyId;
          exitStrategyTested = strategy.status === 'TESTED';
        }
      }

      // Compliant if: no SPOF OR (SPOF with documented & tested exit strategy)
      const compliant = !hasSpof || (!!exitStrategyId && exitStrategyTested);

      assessments.push({
        category,
        vendors: Array.from(vendors),
        hasSinglePointOfFailure: hasSpof,
        dependentServices: services,
        mitigationStrategy: hasSpof
          ? `Exit strategy ${exitStrategyId ?? 'NOT DOCUMENTED'} for ${category}`
          : `Multiple vendors available: ${Array.from(vendors).join(', ')}`,
        exitStrategyId,
        exitStrategyTested,
        compliant,
      });
    }

    return assessments;
  }

  // ─── DORA Compliance Validation ───────────────────────────────────────────

  /**
   * Perform full DORA compliance validation across all four requirements.
   */
  validateCompliance(currentDate: ISO8601): DoraComplianceResult {
    const requirements: DoraRequirementResult[] = [];
    const findings: ComplianceFinding[] = [];

    // Req 30.1: ICT risk register with quarterly review
    const req301 = this.validateReq301(currentDate);
    requirements.push(req301.result);
    findings.push(...req301.findings);

    // Req 30.2: Third-party concentration risk mitigation
    const req302 = this.validateReq302();
    requirements.push(req302.result);
    findings.push(...req302.findings);

    // Req 30.3: Annual exit testing within 90 days
    const req303 = this.validateReq303(currentDate);
    requirements.push(req303.result);
    findings.push(...req303.findings);

    // Req 30.4: Criticality classification and tested runbooks
    const req304 = this.validateReq304(currentDate);
    requirements.push(req304.result);
    findings.push(...req304.findings);

    const compliant = requirements.every((r) => r.compliant);

    return {
      compliant,
      validatedAt: currentDate,
      requirements,
      findings,
    };
  }

  private validateReq301(currentDate: ISO8601): {
    result: DoraRequirementResult;
    findings: ComplianceFinding[];
  } {
    const findings: ComplianceFinding[] = [];
    const entries = this.getAllRiskEntries();

    // Must have at least one entry
    if (entries.length === 0) {
      findings.push({
        severity: 'CRITICAL',
        requirementId: '30.1',
        description: 'ICT risk register is empty — no services documented',
        remediation: 'Document all critical AI/ML services in the risk register',
        affectedServices: [],
      });
    }

    // Check for overdue reviews
    const overdueEntries = this.getOverdueReviews(currentDate);
    if (overdueEntries.length > 0) {
      findings.push({
        severity: 'HIGH',
        requirementId: '30.1',
        description: `${overdueEntries.length} service(s) have overdue quarterly reviews`,
        remediation: 'Complete overdue risk register reviews immediately',
        affectedServices: overdueEntries.map((e) => e.serviceId),
      });
    }

    // Check entries have impact assessments
    const missingImpact = entries.filter(
      (e) => !e.impactAssessment || e.impactAssessment.downstreamDependencies.length === 0
    );
    if (missingImpact.length > 0) {
      findings.push({
        severity: 'MEDIUM',
        requirementId: '30.1',
        description: `${missingImpact.length} entry(ies) missing complete impact assessment`,
        remediation: 'Complete impact assessments including downstream dependencies',
        affectedServices: missingImpact.map((e) => e.serviceId),
      });
    }

    // Check entries cover UK/EU jurisdictions
    const ukEuEntries = entries.filter(
      (e) => e.jurisdictions.includes('UK') || e.jurisdictions.includes('EU')
    );
    if (entries.length > 0 && ukEuEntries.length === 0) {
      findings.push({
        severity: 'HIGH',
        requirementId: '30.1',
        description: 'No risk entries cover UK or EU jurisdictions (DORA scope)',
        remediation: 'Ensure all services operating in UK/EU are registered',
        affectedServices: [],
      });
    }

    return {
      result: {
        requirementId: '30.1',
        compliant: findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0,
        details: findings.length === 0
          ? `ICT risk register complete with ${entries.length} entries, all reviews current`
          : `${findings.length} finding(s) identified`,
      },
      findings,
    };
  }

  private validateReq302(): {
    result: DoraRequirementResult;
    findings: ComplianceFinding[];
  } {
    const findings: ComplianceFinding[] = [];
    const assessments = this.assessConcentrationRisk();

    const nonCompliant = assessments.filter((a) => !a.compliant);
    for (const assessment of nonCompliant) {
      findings.push({
        severity: 'CRITICAL',
        requirementId: '30.2',
        description: `Single point of failure in ${assessment.category}: vendor(s) ${assessment.vendors.join(', ')} without tested exit strategy`,
        remediation: `Document and test exit strategy for ${assessment.category} vendor dependency`,
        affectedServices: assessment.dependentServices,
      });
    }

    return {
      result: {
        requirementId: '30.2',
        compliant: nonCompliant.length === 0,
        details: nonCompliant.length === 0
          ? `No unmitigated concentration risk across ${assessments.length} vendor categories`
          : `${nonCompliant.length} vendor category(ies) with unmitigated concentration risk`,
      },
      findings,
    };
  }

  private validateReq303(currentDate: ISO8601): {
    result: DoraRequirementResult;
    findings: ComplianceFinding[];
  } {
    const findings: ComplianceFinding[] = [];
    const strategies = this.getAllExitStrategies();

    if (strategies.length === 0) {
      findings.push({
        severity: 'CRITICAL',
        requirementId: '30.3',
        description: 'No exit strategies documented',
        remediation: 'Document exit strategies for all critical vendor dependencies',
        affectedServices: [],
      });
    }

    for (const strategy of strategies) {
      // Validate 90-day executability
      const validation = this.validateExitStrategy(strategy);
      if (!validation.valid) {
        findings.push({
          severity: 'HIGH',
          requirementId: '30.3',
          description: `Exit strategy "${strategy.strategyId}" for ${strategy.vendorName}: ${validation.issues.join('; ')}`,
          remediation: 'Revise exit strategy to meet 90-day execution requirement',
          affectedServices: strategy.affectedServices,
        });
      }

      // Check annual testing
      if (!strategy.lastTestDate) {
        findings.push({
          severity: 'HIGH',
          requirementId: '30.3',
          description: `Exit strategy "${strategy.strategyId}" has never been tested`,
          remediation: 'Conduct annual exit testing as required by DORA',
          affectedServices: strategy.affectedServices,
        });
      } else {
        const lastTest = new Date(strategy.lastTestDate);
        const current = new Date(currentDate);
        const daysSinceTest = Math.floor(
          (current.getTime() - lastTest.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceTest > 365) {
          findings.push({
            severity: 'HIGH',
            requirementId: '30.3',
            description: `Exit strategy "${strategy.strategyId}" last tested ${daysSinceTest} days ago (annual testing required)`,
            remediation: 'Schedule and conduct annual exit testing',
            affectedServices: strategy.affectedServices,
          });
        }
      }
    }

    return {
      result: {
        requirementId: '30.3',
        compliant: findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0,
        details: findings.length === 0
          ? `All ${strategies.length} exit strategies validated and tested within annual cycle`
          : `${findings.length} finding(s) related to exit strategy compliance`,
      },
      findings,
    };
  }

  private validateReq304(currentDate: ISO8601): {
    result: DoraRequirementResult;
    findings: ComplianceFinding[];
  } {
    const findings: ComplianceFinding[] = [];
    const runbooks = this.getAllRunbooks();
    const entries = this.getAllRiskEntries();

    // Every risk register entry should have a runbook
    const runbookServiceIds = new Set(runbooks.map((r) => r.serviceId));
    const entriesWithoutRunbook = entries.filter(
      (e) => !runbookServiceIds.has(e.serviceId)
    );

    if (entriesWithoutRunbook.length > 0) {
      findings.push({
        severity: 'HIGH',
        requirementId: '30.4',
        description: `${entriesWithoutRunbook.length} service(s) in risk register without recovery runbooks`,
        remediation: 'Create recovery runbooks for all registered services',
        affectedServices: entriesWithoutRunbook.map((e) => e.serviceId),
      });
    }

    // Validate RTO alignment
    for (const runbook of runbooks) {
      const rtoValidation = this.validateRunbookRto(runbook);
      if (!rtoValidation.valid) {
        findings.push({
          severity: 'HIGH',
          requirementId: '30.4',
          description: `Runbook "${runbook.runbookId}" estimated recovery (${rtoValidation.estimatedMinutes}min) exceeds tier RTO (${rtoValidation.targetRtoMinutes}min)`,
          remediation: 'Optimise recovery steps or reclassify service tier',
          affectedServices: [runbook.serviceId],
        });
      }
    }

    // Check semi-annual testing
    const overdueTests = this.getOverdueRunbookTests(currentDate);
    if (overdueTests.length > 0) {
      findings.push({
        severity: 'MEDIUM',
        requirementId: '30.4',
        description: `${overdueTests.length} runbook(s) overdue for semi-annual testing`,
        remediation: 'Schedule and conduct runbook testing',
        affectedServices: overdueTests.map((r) => r.serviceId),
      });
    }

    // Check untested runbooks
    const untestedRunbooks = runbooks.filter(
      (r) => r.lastTestStatus === 'NOT_TESTED'
    );
    if (untestedRunbooks.length > 0) {
      findings.push({
        severity: 'HIGH',
        requirementId: '30.4',
        description: `${untestedRunbooks.length} runbook(s) have never been tested`,
        remediation: 'Test all recovery runbooks at least semi-annually',
        affectedServices: untestedRunbooks.map((r) => r.serviceId),
      });
    }

    return {
      result: {
        requirementId: '30.4',
        compliant: findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length === 0,
        details: findings.length === 0
          ? `All ${runbooks.length} runbooks validated, RTO-compliant, and tested`
          : `${findings.length} finding(s) related to runbook compliance`,
      },
      findings,
    };
  }
}

/**
 * Get the default RTO target for a criticality tier.
 */
export function getRtoForTier(tier: CriticalityTier): number {
  return RTO_BY_TIER[tier];
}

/**
 * Get the default RPO target for a criticality tier.
 */
export function getRpoForTier(tier: CriticalityTier): number {
  return RPO_BY_TIER[tier];
}
