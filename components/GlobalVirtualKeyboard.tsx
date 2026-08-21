import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import VirtualKeyboard from './VirtualKeyboard';

const isEditableTextField = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  if (target.disabled || target.readOnly) return false;
  if (target.closest('[data-disable-global-virtual-keyboard="true"]')) return false;
  if (target.closest('[data-disable-native-soft-keyboard="true"]')) return false;

  if (target instanceof HTMLTextAreaElement) return true;

  const type = String(target.type || 'text').toLowerCase();
  return ['text', 'search', 'number', 'tel', 'email', 'url', 'password'].includes(type);
};

const updateFieldValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
};

const setCursorSafely = (field: HTMLInputElement | HTMLTextAreaElement, position: number) => {
  try {
    field.setSelectionRange(position, position);
  } catch {
    // input[type=number] does not support selection ranges in several Android WebViews.
  }
};

const normalizeKeyForField = (field: HTMLInputElement | HTMLTextAreaElement, key: string): string => {
  if (!(field instanceof HTMLInputElement)) return key;
  const type = String(field.type || '').toLowerCase();
  if (type !== 'number' && type !== 'tel') return key;
  if (/^[0-9]$/.test(key)) return key;
  if (type === 'number' && key === '.' && !field.value.includes('.')) return key;
  return '';
};

const GlobalVirtualKeyboard: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const activeFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (Capacitor.getPlatform() === 'android') {
      const handlePointerUp = (event: PointerEvent) => {
        if (!isEditableTextField(event.target)) return;
        const field = event.target;

        // Wait until Chromium completes its own focus handling for the touched field.
        window.setTimeout(() => {
          if (!field.isConnected) return;
          if (document.activeElement !== field) {
            field.focus({ preventScroll: true });
          }

          const bridge = (window as typeof window & {
            ClicPOSAppBridge?: { showSoftKeyboard?: () => void };
          }).ClicPOSAppBridge;
          bridge?.showSoftKeyboard?.();
        }, 0);
      };

      // A pointer gesture is required so programmatic autofocus and barcode
      // scanners can keep the search field active without opening the IME.
      document.addEventListener('pointerup', handlePointerUp, true);
      return () => document.removeEventListener('pointerup', handlePointerUp, true);
    }

    // iOS uses its native keyboard. The POS keyboard remains only as a browser
    // fallback for touch kiosks without a system IME.
    if (Capacitor.isNativePlatform()) return;
    const isTouchRuntime = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouchRuntime) return;

    const handleFocusIn = (event: FocusEvent) => {
      if (!isEditableTextField(event.target)) return;
      activeFieldRef.current = event.target;
      setVisible(true);
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (document.activeElement === activeFieldRef.current) return;
        const nextActive = document.activeElement;
        if (isEditableTextField(nextActive)) return;
        activeFieldRef.current = null;
        setVisible(false);
      }, 120);
    };

    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
    };
  }, []);

  const withActiveField = (callback: (field: HTMLInputElement | HTMLTextAreaElement) => void) => {
    const field = activeFieldRef.current;
    if (!field) return;
    callback(field);
    field.focus({ preventScroll: true });
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100000]" data-disable-global-virtual-keyboard="true">
      <VirtualKeyboard
        onKeyPress={(key) => withActiveField((field) => {
          const normalizedKey = normalizeKeyForField(field, key);
          if (!normalizedKey) return;
          const start = field.selectionStart ?? field.value.length;
          const end = field.selectionEnd ?? field.value.length;
          const nextValue = `${field.value.slice(0, start)}${normalizedKey}${field.value.slice(end)}`;
          updateFieldValue(field, nextValue);
          const nextCursor = start + normalizedKey.length;
          window.setTimeout(() => setCursorSafely(field, nextCursor), 0);
        })}
        onDelete={() => withActiveField((field) => {
          const start = field.selectionStart ?? field.value.length;
          const end = field.selectionEnd ?? field.value.length;
          if (start === 0 && end === 0) return;
          const deleteStart = start === end ? Math.max(0, start - 1) : start;
          const nextValue = `${field.value.slice(0, deleteStart)}${field.value.slice(end)}`;
          updateFieldValue(field, nextValue);
          window.setTimeout(() => setCursorSafely(field, deleteStart), 0);
        })}
        onClear={() => withActiveField((field) => {
          updateFieldValue(field, '');
          window.setTimeout(() => setCursorSafely(field, 0), 0);
        })}
        onClose={() => {
          activeFieldRef.current?.blur();
          activeFieldRef.current = null;
          setVisible(false);
        }}
      />
    </div>
  );
};

export default GlobalVirtualKeyboard;
