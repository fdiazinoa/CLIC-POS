import React from 'react';
import { Delete, Eraser, Check } from 'lucide-react';

interface VirtualKeyboardProps {
    onKeyPress: (key: string) => void;
    onDelete: () => void;
    onClear: () => void;
    onClose: () => void;
}

const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ onKeyPress, onDelete, onClear, onClose }) => {
    const rows = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ];

    return (
        <div className="bg-slate-900 border-t border-slate-700 p-1.5 shadow-2xl animate-in slide-in-from-bottom-10 h-48 flex flex-col justify-end pb-2">
            <div className="flex-1 flex flex-col justify-center gap-1.5 max-w-3xl mx-auto w-full">
                {rows.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex justify-center gap-1 px-2">
                        {row.map((key) => (
                            <button
                                key={key}
                                onClick={() => onKeyPress(key)}
                                className="h-8 flex-1 max-w-[42px] bg-slate-700 hover:bg-slate-600 active:bg-blue-600 text-white rounded-lg font-bold text-sm shadow-sm transition-colors active:scale-95"
                            >
                                {key}
                            </button>
                        ))}
                    </div>
                ))}

                <div className="flex justify-center gap-1.5 px-2 mt-0.5">
                    <button
                        onClick={onClear}
                        className="h-8 px-4 bg-red-900/50 text-red-400 hover:bg-red-900/80 rounded-lg flex items-center justify-center gap-2 font-bold shadow-sm active:scale-95"
                    >
                        <Eraser size={16} />
                        <span className="text-xs uppercase hidden sm:inline">Borrar</span>
                    </button>

                    <button
                        onClick={() => onKeyPress(' ')}
                        className="h-8 flex-[2] max-w-[220px] bg-slate-700 hover:bg-slate-600 active:bg-blue-600 text-white rounded-lg font-bold text-xs shadow-sm transition-colors active:scale-95"
                    >
                        SPACE
                    </button>

                    <button
                        onClick={onDelete}
                        className="h-8 px-4 bg-slate-600 text-white hover:bg-slate-500 rounded-lg flex items-center justify-center shadow-sm active:scale-95"
                    >
                        <Delete size={16} />
                    </button>

                    <button
                        onClick={onClose}
                        className="h-8 px-5 bg-blue-600 text-white hover:bg-blue-500 rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg shadow-blue-900/50 active:scale-95"
                    >
                        <Check size={18} />
                        <span className="text-xs uppercase hidden sm:inline">Listo</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VirtualKeyboard;
