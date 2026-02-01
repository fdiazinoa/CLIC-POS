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
    const [currentTime, setCurrentTime] = useState(new Date());

    // Update clock every second
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    // Force fullscreen
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

            {/* Header */}
            <header
                style={{
                    backgroundColor: '#374151',
                    padding: '16px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '2px solid #4b5563'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '32px' }}>👨‍🍳</span>
                    <div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
                            Display de Cocina
                        </div>
                        <div style={{ fontSize: '14px', color: '#9ca3af' }}>
                            Órdenes en Tiempo Real
                        </div>
                    </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
                        {currentTime.toLocaleTimeString('es-DO', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </div>
                    <div style={{ fontSize: '14px', color: '#9ca3af' }}>
                        {currentTime.toLocaleDateString('es-DO', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long'
                        })}
                    </div>
                </div>
            </header>

            {/* Main Content - Orders Grid */}
            <main
                style={{
                    flex: 1,
                    padding: '24px',
                    overflowY: 'auto',
                    overflowX: 'hidden'
                }}
            >
                {children}
            </main>

            {/* Footer Status Bar */}
            <footer
                style={{
                    backgroundColor: '#374151',
                    padding: '12px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderTop: '2px solid #4b5563',
                    fontSize: '14px',
                    color: '#9ca3af'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: '#ef4444'
                        }} />
                        <span>Pendiente</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: '#f59e0b'
                        }} />
                        <span>En Preparación</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: '#10b981'
                        }} />
                        <span>Listo</span>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default KitchenDisplayLayout;
