import type { FireBanForestTableProps } from "./WarningsTypes";

export const FireBanForestTableDialog = ({
  fireBanForestTableOpen,
  closeFireBanForestTable,
  fireBanPageForests,
  sortedFireBanPageForests,
  fireBanForestSortColumn,
  fireBanForestTableSortLabel,
  toggleFireBanForestSort
}: FireBanForestTableProps) => {
  if (!fireBanForestTableOpen) {
    return null;
  }

  return (
    <div
      className="warnings-overlay fire-ban-forest-table-overlay"
      data-testid="fire-ban-forest-table-overlay"
      role="presentation"
      onClick={closeFireBanForestTable}
    >
      <section
        className="panel warnings-dialog fire-ban-forest-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fire-ban-forest-table-title"
        data-testid="fire-ban-forest-table-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="warnings-dialog-header">
          <h2 id="fire-ban-forest-table-title">
            Solid Fuel Fire Ban Forests ({fireBanPageForests.length})
          </h2>
          <button type="button" onClick={closeFireBanForestTable}>
            Close
          </button>
        </div>
        <p className="muted fire-ban-forest-table-hint">
          Sort columns alphabetically by clicking the table headers.
        </p>
        <div className="fire-ban-forest-table-wrap">
          <table className="fire-ban-forest-table" data-testid="fire-ban-forest-table">
            <thead>
              <tr>
                <th scope="col">
                  <button
                    type="button"
                    className={`fire-ban-forest-sort-btn ${fireBanForestSortColumn === "forestName" ? "is-active" : ""}`}
                    data-testid="fire-ban-forest-table-forest-sort"
                    onClick={() => toggleFireBanForestSort("forestName")}
                  >
                    Forest name{" "}
                    {fireBanForestSortColumn === "forestName"
                      ? `(${fireBanForestTableSortLabel})`
                      : ""}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className={`fire-ban-forest-sort-btn ${fireBanForestSortColumn === "areaName" ? "is-active" : ""}`}
                    data-testid="fire-ban-forest-table-region-sort"
                    onClick={() => toggleFireBanForestSort("areaName")}
                  >
                    Region name{" "}
                    {fireBanForestSortColumn === "areaName"
                      ? `(${fireBanForestTableSortLabel})`
                      : ""}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedFireBanPageForests.length > 0 ? (
                sortedFireBanPageForests.map((forest) => (
                  <tr key={`${forest.id}:fire-ban-table`} data-testid="fire-ban-forest-table-row">
                    <td>{forest.forestName}</td>
                    <td>{forest.areaName}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>No forests are currently available from Solid Fuel Fire Ban pages.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
