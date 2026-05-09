import React, { useCallback } from 'react';
import { Delete, Eraser, Check } from 'lucide-react';
import { markPerfInteraction, measureSync, useRenderPerfDebug } from '../utils/perfDebug';
import { markPOSBusy } from '../utils/posSaleActivity';

interface VirtualKeyboardProps {
    onKeyPress: (key: string) => void;
    onDelete: () => void;
    onClear: () => void;
    onClose: () => void;
}

const TOUCH_BUTTON_CLASS = 'pos-touch-button touch-manipulation select-none [-webkit-tap-highlight-color:transparent]';
const CHARACTER_DETAIL = { keyType: 'character' };
const SPACE_DETAIL = { keyType: 'space' };
const KEY_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

interface VirtualKeyboardButtonProps {
    value: string;
    className: string;
    children?: React.ReactNode;
    onPress: (value: string) => void;
}

const VirtualKeyboardButton = React.memo<VirtualKeyboardButtonProps>(({ value, className, children, onPress }) => {
    const handleClick = useCallback(() => onPress(value), [onPress, value]);

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`${TOUCH_BUTTON_CLASS} pos-touch-critical ${className}`}
        >
            {children ?? value}
        </button>
    );
});

VirtualKeyboardButton.displayName = 'VirtualKeyboardButton';

const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ onKeyPress, onDelete, onClear, onClose }) => {
    useRenderPerfDebug('VirtualKeyboard');

    const pressCharacter = useCallback((key: string) => {
        markPerfInteraction('pos.virtualKeyboardTouch', 3500, CHARACTER_DETAIL);
        markPOSBusy('pos.virtualKeyboardTouch', 2500);
        measureSync('pos.virtualKeyboard.touchKey', () => onKeyPress(key), CHARACTER_DETAIL);
    }, [onKeyPress]);

    const pressSpace = useCallback(() => {
        markPerfInteraction('pos.virtualKeyboardTouch', 3500, SPACE_DETAIL);
        markPOSBusy('pos.virtualKeyboardTouch', 2500);
        measureSync('pos.virtualKeyboard.touchKey', () => onKeyPress(' '), SPACE_DETAIL);
    }, [onKeyPress]);

    const pressClear = useCallback(() => {
        markPerfInteraction('pos.virtualKeyboardClear', 3500);
        markPOSBusy('pos.virtualKeyboardClear', 2500);
        measureSync('pos.virtualKeyboard.clearButton', onClear);
    }, [onClear]);

    const pressDelete = useCallback(() => {
        markPerfInteraction('pos.virtualKeyboardDelete', 3500);
        markPOSBusy('pos.virtualKeyboardDelete', 2500);
        measureSync('pos.virtualKeyboard.deleteButton', onDelete);
    }, [onDelete]);

    return (
        <div className="pos-touch-root bg-slate-900 border-t border-slate-700 p-2 shadow-xl animate-in slide-in-from-bottom-10 h-72 flex flex-col justify-end pb-4">
            <div className="flex-1 flex flex-col justify-center gap-2 max-w-5xl mx-auto w-full">
                {KEY_ROWS.map((row, rowIndex) => (
                    <div key={rowIndex} className="flex justify-center gap-1.5 px-2">
                        {row.map((key) => (
                            <VirtualKeyboardButton
                                key={key}
                                value={key}
                                onPress={pressCharacter}
                                className="h-12 flex-1 max-w-[60px] bg-slate-700 hover:bg-slate-600 active:bg-blue-600 text-white rounded-lg font-bold text-lg shadow-sm transition-colors active:scale-95"
                            />
                        ))}
                    </div>
                ))}

                <div className="flex justify-center gap-2 px-2 mt-1">
                    <button
                        type="button"
                        onClick={pressClear}
                        className={`${TOUCH_BUTTON_CLASS} pos-touch-critical h-12 px-6 bg-red-900/50 text-red-400 hover:bg-red-900/80 rounded-lg flex items-center justify-center gap-2 font-bold shadow-sm active:scale-95`}
                    >
                        <Eraser size={20} />
                        <span className="text-xs uppercase hidden sm:inline">Borrar</span>
                    </button>

                    <button
                        type="button"
                        onClick={pressSpace}
                        className={`${TOUCH_BUTTON_CLASS} pos-touch-critical h-12 flex-[2] max-w-xs bg-slate-700 hover:bg-slate-600 active:bg-blue-600 text-white rounded-lg font-bold shadow-sm transition-colors active:scale-95`}
                    >
                        SPACE
                    </button>

                    <button
                        type="button"
                        onClick={pressDelete}
                        className={`${TOUCH_BUTTON_CLASS} pos-touch-critical h-12 px-6 bg-slate-600 text-white hover:bg-slate-500 rounded-lg flex items-center justify-center shadow-sm active:scale-95`}
                    >
                        <Delete size={20} />
                    </button>

                    <button
                        type="button"
                        onClick={onClose}
                        className={`${TOUCH_BUTTON_CLASS} pos-touch-critical h-12 px-8 bg-blue-600 text-white hover:bg-blue-500 rounded-lg flex items-center justify-center gap-2 font-bold shadow-md shadow-blue-900/40 active:scale-95`}
                    >
                        <Check size={24} />
                        <span className="text-xs uppercase hidden sm:inline">Listo</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VirtualKeyboard;
