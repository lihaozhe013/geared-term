import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import './PanelExpandHandle.css';

export type PanelExpandHandleProps = {
  side: 'left' | 'right';
  label: string;
  onExpand: () => void;
};

export function PanelExpandHandle({
  side,
  label,
  onExpand
}: PanelExpandHandleProps): React.JSX.Element {
  const Icon = side === 'left' ? PanelLeftOpen : PanelRightOpen;

  return (
    <button
      type="button"
      className={`panel-expand-handle panel-expand-handle-${side}`}
      onClick={onExpand}
      aria-label={label}
      title={label}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
