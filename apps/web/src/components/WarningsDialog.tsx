import { FireBanForestTableDialog } from "./warnings/FireBanForestTableDialog";
import { WarningsSections } from "./warnings/WarningsSections";
import type { FireBanForestTableProps, WarningSectionProps } from "./warnings/WarningsTypes";

interface WarningsDialogProperties {
  isOpen: boolean;
  warningCount: number;
  closeWarningsDialog: () => void;
  warningSections: WarningSectionProps;
  fireBanForestTable: FireBanForestTableProps;
}

export const WarningsDialog = ({
  isOpen,
  warningCount,
  closeWarningsDialog,
  warningSections,
  fireBanForestTable
}: WarningsDialogProperties) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="warnings-overlay"
        data-testid="warnings-overlay"
        role="presentation"
        onClick={closeWarningsDialog}
      >
        <section
          className="panel warnings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="warnings-title"
          data-testid="warnings-dialog"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="warnings-dialog-header">
            <h2 id="warnings-title">Warnings ({warningCount})</h2>
            <button type="button" onClick={closeWarningsDialog}>
              Close
            </button>
          </div>

          {warningCount === 0 ? <p className="muted">No warnings right now.</p> : null}

          <WarningsSections {...warningSections} />
        </section>
      </div>
      <FireBanForestTableDialog {...fireBanForestTable} />
    </>
  );
};
