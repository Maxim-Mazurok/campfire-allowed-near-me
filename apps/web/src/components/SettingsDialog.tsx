interface SettingsDialogProperties {
  isOpen: boolean;
  avoidTolls: boolean;
  onClose: () => void;
  setAvoidTolls: (value: boolean) => void;
}

export const SettingsDialog = ({
  isOpen,
  avoidTolls,
  onClose,
  setAvoidTolls
}: SettingsDialogProperties) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="warnings-overlay settings-overlay"
      data-testid="settings-overlay"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="panel settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="warnings-dialog-header">
          <h2 id="settings-title">Route Settings</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">
          Driving estimates use Google Routes traffic for the next Saturday at 10:00 AM
          (calculated at request time).
        </p>
        <fieldset className="settings-options">
          <legend>Toll roads</legend>
          <label className="settings-option">
            <input
              type="radio"
              name="toll-setting"
              checked={avoidTolls}
              onChange={() => setAvoidTolls(true)}
              data-testid="settings-tolls-avoid"
            />
            <span>No tolls (default)</span>
          </label>
          <label className="settings-option">
            <input
              type="radio"
              name="toll-setting"
              checked={!avoidTolls}
              onChange={() => setAvoidTolls(false)}
              data-testid="settings-tolls-allow"
            />
            <span>Allow toll roads</span>
          </label>
        </fieldset>
      </section>
    </div>
  );
};
