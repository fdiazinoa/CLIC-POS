package com.clicpos.app;

/** Activity-local, UI-thread policy; overlay changes never choose IME visibility. */
final class PosKeyboardWindowPolicy {
    private boolean hasResumed;
    private boolean preserveVisibility;

    void onResume() {
        preserveVisibility = hasResumed;
        hasResumed = true;
    }

    int resolveSoftInputMode(int initialState, int unchangedState, int adjustment) {
        return (preserveVisibility ? unchangedState : initialState) | adjustment;
    }
}
