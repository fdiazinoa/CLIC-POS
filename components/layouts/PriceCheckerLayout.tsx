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
    const [isActive, setIsActive] = useState<boolean>(false);

    // Monitor fullscreen state
    // Monitor fullscreen state (Optional sync)
    useEffect(() => {
        const handleFullscreenChange = () => {
            // Only sync if we are ALREADY active. 
            // If user manually exits fullscreen (Esc), we might want to stay active or reset?
            // Current behavior: If they exit full screen, we let them stay active. 
            // We only care about ensuring it STARTS.
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const handleStart = async () => {
        try {
            if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            }
        } catch (err) {
            console.warn('⚠️ Could not enter fullscreen (ignoring):', err);
        } finally {
            // Always activate UI, even if fullscreen fails
            setIsActive(true);
        }
    };

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

    if (!isActive) {
        return (
            <div
                onClick={handleStart}
                onTouchEnd={handleStart}
                style={{
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: '#000',
                    color: '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    zIndex: 99999
                }}
            >
                <div style={{ fontSize: '64px', marginBottom: '20px' }}>👆</div>
                <div style={{ fontSize: '32px', fontWeight: 'bold' }}>Toca para Iniciar</div>
                <div style={{ fontSize: '18px', marginTop: '10px', opacity: 0.7 }}>Modo Pantalla Completa Requerido</div>
            </div>
        );
    }

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
