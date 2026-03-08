import React, { CSSProperties, RefObject, useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';

interface MobileCartButtonProps {
    itemCount: number;
    onClick: () => void;
    buttonRef?: RefObject<HTMLButtonElement | null>;
    style?: CSSProperties;
}

const MobileCartButton: React.FC<MobileCartButtonProps> = ({ itemCount, onClick, buttonRef, style }) => {
    const [animate, setAnimate] = useState(false);

    useEffect(() => {
        if (itemCount > 0) {
            setAnimate(true);
            const timer = setTimeout(() => setAnimate(false), 300);
            return () => clearTimeout(timer);
        }
    }, [itemCount]);

    return (
        <button
            ref={buttonRef}
            onClick={onClick}
            className={`md:hidden fixed bottom-6 right-6 z-40 bg-blue-600 text-white p-5 rounded-full shadow-2xl active:scale-90 transition-all hover:bg-blue-700 flex items-center justify-center animate-in fade-in slide-in-from-bottom-5 duration-500 ${animate ? 'ring-4 ring-blue-300' : ''
                }`}
            style={style}
        >
            <div className={animate ? 'animate-bounce' : ''}>
                <ShoppingCart size={28} />
            </div>
            {itemCount > 0 && (
                <div
                    className={`absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-lg ${animate ? 'scale-150 rotate-12' : 'scale-100 rotate-0'
                        } transition-all duration-300`}
                >
                    {itemCount}
                </div>
            )}
        </button>
    );
};

export default MobileCartButton;
