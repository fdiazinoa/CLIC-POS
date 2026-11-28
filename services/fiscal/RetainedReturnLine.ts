import type { CartItem, Transaction } from '../../types';
import { sameV3RetainedLine } from '../sync/LargeMasterSyncV3StockAuthority';
import { LargeMasterSyncV3Error } from '../sync/LargeMasterSyncV3Types';
import type { ReturnPreparation } from './FiscalReturnV1';

/** A prepared return has its own fiscal amounts and still references the exact sold line. */
function sealedReturnOriginalLine(preparation: ReturnPreparation, line: CartItem): CartItem {
    const matches = preparation.returnSnapshot.lines.filter((row: any) => row.cartId === line.cartId);
    const [prepared] = matches;
    const original = prepared?.originalItem as CartItem | undefined;
    if (matches.length !== 1 || !original || prepared.itemId !== line.id ||
        original.id !== line.id || original.cartId !== line.cartId ||
        prepared.quantity !== line.quantity || prepared.unitPrice !== line.price ||
        prepared.discountAmount !== line.discountAmount || prepared.netAmount !== line.netAmount ||
        prepared.taxAmount !== line.taxAmount || prepared.totalAmount !== line.totalAmount ||
        !sameV3RetainedLine(original, { ...line, price: original.price, discountAmount: original.discountAmount }, true)) {
        throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_LINE_CHANGED');
    }
    return original;
}

export function assertSealedReturnOriginalLine(items: CartItem[], line: CartItem, preparation: ReturnPreparation): void {
    const photo = sealedReturnOriginalLine(preparation, line);
    const matches = items.filter(item => item.cartId === photo.cartId && item.id === photo.id);
    if (matches.length !== 1 || matches[0].quantity !== photo.quantity || !sameV3RetainedLine(matches[0], photo, true)) {
        throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_LINE_CHANGED');
    }
}

export function assertSealedReturnOriginalLines(original: Transaction, source: Transaction, preparation: ReturnPreparation): void {
    if (original.id !== preparation.originalReference.transactionId || original.ncf !== preparation.originalReference.ncf ||
        source.originalTransactionId !== original.id || source.affectedNCF !== original.ncf ||
        source.items.length !== preparation.returnSnapshot.lines.length ||
        new Set(source.items.map(line => line.cartId)).size !== source.items.length) {
        throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_LINE_CHANGED');
    }
    for (const line of source.items) {
        assertSealedReturnOriginalLine(original.items, line, preparation);
    }
}
