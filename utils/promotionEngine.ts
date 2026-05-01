import { CartItem, BusinessConfig, Promotion, Customer } from '../types';
import { productReferenceCandidates as getProductReferenceCandidates } from './productReferences';

const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeMatchToken = (value: unknown): string => {
    const raw = typeof value === 'string'
        ? value.trim()
        : value != null
            ? String(value).trim()
            : '';

    return raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
};

const asReferenceList = (values: unknown[]): string[] => (
    values
        .map((value) => (typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : ''))
        .filter(Boolean)
);

const productReferenceTokens = (product: any): Set<string> => (
    new Set(getProductReferenceCandidates(product).map(normalizeMatchToken).filter(Boolean))
);

const productMatchesAnyReference = (product: any, values: unknown[]): boolean => {
    const productTokens = productReferenceTokens(product);
    if (productTokens.size === 0) return false;

    return asReferenceList(values).some((value) => productTokens.has(normalizeMatchToken(value)));
};

const productMatchesReferenceList = (product: any, values?: unknown[]): boolean => {
    if (!Array.isArray(values) || values.length === 0) return false;
    return productMatchesAnyReference(product, values);
};

const productCategoryCandidates = (product: any): string[] => (
    asReferenceList([
        product?.category,
        product?.categoria,
        product?.posCategoryName,
        product?.pos_category_name,
        product?.posCategoryId,
        product?.pos_category_id,
        product?.categoryId,
        product?.category_id,
    ])
);

const comparableCategoryTokens = (value: unknown): string[] => {
    const token = normalizeMatchToken(value);
    if (!token) return [];

    const singularOrPlural = token.length > 3
        ? (token.endsWith('s') ? token.slice(0, -1) : `${token}s`)
        : token;

    return Array.from(new Set([token, singularOrPlural].filter(Boolean)));
};

const productMatchesCategory = (product: any, categoryRef: unknown): boolean => {
    const targetTokens = new Set(comparableCategoryTokens(categoryRef));
    if (targetTokens.size === 0) return false;

    return productCategoryCandidates(product).some((candidate) => (
        comparableCategoryTokens(candidate).some((token) => targetTokens.has(token))
    ));
};

const terminalReferenceCandidates = (config: BusinessConfig, terminalId: string): string[] => {
    const normalizedRequestedId = String(terminalId || '').trim();
    const terminals = Array.isArray(config.terminals) ? config.terminals : [];
    const matchedTerminal = terminals.find((terminal) => {
        const localId = String(terminal?.id || '').trim();
        const erpTerminalId = String(terminal?.config?.erpTerminalId || terminal?.config?.erpBinding?.terminalId || '').trim();
        const terminalName = String(terminal?.config?.terminalName || terminal?.config?.erpBinding?.terminalName || '').trim();
        const stationNumber = String(terminal?.config?.stationNumber || terminal?.config?.erpBinding?.stationNumber || '').trim();

        return [localId, erpTerminalId, terminalName, stationNumber].filter(Boolean).includes(normalizedRequestedId);
    });

    if (!matchedTerminal) {
        return normalizedRequestedId ? [normalizedRequestedId] : [];
    }

    return [
        normalizedRequestedId,
        String(matchedTerminal.id || '').trim(),
        String(matchedTerminal.config?.erpTerminalId || '').trim(),
        String(matchedTerminal.config?.terminalName || '').trim(),
        String(matchedTerminal.config?.stationNumber || '').trim(),
        String(matchedTerminal.config?.erpBinding?.terminalId || '').trim(),
        String(matchedTerminal.config?.erpBinding?.terminalName || '').trim(),
        String(matchedTerminal.config?.erpBinding?.stationNumber || '').trim(),
    ].filter(Boolean);
};

const promotionMatchesTerminalScope = (promotion: Promotion, config: BusinessConfig, terminalId: string): boolean => {
    if (!Array.isArray(promotion.terminalIds) || promotion.terminalIds.length === 0 || !terminalId) {
        return true;
    }

    const promotionTerminalIds = new Set(
        promotion.terminalIds
            .map((value) => String(value).trim())
            .filter(Boolean)
    );

    return terminalReferenceCandidates(config, terminalId).some((candidate) => promotionTerminalIds.has(candidate));
};

const promotionMatchesResolvedRefs = (promotion: Promotion, product: any): boolean => {
    const refs = Array.isArray(promotion.targetRefs) ? promotion.targetRefs.filter(Boolean) : [];
    if (refs.length === 0) return false;
    return productMatchesReferenceList(product, refs);
};

const promotionMatchesTargetReference = (promotion: Promotion, product: any): boolean => (
    productMatchesAnyReference(product, [promotion.targetValue])
    || promotionMatchesResolvedRefs(promotion, product)
);

const promotionMatchesCategoryTarget = (promotion: Promotion, product: any): boolean => (
    productMatchesCategory(product, promotion.targetValue)
    || productMatchesCategory(product, promotion.targetLabel)
    || (Array.isArray(promotion.targetRefs) && promotion.targetRefs.some((ref) => productMatchesCategory(product, ref)))
);

const productBelongsToReferenceGroup = (product: any, productIds?: unknown[]): boolean => (
    productMatchesReferenceList(product, Array.isArray(productIds) ? productIds : [])
);

const promotionTargetsProduct = (promotion: Promotion, product: any, config: BusinessConfig): boolean => {
    if (promotion.targetType === 'ALL') return true;
    if (promotion.targetType === 'PRODUCT') return promotionMatchesTargetReference(promotion, product);
    if (promotion.targetType === 'CATEGORY') return promotionMatchesCategoryTarget(promotion, product);

    if (promotion.targetType === 'GROUP') {
        const group = config.productGroups?.find((g) => normalizeMatchToken(g.id) === normalizeMatchToken(promotion.targetValue));
        if (group && productBelongsToReferenceGroup(product, group.productIds)) return true;
        return promotionMatchesTargetReference(promotion, product);
    }

    if (promotion.targetType === 'SEASON') {
        const season = config.seasons?.find((s) => normalizeMatchToken(s.id) === normalizeMatchToken(promotion.targetValue));
        if (season && productBelongsToReferenceGroup(product, season.productIds)) return true;
        return promotionMatchesTargetReference(promotion, product);
    }

    return false;
};

const isPromotionActive = (promotion: Promotion): boolean => promotion.schedule?.isActive !== false;

export const applyPromotions = (cart: CartItem[], config: BusinessConfig, terminalId: string, customer?: Customer): CartItem[] => {
    const activePromotions = config.promotions?.filter(p => {
        // 1. Check Active Status
        if (!isPromotionActive(p)) return false;

        // 2. Check Schedule (Day of Week)
        const today = new Date();
        const daysMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const currentDayKey = daysMap[today.getDay()];
        if (!p.schedule.days.includes(currentDayKey)) return false;

        // 3. Check Time Range
        const now = today.getHours() * 60 + today.getMinutes();
        const [startH, startM] = p.schedule.startTime.split(':').map(Number);
        const [endH, endM] = p.schedule.endTime.split(':').map(Number);
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;
        if (now < start || now > end) return false;

        // 3.5 Check Date Range (NEW)
        if (p.schedule.startDate) {
            const startDate = new Date(p.schedule.startDate);
            startDate.setHours(0, 0, 0, 0);
            if (today < startDate) return false;
        }
        if (p.schedule.endDate) {
            const endDate = new Date(p.schedule.endDate);
            endDate.setHours(23, 59, 59, 999);
            if (today > endDate) return false;
        }

        // 4. Check Terminal Scope
        if (!promotionMatchesTerminalScope(p, config, terminalId)) return false;

        // 5. Check Loyalty Conditions (NEW)
        if (p.conditions && p.conditions.length > 0) {
            for (const condition of p.conditions) {
                if (condition.type === 'HAS_WALLET') {
                    if (!customer || !customer.wallet || customer.wallet.status !== 'ACTIVE') return false;
                }
                if (condition.type === 'CUSTOMER_TIER') {
                    if (!customer || customer.tier !== condition.value) return false;
                }
                if (condition.type === 'HAS_POINTS_MIN') {
                    const minPoints = parseInt(condition.value, 10);
                    if (!customer || (customer.loyaltyPoints || 0) < minPoints) return false;
                }
            }
        }

        return true;
    }) || [];

    if (activePromotions.length === 0) return cart;

    // Clone cart to avoid mutation
    let processedCart = cart.map(item => ({ ...item }));

    // Apply Promotions
    // Priority: We apply the first matching promotion for simplicity in this prototype.
    // In a real system, we might want "Best Offer" logic or "Stackable" flags.

    processedCart = processedCart.map(item => {
        // Find ALL applicable promotions for this item
        const applicablePromos = activePromotions.filter(p => {
            return promotionTargetsProduct(p, item, config);
        });

        if (
            item.adjustmentSource === 'MANUAL_DISCOUNT'
            || item.adjustmentSource === 'MANUAL_PRICE_OVERRIDE'
        ) {
            return item;
        }

        if (applicablePromos.length === 0) return item;

        const promotionBasePrice =
            item.adjustmentSource === 'TARIFF'
                ? item.price
                : (item.originalPrice || item.price);

        // Sort by Priority (Descending) -> Highest priority wins
        applicablePromos.sort((a, b) => (b.priority || 1) - (a.priority || 1));

        // Filter for the highest priority tier
        const highestPriority = applicablePromos[0].priority || 1;
        const topTierPromos = applicablePromos.filter(p => (p.priority || 1) === highestPriority);

        // Find the "Best Offer" among the top tier (Lowest Price)
        let bestPrice = item.price;
        let bestPromo = null;

        for (const promo of topTierPromos) {
            let tempPrice = item.price;
            switch (promo.type) {
                case 'DISCOUNT':
                    tempPrice = promotionBasePrice * (1 - promo.benefitValue / 100);
                    break;
                case 'HAPPY_HOUR':
                    tempPrice = promo.benefitValue;
                    break;
                case 'BOGO':
                    if (item.quantity >= 2) {
                        const freeItems = Math.floor(item.quantity / 2);
                        const paidItems = item.quantity - freeItems;
                        tempPrice = (promotionBasePrice * paidItems) / item.quantity;
                    }
                    break;
                case 'CONDITIONAL_TARGET':
                    // ... (Logic handled below, but we need to simulate it here for comparison)
                    // For simplicity, we'll skip complex conditional comparison in this loop 
                    // and assume if it triggers, it might be good. 
                    // Ideally, we refactor the price calculation into a helper function.
                    break;
            }

            if (tempPrice < bestPrice) {
                bestPrice = tempPrice;
                bestPromo = promo;
            }
        }

        // If we found a promo that lowers the price, use it. 
        // If no promo lowers the price (e.g. BOGO with qty 1), we stick with original.
        const applicablePromo = bestPromo || topTierPromos[0]; // Fallback to first if none lower price (or all equal)

        let newPrice = promotionBasePrice;

        switch (applicablePromo.type) {
            case 'DISCOUNT':
                newPrice = promotionBasePrice * (1 - applicablePromo.benefitValue / 100);
                break;
            case 'HAPPY_HOUR':
                // Fixed price
                newPrice = applicablePromo.benefitValue;
                break;
            case 'BOGO':
                // Logic: Buy X Get Y Free.
                // Simplified: If quantity >= 2, every 2nd item is free.
                // Effective price = (Price * (Qty - FreeQty)) / Qty
                if (item.quantity >= 2) {
                    const freeItems = Math.floor(item.quantity / 2);
                    const paidItems = item.quantity - freeItems;
                    newPrice = (promotionBasePrice * paidItems) / item.quantity;
                }
                break;

            case 'CONDITIONAL_TARGET':
                // 1. Calculate Total Spend (based on original prices)
                const totalSpend = processedCart.reduce((sum, i) => {
                    const basePrice = i.adjustmentSource === 'TARIFF' ? i.price : (i.originalPrice || i.price);
                    return sum + (basePrice * i.quantity);
                }, 0);

                // 2. Check Trigger
                if (applicablePromo.trigger && totalSpend >= applicablePromo.trigger.value) {
                    // 3. Find Target Item
                    let candidates = [...processedCart];

                    // Filter by Category if needed
                    if (applicablePromo.targetStrategy?.mode === 'CATEGORY_CHEAPEST') {
                        candidates = candidates.filter(i => i.category === applicablePromo.targetStrategy?.filterValue);
                    }

                    if (candidates.length > 0) {
                        // Sort candidates
                        candidates.sort((a, b) => {
                            if (applicablePromo.targetStrategy?.mode === 'MOST_EXPENSIVE_ITEM') {
                                const priceA = a.adjustmentSource === 'TARIFF' ? a.price : (a.originalPrice || a.price);
                                const priceB = b.adjustmentSource === 'TARIFF' ? b.price : (b.originalPrice || b.price);
                                return priceB - priceA;
                            }
                            const priceA = a.adjustmentSource === 'TARIFF' ? a.price : (a.originalPrice || a.price);
                            const priceB = b.adjustmentSource === 'TARIFF' ? b.price : (b.originalPrice || b.price);
                            return priceA - priceB; // CHEAPEST
                        });

                        const targetItem = candidates[0];

                        // If this is the target item, apply discount
                        // Using 'id' as unique identifier for the line item (assuming 1 line per product)
                        if (item.id === targetItem.id) {
                            newPrice = promotionBasePrice * (1 - applicablePromo.benefitValue / 100);
                        }
                    }
                }
                break;
        }

        // Ensure we don't increase price (unless it's a weird happy hour)
        if (newPrice < promotionBasePrice) {
            const safeRate = promotionBasePrice > 0
                ? round4((promotionBasePrice - newPrice) / promotionBasePrice)
                : undefined;
            return {
                ...item,
                price: round2(newPrice),
                originalPrice: round2(promotionBasePrice),
                discountAmount: round2((promotionBasePrice - newPrice) * item.quantity),
                discountRate: safeRate,
                adjustmentSource: 'PROMOTION',
                appliedPromotionId: applicablePromo.id,
                appliedPromotionCode: applicablePromo.id,
                appliedPromotionName: applicablePromo.name
            };
        }

        return item;
    });

    return processedCart;
};

/**
 * Checks if a product has any active promotion applicable.
 * Used for UI badges.
 */
export const hasProductPromotion = (product: any, config: BusinessConfig, terminalId: string): boolean => {
    if (!config.promotions) return false;

    // 1. Filter Active Promotions (Same logic as above)
    const activePromotions = config.promotions.filter(p => {
        if (!isPromotionActive(p)) return false;

        const today = new Date();
        const daysMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const currentDayKey = daysMap[today.getDay()];
        if (!p.schedule.days.includes(currentDayKey)) return false;

        const now = today.getHours() * 60 + today.getMinutes();
        const [startH, startM] = p.schedule.startTime.split(':').map(Number);
        const [endH, endM] = p.schedule.endTime.split(':').map(Number);
        const start = startH * 60 + startM;
        const end = endH * 60 + endM;
        if (now < start || now > end) return false;

        // Date Range (NEW)
        if (p.schedule.startDate) {
            const startDate = new Date(p.schedule.startDate);
            startDate.setHours(0, 0, 0, 0);
            if (today < startDate) return false;
        }
        if (p.schedule.endDate) {
            const endDate = new Date(p.schedule.endDate);
            endDate.setHours(23, 59, 59, 999);
            if (today > endDate) return false;
        }

        // Terminal scope check
        if (!promotionMatchesTerminalScope(p, config, terminalId)) return false;

        return true;
    });

    // 2. Check if any active promotion targets this product
    return activePromotions.some(p => {
        return promotionTargetsProduct(p, product, config);
    });
};
