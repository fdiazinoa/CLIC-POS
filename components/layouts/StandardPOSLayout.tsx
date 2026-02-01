/**
 * StandardPOSLayout
 * 
 * Layout wrapper for standard POS terminals.
 * This layout maintains the current UI exactly as it exists today - no visual changes.
 * It simply provides a consistent layout structure for future compatibility.
 */

import React, { ReactNode } from 'react';

interface StandardPOSLayoutProps {
    children: ReactNode;
}

const StandardPOSLayout: React.FC<StandardPOSLayoutProps> = ({ children }) => {
    return (
        <div className="standard-pos-layout">
            {/* No wrapper styling - pass through children as-is */}
            {children}
        </div>
    );
};

export default StandardPOSLayout;
