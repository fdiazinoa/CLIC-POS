
/**
 * Calculates the suggested selling price based on cost and target margin (Food Cost %).
 * Formula: Price = Cost / (TargetPercentage / 100)
 * 
 * @param cost The unit cost of the product.
 * @param targetPercentage The desired Food Cost percentage (e.g., 30 for 30%).
 * @returns The calculated selling price, rounded to 2 decimal places.
 */
export const calculatePriceFromMargin = (cost: number, targetPercentage: number): number => {
    if (targetPercentage <= 0) return cost; // Avoid division by zero or negative
    if (cost <= 0) return 0;

    const price = cost / (targetPercentage / 100);
    return Math.round(price * 100) / 100; // Round to 2 decimals
};
