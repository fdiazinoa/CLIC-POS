/**
 * SelfCheckoutLayout
 * 
 * Layout for self-checkout kiosk terminals.
 * Features:
 * - Fullscreen forced
 * - Large touch targets (>60px)
 * - No navigation chrome (no back button, no navbar)
 * - Escape hatch for admin access (logo press 5s OR Ctrl+Alt+A)
 */

import React, { ReactNode, useState, useEffect } from 'react';
import { authLevelService } from '../../services/auth/AuthLevelService';

interface SelfCheckoutLayoutProps {
    children: ReactNode;
    onEscapeHatch?: () => void;
    onTimeout?: () => void;
    timeoutMs?: number;
}

const SelfCheckoutLayout: React.FC<SelfCheckoutLayoutProps> = ({
    children,
    onEscapeHatch,
    onTimeout,
    timeoutMs = 60000 // Default 60 seconds
}) => {
    const [pressTimer, setPressTimer] = useState<number | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const lastActivityRef = React.useRef<number>(Date.now());

    // Inactivity Timer
    useEffect(() => {
        if (!onTimeout) return;

        const checkActivity = () => {
            const now = Date.now();
            if (now - lastActivityRef.current > timeoutMs) {
                console.log('⏱️ Inactivity timeout triggered');
                onTimeout();
            }
        };

        const interval = setInterval(checkActivity, 1000);

        const resetActivity = () => {
            lastActivityRef.current = Date.now();
        };

        // Listen for user activity
        window.addEventListener('mousemove', resetActivity);
        window.addEventListener('mousedown', resetActivity);
        window.addEventListener('touchstart', resetActivity);
        window.addEventListener('keydown', resetActivity);
        window.addEventListener('click', resetActivity);
        window.addEventListener('scroll', resetActivity);

        return () => {
            clearInterval(interval);
            window.removeEventListener('mousemove', resetActivity);
            window.removeEventListener('mousedown', resetActivity);
            window.removeEventListener('touchstart', resetActivity);
            window.removeEventListener('keydown', resetActivity);
            window.removeEventListener('click', resetActivity);
            window.removeEventListener('scroll', resetActivity);
        };
    }, [onTimeout, timeoutMs]);

    // Force fullscreen and setup keyboard shortcut on mount
    useEffect(() => {
        const uiSettings = authLevelService.getUISettings();

        // Enter fullscreen
        const enterFullscreen = async () => {
            try {
                if (document.documentElement.requestFullscreen) {
                    await document.documentElement.requestFullscreen();
                    setIsFullscreen(true);
                }
            } catch (err) {
                console.warn('⚠️ Could not enter fullscreen:', err);
            }
        };

        if (uiSettings.fullscreenForced) {
            enterFullscreen();
        }

        // Keyboard shortcut: Ctrl + Alt + A for admin access
        const handleKeyDown = (e: KeyboardEvent) => {
            // Log all key presses for debugging
            if (e.ctrlKey || e.altKey || e.metaKey) {
                console.log('🔑 Key combo pressed:', {
                    key: e.key,
                    ctrl: e.ctrlKey,
                    alt: e.altKey,
                    meta: e.metaKey,
                    code: e.code
                });
            }

            // Check for Ctrl+Alt+A
            if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔓 Admin keyboard shortcut ACTIVATED!');

                if (onEscapeHatch) {
                    console.log('✅ Calling onEscapeHatch callback');
                    onEscapeHatch();
                } else {
                    console.error('❌ onEscapeHatch callback is undefined!');
                }
            }
        };

        console.log('✅ Keyboard listener registered. Press Ctrl+Alt+A for admin access.');
        document.addEventListener('keydown', handleKeyDown, true); // Use capture phase

        // Exit fullscreen on unmount
        return () => {
            console.log('🧹 Removing keyboard listener');
            document.removeEventListener('keydown', handleKeyDown, true);
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(err =>
                    console.warn('Could not exit fullscreen:', err)
                );
            }
        };
    }, [onEscapeHatch]);

    // Escape hatch handler (logo press 5s)
    const handleLogoPress = () => {
        const uiSettings = authLevelService.getUISettings();
        if (!uiSettings.escapeHatchEnabled) return;

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
            className="self-checkout-layout"
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                backgroundColor: '#f8f9fa',
                position: 'relative'
            }}
        >
            {/* Escape Hatch Logo (VISIBLE NOW) */}
            <button
                onClick={() => {
                    // Simple click for easier access
                    if (onEscapeHatch) onEscapeHatch();
                }}
                style={{
                    position: 'absolute',
                    top: 20,
                    left: 20,
                    width: 60,
                    height: 60,
                    zIndex: 9999,
                    cursor: 'pointer',
                    opacity: 0.8, // Visible
                    border: 'none',
                    background: 'transparent',
                    outline: 'none'
                }}
                title="Click para acceso Admin"
            >
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        backgroundColor: '#333',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                    }}
                >
                    🔒
                </div>
            </button>

            {/* Keyboard shortcut hint (dev mode) */}
            {process.env.NODE_ENV === 'development' && (
                <div
                    style={{
                        position: 'absolute',
                        top: 90,
                        left: 20,
                        padding: '8px 12px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        color: 'white',
                        borderRadius: 8,
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        zIndex: 9998
                    }}
                >
                    💡 Ctrl+Alt+A = Admin
                </div>
            )}

            {/* Main content area */}
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px', // Larger base font for readability
                    touchAction: 'manipulation', // Disable double-tap zoom
                    userSelect: 'none' // Prevent text selection
                }}
            >
                {children}
            </div>

            {/* Fullscreen indicator */}
            {!isFullscreen && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: 10,
                        right: 10,
                        padding: '8px 12px',
                        backgroundColor: 'rgba(255, 165, 0, 0.9)',
                        color: 'white',
                        borderRadius: 4,
                        fontSize: '12px',
                        zIndex: 9998
                    }}
                >
                    ⚠️ Presiona F11 para pantalla completa
                </div>
            )}
        </div>
    );
};

export default SelfCheckoutLayout;
