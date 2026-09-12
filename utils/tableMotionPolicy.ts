export interface TableMotionPolicyInput {
    prefersReducedMotion: boolean;
    isNativePlatform: boolean;
    platform: string;
}

/**
 * Continuous glows are useful on desktop, but expensive in an Android WebView
 * where several occupied tables can otherwise keep the render loop active.
 */
export const shouldReduceTableMotion = ({
    prefersReducedMotion,
    isNativePlatform,
    platform
}: TableMotionPolicyInput): boolean => (
    prefersReducedMotion || (isNativePlatform && platform === 'android')
);
