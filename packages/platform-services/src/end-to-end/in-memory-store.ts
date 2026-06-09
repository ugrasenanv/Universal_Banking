/**
 * In-memory store implementation for DORA Resilience testing.
 */

import type {
  ConcentrationRiskAssessment,
  DORAResilienceStore,
  ExitStrategy,
  ICTRiskRegister,
  RecoveryRunbook,
  VendorDependency,
} from './types.js';

/**
 * In-memory implementation of DORAResilienceStore for unit testing.
 */
export class InMemoryDORAStore implements DORAResilienceStore {
  private riskRegister: ICTRiskRegister | null = null;
  private vendors = new Map<string, VendorDependency>();
  private assessments = new Map<string, ConcentrationRiskAssessment[]>();
  private exitStrategies = new Map<string, ExitStrategy>();
  private runbooks = new Map<string, RecoveryRunbook>();

  async saveRiskRegister(register: ICTRiskRegister): Promise<void> {
    this.riskRegister = { ...register };
  }

  async getRiskRegister(): Promise<ICTRiskRegister | null> {
    return this.riskRegister;
  }

  async saveVendorDependency(vendor: VendorDependency): Promise<void> {
    this.vendors.set(vendor.vendorId, { ...vendor });
  }

  async getVendorDependencies(): Promise<VendorDependency[]> {
    return Array.from(this.vendors.values());
  }

  async getVendorDependency(vendorId: string): Promise<VendorDependency | null> {
    return this.vendors.get(vendorId) ?? null;
  }

  async saveConcentrationAssessment(assessment: ConcentrationRiskAssessment): Promise<void> {
    const existing = this.assessments.get(assessment.vendorId) ?? [];
    existing.push({ ...assessment });
    this.assessments.set(assessment.vendorId, existing);
  }

  async getConcentrationAssessments(vendorId: string): Promise<ConcentrationRiskAssessment[]> {
    return this.assessments.get(vendorId) ?? [];
  }

  async saveExitStrategy(strategy: ExitStrategy): Promise<void> {
    this.exitStrategies.set(strategy.vendorId, { ...strategy });
  }

  async getExitStrategy(vendorId: string): Promise<ExitStrategy | null> {
    return this.exitStrategies.get(vendorId) ?? null;
  }

  async getAllExitStrategies(): Promise<ExitStrategy[]> {
    return Array.from(this.exitStrategies.values());
  }

  async saveRecoveryRunbook(runbook: RecoveryRunbook): Promise<void> {
    this.runbooks.set(runbook.serviceId, { ...runbook });
  }

  async getRecoveryRunbook(serviceId: string): Promise<RecoveryRunbook | null> {
    return this.runbooks.get(serviceId) ?? null;
  }

  async getAllRecoveryRunbooks(): Promise<RecoveryRunbook[]> {
    return Array.from(this.runbooks.values());
  }
}
