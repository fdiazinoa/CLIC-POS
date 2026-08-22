export type AuthenticatedSyncActivity = 'PULL' | 'PUSH' | 'ACK' | 'HEARTBEAT';

export type AuthenticatedActivitySnapshot = {
    lastAuthenticatedActivityAt: number;
    lastPullAt: number;
    lastPushAt: number;
    lastAckAt: number;
    lastHeartbeatAt: number;
};

const emptySnapshot = (): AuthenticatedActivitySnapshot => ({
    lastAuthenticatedActivityAt: 0,
    lastPullAt: 0,
    lastPushAt: 0,
    lastAckAt: 0,
    lastHeartbeatAt: 0,
});

class AuthenticatedActivityTracker {
    private snapshot = emptySnapshot();

    record(activity: AuthenticatedSyncActivity, at = Date.now()): void {
        this.snapshot.lastAuthenticatedActivityAt = Math.max(this.snapshot.lastAuthenticatedActivityAt, at);
        if (activity === 'PULL') this.snapshot.lastPullAt = at;
        if (activity === 'PUSH') this.snapshot.lastPushAt = at;
        if (activity === 'ACK') this.snapshot.lastAckAt = at;
        if (activity === 'HEARTBEAT') this.snapshot.lastHeartbeatAt = at;
    }

    getSnapshot(): AuthenticatedActivitySnapshot {
        return { ...this.snapshot };
    }

    hasRecentActivity(windowMs: number, now = Date.now()): boolean {
        return this.snapshot.lastAuthenticatedActivityAt > 0
            && now - this.snapshot.lastAuthenticatedActivityAt < windowMs;
    }

    reset(): void {
        this.snapshot = emptySnapshot();
    }
}

export const authenticatedActivityTracker = new AuthenticatedActivityTracker();
