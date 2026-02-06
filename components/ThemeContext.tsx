import React, { createContext, useContext, useState, useEffect } from 'react';

interface ThemeContextType {
    isHighContrast: boolean;
    toggleHighContrast: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isHighContrast, setIsHighContrast] = useState<boolean>(() => {
        const saved = localStorage.getItem('isHighContrast');
        return saved === 'true';
    });

    useEffect(() => {
        localStorage.setItem('isHighContrast', isHighContrast.toString());
        if (isHighContrast) {
            document.body.classList.add('high-contrast-mode');
        } else {
            document.body.classList.remove('high-contrast-mode');
        }
    }, [isHighContrast]);

    const toggleHighContrast = () => {
        setIsHighContrast(prev => !prev);
    };

    return (
        <ThemeContext.Provider value={{ isHighContrast, toggleHighContrast }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
