import type { Dispatch, SetStateAction } from "react";
import { FacilityIcon } from "./FacilityIcon";
import type { ClosureTagDefinition, FacilityDefinition } from "../lib/api";
import {
  type BanFilterMode,
  type ClosureFilterMode,
  type TriStateMode
} from "../lib/app-domain-types";
import {
  CLOSURES_SOURCE_URL,
  FACILITIES_SOURCE_URL,
  SOLID_FUEL_FIRE_BAN_SOURCE_URL,
  TOTAL_FIRE_BAN_RULES_URL,
  TOTAL_FIRE_BAN_SOURCE_URL
} from "../lib/app-domain-constants";

export type FilterPanelProps = {
  matchingForestsCount: number;
  forestsCount: number;
  solidFuelBanFilterMode: BanFilterMode;
  setSolidFuelBanFilterMode: Dispatch<SetStateAction<BanFilterMode>>;
  totalFireBanFilterMode: BanFilterMode;
  setTotalFireBanFilterMode: Dispatch<SetStateAction<BanFilterMode>>;
  closureFilterMode: ClosureFilterMode;
  setClosureFilterMode: Dispatch<SetStateAction<ClosureFilterMode>>;
  availableClosureTags: ClosureTagDefinition[];
  closureTagFilterModes: Record<string, TriStateMode>;
  clearClosureTagModes: () => void;
  toggleClosureTagMode: (key: string, mode: Exclude<TriStateMode, "ANY">) => void;
  setSingleClosureTagMode: (key: string, mode: TriStateMode) => void;
  impactCampingFilterMode: TriStateMode;
  setImpactCampingFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  impactAccessFilterMode: TriStateMode;
  setImpactAccessFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  availableFacilities: FacilityDefinition[];
  facilityFilterModes: Record<string, TriStateMode>;
  clearFacilityModes: () => void;
  toggleFacilityMode: (key: string, mode: Exclude<TriStateMode, "ANY">) => void;
  setSingleFacilityMode: (key: string, mode: TriStateMode) => void;
};

export const FilterPanel = ({
  matchingForestsCount,
  forestsCount,
  solidFuelBanFilterMode,
  setSolidFuelBanFilterMode,
  totalFireBanFilterMode,
  setTotalFireBanFilterMode,
  closureFilterMode,
  setClosureFilterMode,
  availableClosureTags,
  closureTagFilterModes,
  clearClosureTagModes,
  toggleClosureTagMode,
  setSingleClosureTagMode,
  impactCampingFilterMode,
  setImpactCampingFilterMode,
  impactAccessFilterMode,
  setImpactAccessFilterMode,
  availableFacilities,
  facilityFilterModes,
  clearFacilityModes,
  toggleFacilityMode,
  setSingleFacilityMode
}: FilterPanelProps) => {
  return (
    <aside className="panel filter-panel">
      <h2>Filters</h2>
      <p className="meta">
        Matching {matchingForestsCount} of {forestsCount} forests.
      </p>
      <div className="filter-panel-scroll">
        <section className="filter-section">
          <h3>
            <a
              className="source-link"
              href={SOLID_FUEL_FIRE_BAN_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Solid Fuel Fire Ban
            </a>
          </h3>
          <div className="tri-toggle-group">
            <button
              type="button"
              className={solidFuelBanFilterMode === "ALL" ? "is-active" : ""}
              onClick={() => setSolidFuelBanFilterMode("ALL")}
              data-testid="ban-filter-all"
            >
              All
            </button>
            <button
              type="button"
              className={solidFuelBanFilterMode === "NOT_BANNED" ? "is-active" : ""}
              onClick={() => setSolidFuelBanFilterMode("NOT_BANNED")}
              data-testid="ban-filter-allowed"
            >
              Not banned
            </button>
            <button
              type="button"
              className={solidFuelBanFilterMode === "BANNED" ? "is-active" : ""}
              onClick={() => setSolidFuelBanFilterMode("BANNED")}
              data-testid="ban-filter-not-allowed"
            >
              Banned
            </button>
            <button
              type="button"
              className={solidFuelBanFilterMode === "UNKNOWN" ? "is-active" : ""}
              onClick={() => setSolidFuelBanFilterMode("UNKNOWN")}
              data-testid="ban-filter-unknown"
            >
              Unknown
            </button>
          </div>
        </section>

        <section className="filter-section">
          <h3>
            <a
              className="source-link"
              href={TOTAL_FIRE_BAN_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Total Fire Ban
            </a>
          </h3>
          <p className="muted filter-subnote">
            <a className="source-link" href={TOTAL_FIRE_BAN_RULES_URL} target="_blank" rel="noreferrer">
              Rules
            </a>{" "}
            apply to all outdoor fire use during a declared Total Fire Ban.
          </p>
          <div className="tri-toggle-group">
            <button
              type="button"
              className={totalFireBanFilterMode === "ALL" ? "is-active" : ""}
              onClick={() => setTotalFireBanFilterMode("ALL")}
              data-testid="total-fire-ban-filter-all"
            >
              All
            </button>
            <button
              type="button"
              className={totalFireBanFilterMode === "NOT_BANNED" ? "is-active" : ""}
              onClick={() => setTotalFireBanFilterMode("NOT_BANNED")}
              data-testid="total-fire-ban-filter-not-banned"
            >
              No ban
            </button>
            <button
              type="button"
              className={totalFireBanFilterMode === "BANNED" ? "is-active" : ""}
              onClick={() => setTotalFireBanFilterMode("BANNED")}
              data-testid="total-fire-ban-filter-banned"
            >
              Banned
            </button>
            <button
              type="button"
              className={totalFireBanFilterMode === "UNKNOWN" ? "is-active" : ""}
              onClick={() => setTotalFireBanFilterMode("UNKNOWN")}
              data-testid="total-fire-ban-filter-unknown"
            >
              Unknown
            </button>
          </div>
        </section>

        <section className="filter-section">
          <h3>
            <a
              className="source-link"
              href={CLOSURES_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Closures & Notices
            </a>
          </h3>
          <div className="tri-toggle-group closure-filter-group">
            <button
              type="button"
              className={closureFilterMode === "ALL" ? "is-active" : ""}
              onClick={() => setClosureFilterMode("ALL")}
            >
              All
            </button>
            <button
              type="button"
              className={closureFilterMode === "OPEN_ONLY" ? "is-active" : ""}
              onClick={() => setClosureFilterMode("OPEN_ONLY")}
              data-testid="closure-filter-open-only"
            >
              Open only
            </button>
            <button
              type="button"
              className={closureFilterMode === "NO_FULL_CLOSURES" ? "is-active" : ""}
              onClick={() => setClosureFilterMode("NO_FULL_CLOSURES")}
              data-testid="closure-filter-no-full"
            >
              No full closures
            </button>
            <button
              type="button"
              className={closureFilterMode === "HAS_NOTICE" ? "is-active" : ""}
              onClick={() => setClosureFilterMode("HAS_NOTICE")}
              data-testid="closure-filter-has-notice"
            >
              Has notices
            </button>
          </div>
        </section>

        {availableClosureTags.length ? (
          <section className="filter-section">
            <div className="filter-section-header">
              <h3>Closure tags</h3>
              <button type="button" className="text-btn" onClick={clearClosureTagModes}>
                Clear
              </button>
            </div>
            <ul className="facility-filter-list">
              {availableClosureTags.map((closureTag) => {
                const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
                return (
                  <li key={closureTag.key} className="facility-filter-row">
                    <span className="facility-filter-label">
                      <span>{closureTag.label}</span>
                    </span>
                    <span className="tri-toggle" role="group" aria-label={`${closureTag.label} filter`}>
                      <button
                        type="button"
                        className={mode === "INCLUDE" ? "is-active include" : ""}
                        onClick={() => toggleClosureTagMode(closureTag.key, "INCLUDE")}
                        data-testid={`closure-tag-filter-${closureTag.key}-include`}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className={mode === "EXCLUDE" ? "is-active exclude" : ""}
                        onClick={() => toggleClosureTagMode(closureTag.key, "EXCLUDE")}
                        data-testid={`closure-tag-filter-${closureTag.key}-exclude`}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className={mode === "ANY" ? "is-active neutral" : ""}
                        onClick={() => setSingleClosureTagMode(closureTag.key, "ANY")}
                        data-testid={`closure-tag-filter-${closureTag.key}-any`}
                      >
                        ?
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="filter-section">
          <h3>Planning impact warnings</h3>
          <p className="muted closure-filter-meta">
            Highlight forests where notices suggest camping or access restrictions.
          </p>
          <div className="facility-filter-list">
            <div className="facility-filter-row">
              <span className="facility-filter-label">
                <span>Camping</span>
              </span>
              <span className="tri-toggle" role="group" aria-label="Camping impact filter">
                <button
                  type="button"
                  className={impactCampingFilterMode === "INCLUDE" ? "is-active include" : ""}
                  onClick={() =>
                    setImpactCampingFilterMode((current) =>
                      current === "INCLUDE" ? "ANY" : "INCLUDE"
                    )
                  }
                  data-testid="impact-filter-camping-include"
                >
                  ✓
                </button>
                <button
                  type="button"
                  className={impactCampingFilterMode === "EXCLUDE" ? "is-active exclude" : ""}
                  onClick={() =>
                    setImpactCampingFilterMode((current) =>
                      current === "EXCLUDE" ? "ANY" : "EXCLUDE"
                    )
                  }
                  data-testid="impact-filter-camping-exclude"
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={impactCampingFilterMode === "ANY" ? "is-active neutral" : ""}
                  onClick={() => setImpactCampingFilterMode("ANY")}
                  data-testid="impact-filter-camping-any"
                >
                  ?
                </button>
              </span>
            </div>
            <div className="facility-filter-row">
              <span className="facility-filter-label">
                <span>2WD/4WD access</span>
              </span>
              <span className="tri-toggle" role="group" aria-label="Access impact filter">
                <button
                  type="button"
                  className={impactAccessFilterMode === "INCLUDE" ? "is-active include" : ""}
                  onClick={() =>
                    setImpactAccessFilterMode((current) =>
                      current === "INCLUDE" ? "ANY" : "INCLUDE"
                    )
                  }
                  data-testid="impact-filter-access-include"
                >
                  ✓
                </button>
                <button
                  type="button"
                  className={impactAccessFilterMode === "EXCLUDE" ? "is-active exclude" : ""}
                  onClick={() =>
                    setImpactAccessFilterMode((current) =>
                      current === "EXCLUDE" ? "ANY" : "EXCLUDE"
                    )
                  }
                  data-testid="impact-filter-access-exclude"
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={impactAccessFilterMode === "ANY" ? "is-active neutral" : ""}
                  onClick={() => setImpactAccessFilterMode("ANY")}
                  data-testid="impact-filter-access-any"
                >
                  ?
                </button>
              </span>
            </div>
          </div>
        </section>

        <section className="filter-section">
          <div className="filter-section-header">
            <h3>
              <a
                className="source-link"
                href={FACILITIES_SOURCE_URL}
                target="_blank"
                rel="noreferrer"
              >
                Facilities
              </a>
            </h3>
            <button type="button" className="text-btn" onClick={clearFacilityModes}>
              Clear
            </button>
          </div>
          {availableFacilities.length ? (
            <ul className="facility-filter-list" data-testid="facility-filter-list">
              {availableFacilities.map((facility) => {
                const mode = facilityFilterModes[facility.key] ?? "ANY";
                return (
                  <li key={facility.key} className="facility-filter-row">
                    <span className="facility-filter-label">
                      <FacilityIcon facility={facility} />
                      <span>{facility.label}</span>
                    </span>
                    <span className="tri-toggle" role="group" aria-label={`${facility.label} filter`}>
                      <button
                        type="button"
                        className={mode === "INCLUDE" ? "is-active include" : ""}
                        onClick={() => toggleFacilityMode(facility.key, "INCLUDE")}
                        aria-label={`Only show forests with ${facility.label.toLowerCase()}`}
                        data-testid={`facility-filter-${facility.key}-include`}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className={mode === "EXCLUDE" ? "is-active exclude" : ""}
                        onClick={() => toggleFacilityMode(facility.key, "EXCLUDE")}
                        aria-label={`Only show forests without ${facility.label.toLowerCase()}`}
                        data-testid={`facility-filter-${facility.key}-exclude`}
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        className={mode === "ANY" ? "is-active neutral" : ""}
                        onClick={() => setSingleFacilityMode(facility.key, "ANY")}
                        aria-label={`${facility.label} does not matter`}
                        data-testid={`facility-filter-${facility.key}-any`}
                      >
                        ?
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Facilities data is unavailable right now.</p>
          )}
        </section>
      </div>
    </aside>
  );
};
