import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close';

export function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Subscribe first, then read the current state, so a maximize transition
    // between the two calls cannot be missed.
    const unsubscribe = window.geared.onWindowMaximizeChanged(setMaximized);
    void window.geared
      .isWindowMaximized()
      .then(setMaximized)
      .catch(() => undefined);
    return unsubscribe;
  }, []);

  const control = (action: WindowControlAction): void => {
    void window.geared.windowControl(action).catch(() => undefined);
  };

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => control('minimize')}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => control('toggle-maximize')}
      >
        {maximized ? (
          <Copy size={12} aria-hidden="true" />
        ) : (
          <Square size={12} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        aria-label="Close"
        title="Close"
        onClick={() => control('close')}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
