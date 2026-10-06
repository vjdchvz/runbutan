import { requireNativeModule } from 'expo-modules-core';

export type RunAction = 'toggle' | 'stop';
type Native = {
  requestDuck(): boolean;
  abandonDuck(): void;
  showRunNotification(title: string, text: string, paused: boolean, stopArmed: boolean): void;
  cancelRunNotification(): void;
  saveToDownloads(name: string, content: string, mime: string): Promise<string>;
  addListener(event: 'onAction', cb: (e: { action: RunAction }) => void): { remove(): void };
};

// Missing native module (e.g. an older install) must never break the app: everything becomes a no-op.
let native: Native | null = null;
try {
  native = requireNativeModule<Native>('RunKit');
} catch {
  native = null;
}

export const requestDuck = () => {
  try {
    return native?.requestDuck() ?? false;
  } catch {
    return false;
  }
};
export const abandonDuck = () => {
  try {
    native?.abandonDuck();
  } catch {
    // ignore
  }
};
export const showRunNotification = (title: string, text: string, paused: boolean, stopArmed: boolean) => {
  try {
    native?.showRunNotification(title, text, paused, stopArmed);
  } catch {
    // ignore
  }
};
export const cancelRunNotification = () => {
  try {
    native?.cancelRunNotification();
  } catch {
    // ignore
  }
};
// Saves a text file to the public Downloads folder; resolves with the final file name. Rejects if unsupported.
export const saveToDownloads = (name: string, content: string, mime: string): Promise<string> => {
  if (!native) return Promise.reject(new Error('Saving files is not available in this build'));
  return native.saveToDownloads(name, content, mime);
};
export const onRunAction = (cb: (a: RunAction) => void) => {
  try {
    const sub = native?.addListener('onAction', (e) => cb(e.action));
    return () => sub?.remove();
  } catch {
    return () => {};
  }
};
