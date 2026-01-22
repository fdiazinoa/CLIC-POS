import { Customer } from '../../types';

// Placeholder for 'google-auth-library'
// import { GoogleAuth } from 'google-auth-library';

export interface GoogleWalletConfig {
    issuerId: string;
    serviceAccountEmail: string;
    privateKey: string;
}

export class GooglePassGenerator {
    private config: GoogleWalletConfig;

    constructor(config: GoogleWalletConfig) {
        this.config = config;
    }

    /**
     * Generates a "Save to Google Wallet" JWT link.
     * @param customer The customer data
     * @returns Promise<string> The URL to add the pass
     */
    async generateSaveLink(customer: Customer): Promise<string> {
        console.log(`[GooglePassGenerator] Generating link for customer: ${customer.id}`);

        const loyaltyObject = {
            id: `${this.config.issuerId}.${customer.id}`,
            classId: `${this.config.issuerId}.loyalty_standard`,
            state: "ACTIVE",
            barcode: {
                type: "QR_CODE",
                value: this.getPrimaryCardNumber(customer)
            },
            accountId: customer.id,
            accountName: customer.name,
            loyaltyPoints: {
                label: "Puntos",
                balance: { string: this.getPrimaryLoyaltyPoints(customer).toString() }
            },
            textModulesData: [
                {
                    header: "Saldo Wallet",
                    body: `${customer.wallet?.balance || 0} DOP`
                }
            ]
        };

        // 2. Create JWT Claims (Mocked)
        const claims = {
            iss: this.config.serviceAccountEmail,
            aud: 'google',
            origins: ['www.clicpos.com'],
            typ: 'savetowallet',
            payload: {
                loyaltyObjects: [loyaltyObject]
            }
        };

        console.log('[GooglePassGenerator] JWT Claims constructed:', JSON.stringify(claims, null, 2));

        // 3. Sign JWT (Mocked)
        // const token = signJwt(claims, this.config.privateKey);
        const mockToken = `MOCK_JWT_TOKEN_${customer.id}`;

        // 4. Return Link
        return `https://pay.google.com/gp/v/save/${mockToken}`;
    }

    private getPrimaryLoyaltyPoints(customer: Customer): number {
        const primaryCard = customer.cards?.find(c => c.type === 'LOYALTY' && c.status === 'ACTIVE') || customer.loyalty;
        return primaryCard?.pointsBalance || 0;
    }

    private getPrimaryCardNumber(customer: Customer): string {
        const primaryCard = customer.cards?.find(c => c.type === 'LOYALTY' && c.status === 'ACTIVE') || customer.loyalty;
        return primaryCard?.cardNumber || 'N/A';
    }
}
