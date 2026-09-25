import { useState, useEffect } from 'react';

export const isMobileViewport = (
    width: number,
    height: number,
    breakpoint: number,
    portraitOrderTaker = false,
): boolean => width < breakpoint || (portraitOrderTaker && height > width);

export const useIsMobile = (breakpoint: number = 768, portraitOrderTaker = false): boolean => {
    const [isMobile, setIsMobile] = useState<boolean>(() => typeof window !== 'undefined'
        && isMobileViewport(window.innerWidth, window.innerHeight, breakpoint, portraitOrderTaker));

    useEffect(() => {
        const checkIsMobile = () => {
            setIsMobile(isMobileViewport(window.innerWidth, window.innerHeight, breakpoint, portraitOrderTaker));
        };

        // Initial check
        checkIsMobile();

        // Listener
        window.addEventListener('resize', checkIsMobile);
        window.addEventListener('orientationchange', checkIsMobile);

        return () => {
            window.removeEventListener('resize', checkIsMobile);
            window.removeEventListener('orientationchange', checkIsMobile);
        };
    }, [breakpoint, portraitOrderTaker]);

    return isMobile;
};
