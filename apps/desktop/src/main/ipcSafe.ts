import { ipcMain } from 'electron';

/**
 * A one-way message handler (`ipcMain.on`) has no caller to send an error back to, so an exception in it ends in a blocking
 * "A JavaScript error occurred in the main process" dialog. A page that sends a malformed message could therefore stop the
 * whole app. This wraps the handler: the error is logged and the app carries on. (`ipcMain.handle` handlers are already
 * safe: an exception becomes a rejection in the page.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function onSafe(channel: string, handler: (e: Electron.IpcMainEvent, ...args: any[]) => void) {
  ipcMain.on(channel, (e, ...args) => {
    try { handler(e, ...args); } catch (err) { console.error(`Ignored a bad "${channel}" message:`, err instanceof Error ? err.message : err); }
  });
}
