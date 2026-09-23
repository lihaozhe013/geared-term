import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { TerminalSnapshotDraftWindow } from './terminal-snapshot/TerminalSnapshotDraftWindow';

createRoot(document.getElementById('root')!).render(<TerminalSnapshotDraftWindow />);
