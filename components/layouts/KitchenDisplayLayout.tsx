/**
 * KitchenDisplayLayout
 * 
 * Layout for kitchen display system (KDS) terminals.
 * Features:
 * - Fullscreen order display
 * - Real-time updates
 * - Large, readable cards
 * - Status-based color coding
 * - Minimal chrome (optional for V1)
 */

import React, { ReactNode, useEffect, useState } from 'react';

interface KitchenDisplayLayoutProps {
    children: ReactNode;
    onEscapeHatch?: () => void;
}

const KitchenDisplayLayout: React.FC<KitchenDisplayLayoutProps> = ({
    children,
    onEscapeHatch
}) => {
    const [pressTimer, setPressTimer] = useState<number | null>(null);

    useEffect(() => {
        const enterFullscreen = async () => {
            try {
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                }
            } catch (err) {
                console.warn('⚠️ Could not enter fullscreen:', err);
            }
        };

        enterFullscreen();

        return () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => { });
            }
        };
    }, []);

    // Escape hatch
    const handleLogoPress = () => {
        const timer = window.setTimeout(() => {
            onEscapeHatch?.();
        }, 5000);
        setPressTimer(timer);
    };

    const handleLogoRelease = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            setPressTimer(null);
        }
    };

    return (
        <div
            className="kitchen-display-layout"
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                backgroundColor: '#1f2937',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                color: 'white'
            }}
        >
            {/* Escape Hatch */}
            <div
                onMouseDown={handleLogoPress}
                onMouseUp={handleLogoRelease}
                onTouchStart={handleLogoPress}
                onTouchEnd={handleLogoRelease}
                style={{
                    position: 'absolute',
                    top: 20,
                    left: 20,
                    width: 60,
                    height: 60,
                    zIndex: 9999,
                    opacity: pressTimer ? 0.3 : 0
                }}
            >
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        backgroundColor: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px'
                    }}
                >
                    👨‍🍳
                </div>
            </div>

            {/* Main Content - Orders Grid */}
            <main
                style={{
                    flex: 1,
                    padding: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden'
                }}
            >
                {children}
            </main>
        </div>
    );
};

export default KitchenDisplayLayout;
