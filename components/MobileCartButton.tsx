import React, { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';

interface MobileCartButtonProps {
    itemCount: number;
    onClick: () => void;
}

const MobileCartButton: React.FC<MobileCartButtonProps> = ({ itemCount, onClick }) => {
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
            onClick={onClick}
            className="md:hidden fixed bottom-28 right-6 z-40 bg-blue-600 text-white p-5 rounded-full shadow-2xl active:scale-90 transition-all hover:bg-blue-700 flex items-center justify-center animate-in fade-in slide-in-from-bottom-5 duration-500"
        >
            <ShoppingCart size={28} />
            {itemCount > 0 && (
                <div
                    className={`absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-lg ${animate ? 'scale-125' : 'scale-100'
                        } transition-transform duration-300`}
                >
                    {itemCount}
                </div>
            )}
        </button>
    );
};

export default MobileCartButton;
