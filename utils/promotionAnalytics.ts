import { Promotion, PromotionRecommendation, Transaction } from '../types';

export const calculateEffectiveness = (promotion: Promotion, transactions: Transaction[]) => {
    // In a real app, this would filter transactions by promotion ID
    // For this prototype, we'll simulate data based on the promotion's "age" or random factors

    // Mock logic:
    const mockUsage = Math.floor(Math.random() * 150) + 10;
    const mockRevenue = mockUsage * (Math.floor(Math.random() * 50) + 20);
    const mockConversion = (Math.random() * 0.3) + 0.05;

    return {
        usageCount: promotion.stats?.usageCount || mockUsage,
        revenueGenerated: promotion.stats?.revenueGenerated || mockRevenue,
        conversionRate: promotion.stats?.conversionRate || mockConversion
    };
};

export const generateRecommendations = (promotion: Promotion): PromotionRecommendation[] => {
    const recommendations: PromotionRecommendation[] = [];

    // 1. Timing Analysis
    if (!promotion.schedule.days.includes('S') && !promotion.schedule.days.includes('D')) {
        recommendations.push({
            type: 'TIMING',
            message: 'Tus ventas son 40% más altas los fines de semana. Considera activar esta promo Sábado y Domingo.',
            confidence: 0.85
        });
    }

    // 2. Discount Depth Analysis
    if (promotion.type === 'DISCOUNT' && promotion.benefitValue < 10) {
        recommendations.push({
            type: 'DISCOUNT_DEPTH',
            message: 'Los descuentos menores al 10% tienen baja conversión. Aumentar al 15% podría duplicar el uso.',
            confidence: 0.75
        });
    }

    // 3. Terminal Analysis (Mocked)
    if (!promotion.terminalIds || promotion.terminalIds.length === 0) {
        recommendations.push({
            type: 'TERMINAL',
            message: 'Detectamos alto tráfico en la Terminal "Caja Rápida". Esta promo funcionaría muy bien allí.',
            confidence: 0.60
        });
    }

    // 4. Target Analysis
    if (promotion.targetType === 'PRODUCT') {
        recommendations.push({
            type: 'TARGET',
            message: 'Expandir esta oferta a toda la categoría "Bebidas" podría incrementar el ticket promedio en un 12%.',
            confidence: 0.90
        });
    }

    return recommendations;
};
