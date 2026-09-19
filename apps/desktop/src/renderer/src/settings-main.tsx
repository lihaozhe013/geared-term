import { createRoot } from 'react-dom/client';
import { SettingsWindow } from './settings/SettingsWindow';
import './styles.css';

createRoot(document.getElementById('root')!).render(<SettingsWindow />);
