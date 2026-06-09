/**
 * In-memory model store for testing.
 *
 * Provides a simple Map-based implementation of the ModelStore interface
 * suitable for unit tests and development.
 */

import type {
  ChallengerPairing,
  DriftAlert,
  ModelListFilters,
  ModelRecord,
  ModelStore,
} from './types.js';

export class InMemoryModelStore implements ModelStore {
  private readonly models = new Map<string, ModelRecord>();
  private readonly pairings = new Map<string, ChallengerPairing>();
  private readonly alerts = new Map<string, DriftAlert[]>();

  async save(model: ModelRecord): Promise<void> {
    this.models.set(model.modelId, { ...model });
  }

  async getById(modelId: string): Promise<ModelRecord | null> {
    const model = this.models.get(modelId);
    return model ? { ...model } : null;
  }

  async list(filters?: ModelListFilters): Promise<ModelRecord[]> {
    let results = Array.from(this.models.values());

    if (filters) {
      if (filters.domain !== undefined) {
        results = results.filter((m) => m.domain === filters.domain);
      }
      if (filters.riskTier !== undefined) {
        results = results.filter((m) => m.riskTier === filters.riskTier);
      }
      if (filters.validationStatus !== undefined) {
        results = results.filter((m) => m.validationStatus === filters.validationStatus);
      }
      if (filters.owner !== undefined) {
        results = results.filter((m) => m.owner === filters.owner);
      }
      if (filters.isArchived !== undefined) {
        results = results.filter((m) => m.isArchived === filters.isArchived);
      }
    }

    return results.map((m) => ({ ...m }));
  }

  async saveChallengerPairing(pairing: ChallengerPairing): Promise<void> {
    this.pairings.set(pairing.championModelId, { ...pairing });
  }

  async getChallengerPairing(championModelId: string): Promise<ChallengerPairing | null> {
    const pairing = this.pairings.get(championModelId);
    return pairing ? { ...pairing } : null;
  }

  async saveDriftAlert(alert: DriftAlert): Promise<void> {
    const existing = this.alerts.get(alert.modelId) ?? [];
    existing.push({ ...alert });
    this.alerts.set(alert.modelId, existing);
  }

  async getDriftAlerts(modelId: string): Promise<DriftAlert[]> {
    return (this.alerts.get(modelId) ?? []).map((a) => ({ ...a }));
  }
}
