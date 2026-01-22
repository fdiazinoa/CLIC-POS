import { CartItem, BusinessConfig, Product } from '../types';

/**
 * Calculates the total loyalty points earned for a given cart.
 * 
 * @param cart The list of items in the cart.
 * @param config The business configuration containing loyalty rules.
 * @returns The total integer points earned.
 */
export const calculatePointsEarned = (cart: CartItem[], config: BusinessConfig): number => {
    if (!config.loyalty?.isEnabled) return 0;

    const { earnRate, excludedCategories } = config.loyalty;

    let qualifyingTotal = 0;

    for (const item of cart) {
        // 1. Check Product Exclusion Flag
        if (item.operationalFlags?.excludeFromLoyalty) continue;

        // 2. Check Category Exclusion
        if (excludedCategories && excludedCategories.includes(item.category)) continue;

        // 3. Add to qualifying total (using price after discounts if applicable, or original price?)
        // Usually points are awarded on the *paid* amount.
        const itemTotal = item.price * item.quantity;
        qualifyingTotal += itemTotal;
    }

    // Calculate points: (Total / 1 Unit) * EarnRate
    // Example: Rate 0.1 (1 pt per $10). Total $100.
    // Logic: If earnRate is "Points per Currency Unit", then Total * Rate.
    // Example: $100 * 0.1 = 10 Points.
    return Math.floor(qualifyingTotal * earnRate);
};

/**
 * Calculates the monetary value of a given number of points.
 * 
 * @param points The number of points to redeem.
 * @param config The business configuration.
 * @returns The monetary value in the base currency.
 */
export const calculateRedemptionValue = (points: number, config: BusinessConfig): number => {
    if (!config.loyalty?.isEnabled) return 0;

    const { redeemRate } = config.loyalty;

    // Value = Points * Rate
    // Example: 100 Points * 0.10 ($/Point) = $10.00
    return points * redeemRate;
};

/**
 * Checks if a product is eligible for loyalty points.
 */
export const isProductEligibleForLoyalty = (product: Product, config: BusinessConfig): boolean => {
    if (!config.loyalty?.isEnabled) return false;
    if (product.operationalFlags?.excludeFromLoyalty) return false;
    if (config.loyalty.excludedCategories?.includes(product.category)) return false;
    return true;
};


/**
 * Finds the primary loyalty card for a customer.
 * Prioritizes 'LOYALTY' type and 'ACTIVE' status.
 */
export const getPrimaryLoyaltyCard = (customer: { cards?: any[], loyalty?: any }): any | undefined => {
    if (customer.cards && customer.cards.length > 0) {
        return customer.cards.find(c => c.type === 'LOYALTY' && c.status === 'ACTIVE') || customer.cards[0];
    }
    return customer.loyalty;
};
