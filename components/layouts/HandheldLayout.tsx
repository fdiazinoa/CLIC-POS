/**
 * HandheldLayout
 * 
 * Layout for handheld inventory terminals (mobile devices).
 * Features:
 * - Vertical layout optimized for mobile/tablet
 * - No top navbar (uses hamburger menu)
 * - No sales footer
 * - Touch-friendly spacing
 * - Compact header with menu
 */

import React, { ReactNode, useState } from 'react';
import { Menu, X, Settings as SettingsIcon } from 'lucide-react';

interface HandheldLayoutProps {
    children: ReactNode;
    onNavigate?: (view: string) => void;
    currentModule?: string;
}

const HandheldLayout: React.FC<HandheldLayoutProps> = ({
    children,
    onNavigate,
    currentModule
}) => {
    const [menuOpen, setMenuOpen] = useState(false);

    const menuItems = [
        { id: 'INVENTORY_HOME', label: 'Inicio', icon: '🏠' },
        { id: 'INVENTORY_COUNT', label: 'Conteo', icon: '🔢' },
        { id: 'INVENTORY_RECEPTION', label: 'Recepción', icon: '📦' },
        { id: 'INVENTORY_LABELS', label: 'Etiquetas', icon: '🏷️' },
        { id: 'SETTINGS_SYNC', label: 'Ajustes', icon: '⚙️' }
    ];

    return (
        <div
            className="handheld-layout"
            style={{
                width: '100%',
                minHeight: '100vh',
                backgroundColor: '#f5f5f5',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
            }}
        >
            {/* Compact Header */}
            <header
                style={{
                    backgroundColor: '#2563eb',
                    color: 'white',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 100
                }}
            >
                <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '48px',
                        minHeight: '48px',
                        borderRadius: '4px'
                    }}
                    aria-label="Menú"
                >
                    {menuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>

                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                    📱 Inventario Móvil
                </div>

                <button
                    onClick={() => onNavigate?.('SETTINGS_SYNC')}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '48px',
                        minHeight: '48px',
                        borderRadius: '4px'
                    }}
                    aria-label="Ajustes"
                >
                    <SettingsIcon size={24} />
                </button>
            </header>

            {/* Slide-out Menu */}
            {menuOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={() => setMenuOpen(false)}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            zIndex: 200
                        }}
                    />

                    {/* Menu Panel */}
                    <nav
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            bottom: 0,
                            width: '280px',
                            backgroundColor: 'white',
                            boxShadow: '2px 0 8px rgba(0,0,0,0.15)',
                            zIndex: 300,
                            display: 'flex',
                            flexDirection: 'column',
                            overflowY: 'auto'
                        }}
                    >
                        {/* Menu Header */}
                        <div
                            style={{
                                padding: '20px',
                                backgroundColor: '#2563eb',
                                color: 'white',
                                fontSize: '20px',
                                fontWeight: 'bold'
                            }}
                        >
                            📱 Menú
                        </div>

                        {/* Menu Items */}
                        <div style={{ flex: 1 }}>
                            {menuItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        onNavigate?.(item.id);
                                        setMenuOpen(false);
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '16px 20px',
                                        border: 'none',
                                        backgroundColor: currentModule === item.id ? '#e0e7ff' : 'transparent',
                                        color: currentModule === item.id ? '#2563eb' : '#333',
                                        fontSize: '16px',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        minHeight: '60px',
                                        borderBottom: '1px solid #e5e7eb'
                                    }}
                                >
                                    <span style={{ fontSize: '24px' }}>{item.icon}</span>
                                    <span style={{ fontWeight: currentModule === item.id ? 'bold' : 'normal' }}>
                                        {item.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </nav>
                </>
            )}

            {/* Main Content Area */}
            <main
                style={{
                    flex: 1,
                    padding: '16px',
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch'
                }}
            >
                {children}
            </main>
        </div>
    );
};

export default HandheldLayout;
