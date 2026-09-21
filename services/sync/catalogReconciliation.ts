import type { Product } from '../../types';

const remoteProductId = (product: Product): string => String(
    (product as any).sourceItemId || (product as any).source_item_id
    || (product as any).erpProductId || product.id || '',
).trim();

export function keepProductAfterAuthoritativeFull(
    product: Product,
    remoteIds: Set<string>,
    cachedIds: Set<string>,
    protectedIds: Set<string>,
): boolean {
    const remoteId = remoteProductId(product);
    const erpOwned = (product as any).syncSource === 'ERP_SNAPSHOT'
        || cachedIds.has(remoteId) || cachedIds.has(product.id);
    return !erpOwned || remoteIds.has(remoteId)
        || protectedIds.has(product.id) || protectedIds.has(remoteId);
}

export function canDeleteCatalogProduct(product: Product, protectedIds: Set<string>): boolean {
    return !protectedIds.has(product.id) && !protectedIds.has(remoteProductId(product));
}

export function resolveRemoteCatalogDeletionIds(remoteIds: string[], products: Product[]): Set<string> {
    const byRemoteId = new Map<string, Product>();
    const byId = new Map<string, Product>();
    for (const product of products) {
        byId.set(product.id, product);
        for (const candidate of [(product as any).sourceItemId, (product as any).source_item_id, (product as any).erpProductId]) {
            const id = String(candidate || '').trim();
            if (id) byRemoteId.set(id, product);
        }
    }
    const result = new Set<string>();
    for (const remoteId of remoteIds) {
        const product = byRemoteId.get(remoteId) || byId.get(remoteId);
        if (product?.id && ((product as any).syncSource === 'ERP_SNAPSHOT' || byRemoteId.has(remoteId))) {
            result.add(product.id);
        }
    }
    return result;
}
