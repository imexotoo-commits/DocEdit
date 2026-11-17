import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css'; // text-layer rules from pdf.js (Apache-2.0)
import './styles.css';
import { App } from './App.js';
import { AskProvider } from './ConfirmCard.js';

createRoot(document.getElementById('root')!).render(<StrictMode><AskProvider><App /></AskProvider></StrictMode>);
