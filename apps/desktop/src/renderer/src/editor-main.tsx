import { createRoot } from 'react-dom/client';
import { RemoteEditorWindow } from './remote-editor/RemoteEditorWindow';
import './styles.css';

createRoot(document.getElementById('root')!).render(<RemoteEditorWindow />);
