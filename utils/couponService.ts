import { BusinessConfig, Campaign, Coupon } from '../types';

export interface RedemptionResult {
    success: boolean;
    benefit?: {
        type: 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_ITEM';
        value: number;
        description: string;
    };
    coupon?: Coupon;
    error?: string;
    updatedConfig?: BusinessConfig;
}

export const couponService = {
    /**
     * Simulates generating a batch of coupons for a campaign
     */
    generateCoupons: (campaign: Campaign, quantity: number, config: BusinessConfig): BusinessConfig => {
        const newCoupons: Coupon[] = [];
        for (let i = 0; i < quantity; i++) {
            newCoupons.push({
                id: crypto.randomUUID(),
                campaignId: campaign.id,
                code: `${campaign.name.substring(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                status: 'GENERATED',
                createdAt: new Date().toISOString()
            });
        }

        return {
            ...config,
            coupons: [...(config.coupons || []), ...newCoupons],
            campaigns: config.campaigns?.map(c =>
                c.id === campaign.id
                    ? { ...c, totalGenerated: c.totalGenerated + quantity }
                    : c
            )
        };
    },

    validateCoupon: (
        code: string,
        config: BusinessConfig,
        cartTotal: number = 0,
        customerId?: string | null
    ): RedemptionResult => {
        const normalizedCode = code.trim().toUpperCase();
        const selectedCustomerId = customerId?.trim();

        if (!Number.isFinite(cartTotal) || cartTotal <= 0) {
            return { success: false, error: 'Agregue al menos un artículo antes de aplicar el cupón.' };
        }

        // 1. Find Coupon
        const coupon = config.coupons?.find(c => c.code.trim().toUpperCase() === normalizedCode);

        if (!coupon) {
            return { success: false, error: 'Cupón no encontrado.' };
        }

        // 2. Validate Status
        if (coupon.status === 'REDEEMED') {
            return { success: false, error: `Este cupón ya fue utilizado el ${new Date(coupon.redeemedAt!).toLocaleDateString()}.` };
        }

        if (coupon.status === 'EXPIRED') {
            return { success: false, error: 'Este cupón ha expirado.' };
        }

        const assignedTo = coupon.assignedTo?.trim();
        if (assignedTo && !selectedCustomerId) {
            return {
                success: false,
                error: 'Este cupón está asignado a un cliente. Seleccione el cliente correcto antes de canjearlo.'
            };
        }

        if (assignedTo && assignedTo !== selectedCustomerId) {
            return {
                success: false,
                error: 'Este cupón está asignado a otro cliente. Verifique el cliente seleccionado e intente nuevamente.'
            };
        }

        // 3. Find Campaign
        const campaign = config.campaigns?.find(c => c.id === coupon.campaignId);
        if (!campaign) {
            return { success: false, error: 'Campaña asociada no encontrada.' };
        }

        // 4. Validate Dates
        const now = new Date();
        const startDate = new Date(campaign.startDate);
        const endDate = new Date(campaign.endDate);

        if (now < startDate) {
            return { success: false, error: `La campaña aún no inicia. Comienza el ${startDate.toLocaleDateString()}.` };
        }

        if (now > endDate) {
            return { success: false, error: `La campaña finalizó el ${endDate.toLocaleDateString()}.` };
        }

        // 6. Validate Conditions (Min Purchase, Days, Hours)
        if (campaign.minPurchaseAmount && cartTotal < campaign.minPurchaseAmount) {
            return { success: false, error: `El monto mínimo para este cupón es $${campaign.minPurchaseAmount}.` };
        }

        const currentDayMap = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        const currentDay = currentDayMap[now.getDay()];
        if (campaign.activeDays && !campaign.activeDays.includes(currentDay)) {
            return { success: false, error: `Este cupón no es válido los ${currentDay === 'D' ? 'Domingos' : currentDay === 'S' ? 'Sábados' : 'días de semana'}.` };
        }

        if (campaign.activeHours) {
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const [startH, startM] = campaign.activeHours.start.split(':').map(Number);
            const [endH, endM] = campaign.activeHours.end.split(':').map(Number);
            const start = startH * 60 + startM;
            const end = endH * 60 + endM;

            if (currentTime < start || currentTime > end) {
                return { success: false, error: `Este cupón solo es válido de ${campaign.activeHours.start} a ${campaign.activeHours.end}.` };
            }
        }

        return {
            success: true,
            benefit: {
                type: campaign.benefitType,
                value: campaign.benefitValue,
                description: campaign.description || campaign.name
            },
            coupon
        };
    },

    commitCouponRedemption: (
        couponId: string,
        ticketRef: string,
        terminalId: string,
        config: BusinessConfig,
        redeemedAt: string = new Date().toISOString()
    ): BusinessConfig => ({
        ...config,
        coupons: (config.coupons || []).map(coupon => coupon.id === couponId
            ? {
                ...coupon,
                status: 'REDEEMED',
                redeemedAt,
                ticketRef,
                terminalId
            }
            : coupon)
    }),

    /**
     * Validates and immediately redeems a coupon. Kept for callers that
     * explicitly need the legacy atomic behavior.
     */
    redeemCoupon: (
        code: string,
        ticketId: string,
        terminalId: string,
        config: BusinessConfig,
        cartTotal: number = 0,
        customerId?: string | null
    ): RedemptionResult => {
        const validation = couponService.validateCoupon(code, config, cartTotal, customerId);
        if (!validation.success || !validation.coupon) return validation;

        const redeemedAt = new Date().toISOString();
        const updatedCoupon: Coupon = {
            ...validation.coupon,
            status: 'REDEEMED',
            redeemedAt,
            ticketRef: ticketId,
            terminalId: terminalId
        };

        const updatedConfig = couponService.commitCouponRedemption(
            validation.coupon.id,
            ticketId,
            terminalId,
            config,
            redeemedAt
        );

        return {
            ...validation,
            coupon: updatedCoupon,
            updatedConfig
        };
    }
};
