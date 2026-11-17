import { contextBridge, ipcRenderer } from 'electron';

// The prompt window's whole API: read its question, report its height, answer.
contextBridge.exposeInMainWorld('oakPrompt', {
  options: () => ipcRenderer.invoke('docedit:prompt-options'),
  ready: (height: number) => ipcRenderer.send('docedit:prompt-ready', height),
  answer: (a: string) => ipcRenderer.send('docedit:prompt-answer', a),
});
