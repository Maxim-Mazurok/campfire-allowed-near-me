import { Fragment } from "react";
import type { WarningSectionProps } from "./WarningsTypes";

export const WarningsSections = ({
  hasUnmappedForestWarning,
  unmappedForests,
  getUnmappedForestLink,
  hasUnknownTotalFireBanWarning,
  forestsWithUnknownTotalFireBan,
  buildTotalFireBanDetailsUrl,
  generalWarnings,
  hasFacilitiesMismatchWarning,
  matchDiagnostics,
  facilitiesMismatchWarningSummary,
  renderFacilitiesMismatchWarningSummary,
  openFireBanForestTable,
  buildFacilitiesForestUrl,
  hasFuzzyMatchesWarning,
  fuzzyMatchesWarningText,
  getFireBanAreaUrl,
  closureDiagnostics
}: WarningSectionProps) => (
  <>
    {hasUnmappedForestWarning ? (
      <details
        className="warnings-section warnings-section-collapsible"
        data-testid="warnings-unmapped-section"
        open
      >
        <summary className="warnings-section-summary">
          Unmapped Forests (Distance Unavailable)
        </summary>
        <p className="muted">
          {unmappedForests.length} forest(s) could not be mapped to coordinates.
        </p>
        <ul className="warning-list warning-list-detailed">
          {unmappedForests.map((forest) => {
            const debugEntries =
              forest.geocodeDiagnostics?.debug?.length
                ? forest.geocodeDiagnostics.debug
                : ["No geocoding attempt diagnostics were captured in this snapshot."];
            const failureReason =
              forest.geocodeDiagnostics?.reason ??
              "Coordinates were unavailable after forest and area geocoding.";
            const linkTarget = getUnmappedForestLink(forest);

            return (
              <li key={forest.id} className="warning-list-item-detailed">
                <div>
                  <a href={linkTarget.href} target="_blank" rel="noopener noreferrer">
                    <mark className="warning-forest-highlight">{forest.forestName}</mark>
                  </a>{" "}
                  <span className="muted">({linkTarget.label})</span>
                </div>
                <div className="muted">Reason: {failureReason}</div>
                <details className="warning-debug">
                  <summary>Debug info</summary>
                  <ul className="warning-debug-list">
                    {debugEntries.map((entry, index) => (
                      <li key={`${forest.id}:debug:${index}`}>{entry}</li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      </details>
    ) : null}

    {hasUnknownTotalFireBanWarning ? (
      <details
        className="warnings-section warnings-section-collapsible"
        data-testid="warnings-total-fire-ban-unknown-section"
        open
      >
        <summary className="warnings-section-summary">
          Total Fire Ban Status Unknown
        </summary>
        <p className="muted">
          {forestsWithUnknownTotalFireBan.length} forest(s) have unknown Total Fire Ban status.
        </p>
        <ul className="warning-list warning-list-detailed">
          {forestsWithUnknownTotalFireBan.map((forest) => {
            const debugEntries =
              forest.totalFireBanDiagnostics?.debug?.length
                ? forest.totalFireBanDiagnostics.debug
                : ["No Total Fire Ban diagnostics were captured in this snapshot."];
            const failureReason =
              forest.totalFireBanDiagnostics?.reason ??
              "Total Fire Ban status could not be determined from available source data.";

            return (
              <li key={`${forest.id}:total-fire-ban-unknown`} className="warning-list-item-detailed">
                <div>
                  <a
                    href={buildTotalFireBanDetailsUrl(forest)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <mark className="warning-forest-highlight">{forest.forestName}</mark>
                  </a>{" "}
                  <span className="muted">(RFS Total Fire Ban details)</span>
                </div>
                <div className="muted">Reason: {failureReason}</div>
                <details className="warning-debug">
                  <summary>Debug info</summary>
                  <ul className="warning-debug-list">
                    {debugEntries.map((entry, index) => (
                      <li key={`${forest.id}:total-fire-ban-debug:${index}`}>{entry}</li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      </details>
    ) : null}

    {generalWarnings.length > 0 ? (
      <details className="warnings-section warnings-section-collapsible" open>
        <summary className="warnings-section-summary">General</summary>
        <ul className="warning-list">
          {generalWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </details>
    ) : null}

    {hasFacilitiesMismatchWarning || matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
      <details className="warnings-section warnings-section-collapsible" open>
        <summary className="warnings-section-summary">
          Facilities Missing From Solid Fuel Fire Ban Pages
        </summary>
        <p className="muted">
          {renderFacilitiesMismatchWarningSummary(facilitiesMismatchWarningSummary)}
          {" "}
          <button
            type="button"
            className="text-btn"
            onClick={openFireBanForestTable}
            data-testid="open-fire-ban-forest-table-btn"
          >
            (see full list)
          </button>
        </p>
        {matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
          <ul className="warning-list">
            {matchDiagnostics.unmatchedFacilitiesForests.map((forestName) => (
              <li key={forestName}>
                <a
                  href={buildFacilitiesForestUrl(forestName)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {forestName}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    ) : null}

    {hasFuzzyMatchesWarning || matchDiagnostics.fuzzyMatches.length > 0 ? (
      <details className="warnings-section warnings-section-collapsible" open>
        <summary className="warnings-section-summary">Fuzzy Facilities Matching</summary>
        <p className="muted">{fuzzyMatchesWarningText}</p>
        {matchDiagnostics.fuzzyMatches.length > 0 ? (
          <ul className="warning-list">
            {matchDiagnostics.fuzzyMatches.map((match) => (
              <li key={`${match.facilitiesForestName}:${match.fireBanForestName}`}>
                Facilities:{" "}
                <a
                  href={buildFacilitiesForestUrl(match.facilitiesForestName)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {match.facilitiesForestName}
                </a>{" "}
                {"->"} Fire ban:{" "}
                <a
                  href={getFireBanAreaUrl(match.fireBanForestName)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {match.fireBanForestName}
                </a>{" "}
                ({match.score.toFixed(2)})
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    ) : null}

    {closureDiagnostics.unmatchedNotices.length > 0 ? (
      <details className="warnings-section warnings-section-collapsible" open>
        <summary className="warnings-section-summary">Unmatched Closure Notices</summary>
        <p className="muted">
          {closureDiagnostics.unmatchedNotices.length} closure notice(s) could not be matched to forests.
        </p>
        <ul className="warning-list">
          {closureDiagnostics.unmatchedNotices.map((notice) => (
            <li key={`unmatched-closure:${notice.id}`}>
              <a href={notice.detailUrl} target="_blank" rel="noopener noreferrer">
                {notice.title}
              </a>
            </li>
          ))}
        </ul>
      </details>
    ) : null}
  </>
);
