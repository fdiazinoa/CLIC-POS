package com.clicpos.app;

/** Executes the production policy, not a copied TS model or Android lifecycle emulator. */
public final class PosKeyboardWindowPolicyHarness {
    private static final int STATE_UNSPECIFIED = 0x00;
    private static final int STATE_UNCHANGED = 0x01;
    private static final int ADJUST_RESIZE = 0x10;
    private static final int ADJUST_NOTHING = 0x30;
    private static final int STATE_MASK = 0x0f;
    private static final int ADJUST_MASK = 0xf0;
    private static int checks;

    private static void expectMode(PosKeyboardWindowPolicy policy, int state, int adjustment, String stage) {
        int actual = policy.resolveSoftInputMode(STATE_UNSPECIFIED, STATE_UNCHANGED, adjustment);
        if (actual != (state | adjustment)
                || (actual & STATE_MASK) != state
                || (actual & ADJUST_MASK) != adjustment) {
            throw new AssertionError(stage + ": incorrect state/adjustment " + actual);
        }
        checks++;
    }

    private static void expectBothAdjustments(PosKeyboardWindowPolicy policy, int state, String stage) {
        expectMode(policy, state, ADJUST_RESIZE, stage + " resize");
        expectMode(policy, state, ADJUST_NOTHING, stage + " overlay");
        // Delayed overlay enforcement must read the current lifecycle decision, not reset it.
        expectMode(policy, state, ADJUST_RESIZE, stage + " overlay disabled");
    }

    public static void main(String[] args) {
        PosKeyboardWindowPolicy policy = new PosKeyboardWindowPolicy();
        expectBothAdjustments(policy, STATE_UNSPECIFIED, "onCreate");
        policy.onResume();
        expectBothAdjustments(policy, STATE_UNSPECIFIED, "first resume");
        policy.onResume();
        expectBothAdjustments(policy, STATE_UNCHANGED, "second resume");
        policy.onResume();
        expectBothAdjustments(policy, STATE_UNCHANGED, "third resume");

        PosKeyboardWindowPolicy recreated = new PosKeyboardWindowPolicy();
        expectBothAdjustments(recreated, STATE_UNSPECIFIED, "new Activity instance");
        recreated.onResume();
        expectBothAdjustments(recreated, STATE_UNSPECIFIED, "recreated first resume");
        expectBothAdjustments(policy, STATE_UNCHANGED, "original instance remains independent");
        recreated.onResume();
        expectBothAdjustments(recreated, STATE_UNCHANGED, "recreated second resume");
        System.out.println("PASS: production PosKeyboardWindowPolicy " + checks + " state/mask checks");
    }
}
