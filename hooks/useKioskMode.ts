import { useEffect } from 'react';

/**
 * Hook to enforce Kiosk Mode (Fullscreen).
 * Attempts to request fullscreen on mount and re-enters if exited involuntarily.
 */
export const useKioskMode = (enabled: boolean = true) => {
    useEffect(() => {
        if (!enabled) return;

        const enterFullscreen = async () => {
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                }
            } catch (err) {
                console.warn("Fullscreen request denied/failed:", err);
            }
        };

        // Attempt on mount
        enterFullscreen();

        // Listen for changes
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                console.log("Exited fullscreen. Attempting to re-enter...");
                // Small timeout to prevent aggressive loops if user intentionally exited
                setTimeout(enterFullscreen, 1000);
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [enabled]);
};
