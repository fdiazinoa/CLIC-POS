
import { User } from '../types';

/**
 * Service to handle WebAuthn Biometric Authentication
 */

export interface PublicKeyCredentialCreationOptionsJSON {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { alg: number; type: "public-key" }[];
    timeout: number;
    attestation: "none" | "direct" | "indirect";
    authenticatorSelection: {
        authenticatorAttachment?: "platform" | "cross-platform";
        userVerification: "required" | "preferred" | "discouraged";
        requireResidentKey?: boolean;
    };
}

// Helper functions for ArrayBuffer <-> Base64
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export const biometricService = {
    /**
     * Check if biometrics are available on this device
     */
    isAvailable: async (): Promise<boolean> => {
        if (!window.PublicKeyCredential) return false;
        try {
            return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        } catch (e) {
            console.error("Biometric availability check failed", e);
            return false;
        }
    },

    /**
     * Register a new biometric credential (Enrollment)
     */
    register: async (user: User): Promise<{ credentialID: string; publicKey: string } | null> => {
        try {
            // Generate random challenge
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
                challenge,
                rp: {
                    name: "CLIC POS",
                    id: window.location.hostname, // Important: must match current domain
                },
                user: {
                    id: Uint8Array.from(user.id, c => c.charCodeAt(0)),
                    name: user.name,
                    displayName: user.name,
                },
                pubKeyCredParams: [
                    { alg: -7, type: "public-key" }, // ES256
                    { alg: -257, type: "public-key" } // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    userVerification: "preferred", // Change to preferred to avoid immediate exclusion on some devices
                },
                timeout: 60000,
                attestation: "none"
            };

            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            }) as PublicKeyCredential;

            if (!credential) return null;

            // In a real app, we would send this to backend. 
            // Here we store minimal data for local simulation or basic validation.
            const rawId = bufferToBase64(credential.rawId);

            return {
                credentialID: rawId,
                publicKey: 'stored_on_server_simulation' // Simplified for this demo
            };

        } catch (error) {
            console.error("Biometric registration failed", error);
            throw error;
        }
    },

    /**
     * Verify user identity (Login)
     * Supports multi-user identification by passing all allowed credential IDs
     */
    verify: async (credentialIDs: string[]): Promise<string | null> => {
        try {
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);

            const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
                challenge,
                allowCredentials: credentialIDs.map(id => ({
                    id: base64ToBuffer(id),
                    type: 'public-key',
                    transports: ['internal']
                })),
                rpId: window.location.hostname,
                userVerification: 'preferred',
                timeout: 60000,
            };

            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            }) as PublicKeyCredential;

            if (assertion) {
                return bufferToBase64(assertion.rawId);
            }

            return null;
        } catch (error) {
            console.error("Biometric verification failed", error);
            return null;
        }
    }
};
