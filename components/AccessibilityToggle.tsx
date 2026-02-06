import React from 'react';
import { Eye, Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeContext';

interface AccessibilityToggleProps {
    className?: string;
    showLabel?: boolean;
}

const AccessibilityToggle: React.FC<AccessibilityToggleProps> = ({ className = '', showLabel = true }) => {
    const { isHighContrast, toggleHighContrast } = useTheme();

    return (
        <button
            onClick={toggleHighContrast}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all border ${isHighContrast
                    ? 'bg-black text-white border-white hover:bg-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                } ${className}`}
            title={isHighContrast ? "Desactivar Alto Contraste" : "Activar Alto Contraste"}
        >
            {isHighContrast ? <Eye size={18} /> : <Eye size={18} />}
            {showLabel && (
                <span className="text-sm font-bold">
                    {isHighContrast ? 'Modo Normal' : 'Alto Contraste'}
                </span>
            )}
        </button>
    );
};

export default AccessibilityToggle;
