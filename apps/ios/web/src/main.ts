// Install window.docedit first, then start the desktop renderer unchanged.
import { emitMenu, installBridge } from './bridge.js';
import { hasNative, native } from './native.js';
import './ios.css';

installBridge();
// Tell Swift the bridge exists: files the system hands the app at launch wait for this.
if (hasNative()) void native('bridgeReady').catch(() => {});
document.documentElement.classList.add('ios');
await import('../../../desktop/src/renderer/main.js');

// Pinch to zoom the document: WebKit sends gesture events with a running scale; each time it passes a threshold,
// step the viewer's zoom (the same command as the toolbar's + and -) and measure from there.
let base = 1;
document.addEventListener('gesturestart', (e) => { e.preventDefault(); base = 1; });
document.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  const scale = (e as unknown as { scale: number }).scale / base;
  if (scale > 1.25) { emitMenu('zoom-in'); base = (e as unknown as { scale: number }).scale; }
  else if (scale < 0.8) { emitMenu('zoom-out'); base = (e as unknown as { scale: number }).scale; }
});
document.addEventListener('gestureend', (e) => e.preventDefault());
