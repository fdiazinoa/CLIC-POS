import {
  getOperatorUiTransitionSnapshot,
  waitForOperatorUiTransition,
} from './operatorUiTransition';
import { isPosSaleActive, waitForPosSaleIdle } from './posSaleActivity';

const yieldToBrowserIdle = (): Promise<void> => new Promise((resolve) => {
  if (typeof window === 'undefined') {
    globalThis.setTimeout(resolve, 0);
    return;
  }

  const requestIdleCallback = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => resolve(), { timeout: 500 });
    return;
  }

  window.setTimeout(resolve, 16);
});

/**
 * Shared gate for background downloads, local applies and operational uploads.
 * Network work may be cheap, but parsing/applying a response and persisting an
 * outbox item can monopolize the WebView main thread. Every automatic path must
 * therefore wait until the current operator gesture and POS transition finish,
 * then enter through an idle browser task.
 */
export const waitForBackgroundSyncWindow = async (): Promise<boolean> => {
  let deferred = false;

  while (true) {
    if (getOperatorUiTransitionSnapshot().active) deferred = true;
    deferred = (await waitForOperatorUiTransition()) || deferred;

    if (isPosSaleActive()) {
      deferred = true;
      await waitForPosSaleIdle();
      continue;
    }

    await yieldToBrowserIdle();

    if (!getOperatorUiTransitionSnapshot().active && !isPosSaleActive()) {
      return deferred;
    }
    deferred = true;
  }
};

/** Yield between sync chunks so input, navigation and a paint can run first. */
export const yieldBackgroundSyncChunk = async (): Promise<void> => {
  await waitForBackgroundSyncWindow();
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
};
