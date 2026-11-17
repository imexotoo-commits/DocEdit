import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css'; // text-layer rules from pdf.js (Apache-2.0)
import '../../desktop/src/renderer/styles.css';
import './viewer.css';
import { ViewerApp } from './ViewerApp.js';

createRoot(document.getElementById('root')!).render(<StrictMode><ViewerApp /></StrictMode>);
