import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import '@xterm/xterm/css/xterm.css';
import 'highlight.js/styles/a11y-dark.min.css';

createRoot(document.getElementById('root')!).render(<App />);
