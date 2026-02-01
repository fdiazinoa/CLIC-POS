/**
 * PriceCheckerLayout
 * 
 * Layout for price checker terminals.
 * Features:
 * - Fullscreen minimal interface
 * - Passive display (no active user controls)
 * - Loop: Scan → Display → Auto-reset
 * - Large, readable text for customer viewing
 */

import React, { ReactNode, useEffect, useState } from 'react';
import { authLevelService } from '../../services/auth/AuthLevelService';

interface PriceCheckerLayoutProps {
    children: ReactNode;
    onEscapeHatch?: () => void;
}

const PriceCheckerLayout: React.FC<PriceCheckerLayoutProps> = ({
    children,
    onEscapeHatch
}) => {
    const [pressTimer, setPressTimer] = useState<number | null>(null);

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
            className="price-checker-layout"
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                backgroundColor: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                userSelect: 'none'
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
                        backgroundColor: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px'
                    }}
                >
                    🔍
                </div>
            </div>

            {/* Header Brand */}
            <div
                style={{
                    position: 'absolute',
                    top: 30,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    color: '#333'
                }}
            >
                🔍 Verificador de Precios
            </div>

            {/* Main Content */}
            <div
                style={{
                    width: '90%',
                    maxWidth: '800px',
                    textAlign: 'center',
                    fontSize: '24px'
                }}
            >
                {children}
            </div>

            {/* Footer Instruction */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 40,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '20px',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}
            >
                <span style={{ fontSize: '32px' }}>📷</span>
                <span>Escanea el código de barras del producto</span>
            </div>
        </div>
    );
};

export default PriceCheckerLayout;
