/**
 * State Provider Interface
 *
 * Each Australian state/territory implements this interface to supply
 * PersistedForestPoint entries for the final snapshot.
 *
 * Providers handle:
 *  - Fetching forest/park/campground locations
 *  - Fetching fire ban / fire danger status
 *  - Assembling PersistedForestPoint[] entries
 */

import type { AustralianState, PersistedForestPoint } from "../../shared/contracts.js";

export interface StateProviderResult {
  points: PersistedForestPoint[];
  warnings: string[];
}

export interface IStateProvider {
  readonly stateCode: AustralianState;
  readonly stateName: string;
  fetchPoints(): Promise<StateProviderResult>;
}

/** Convenience: a no-op provider that returns empty results with a warning. */
export class StubStateProvider implements IStateProvider {
  readonly stateCode: AustralianState;
  readonly stateName: string;

  constructor(stateCode: AustralianState, stateName: string) {
    this.stateCode = stateCode;
    this.stateName = stateName;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    return {
      points: [],
      warnings: [`${this.stateName} (${this.stateCode}) provider not yet implemented.`],
    };
  }
}
