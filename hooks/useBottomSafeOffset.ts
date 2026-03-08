import { RefObject, useEffect } from 'react';

interface UseBottomSafeOffsetOptions {
  rootRef: RefObject<HTMLElement | null>;
  overlayRefs: Array<RefObject<HTMLElement | null>>;
  extraOffset?: number;
  dependencyKey?: string;
}

const isVisible = (element: HTMLElement) => {
  const rects = element.getClientRects();
  if (rects.length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

export const useBottomSafeOffset = ({
  rootRef,
  overlayRefs,
  extraOffset = 12,
  dependencyKey = '',
}: UseBottomSafeOffsetOptions) => {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === 'undefined') return;

    let frameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const applyMeasurements = () => {
      frameId = null;

      const visualViewport = window.visualViewport;
      const visibleHeight = Math.round(visualViewport?.height ?? window.innerHeight);
      const viewportBottomInset = Math.max(
        0,
        Math.round(
          window.innerHeight - ((visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0))
        )
      );

      let maxOverlayHeight = 0;
      let maxOverlayFootprint = 0;

      overlayRefs.forEach((overlayRef) => {
        const element = overlayRef.current;
        if (!element || !isVisible(element)) return;

        const rect = element.getBoundingClientRect();
        maxOverlayHeight = Math.max(maxOverlayHeight, Math.ceil(rect.height));
        maxOverlayFootprint = Math.max(
          maxOverlayFootprint,
          Math.max(0, Math.ceil(visibleHeight - rect.top))
        );
      });

      root.style.setProperty('--bottom-bar-height', `${maxOverlayHeight}px`);
      root.style.setProperty('--bottom-safe-offset', `${maxOverlayFootprint + extraOffset}px`);
      root.style.setProperty('--viewport-bottom-inset', `${viewportBottomInset}px`);
      root.style.setProperty('--pos-viewport-height', `${visibleHeight}px`);
    };

    const scheduleMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(applyMeasurements);
    };

    scheduleMeasure();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      overlayRefs.forEach((overlayRef) => {
        if (overlayRef.current) {
          resizeObserver?.observe(overlayRef.current);
        }
      });
    }

    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('orientationchange', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('scroll', scheduleMeasure);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('orientationchange', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('scroll', scheduleMeasure);
      root.style.removeProperty('--bottom-bar-height');
      root.style.removeProperty('--bottom-safe-offset');
      root.style.removeProperty('--viewport-bottom-inset');
      root.style.removeProperty('--pos-viewport-height');
    };
  }, [rootRef, overlayRefs, extraOffset, dependencyKey]);
};
