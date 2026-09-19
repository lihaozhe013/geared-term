import { createRoot } from 'react-dom/client';
import { HistoryWindow } from './history/HistoryWindow';
import './styles.css';

createRoot(document.getElementById('root')!).render(<HistoryWindow />);
