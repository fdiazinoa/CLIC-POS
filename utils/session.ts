import { TerminalConfig } from '../types';

/**
 * Determines if the current session is expired based on the operational business day.
 * 
 * @param sessionOpenDate The date when the session was opened (Date object or ISO string)
 * @param config The terminal configuration containing the business start hour
 * @returns true if the session belongs to a previous operational day
 */
export const isSessionExpired = (
    sessionOpenDate: Date | string,
    config: TerminalConfig
): boolean => {
    if (!config.workflow.session.forceZChange) {
        return false;
    }

    const businessStartHour = config.workflow.session.businessStartHour || 0;
    const now = new Date();
    const sessionDate = new Date(sessionOpenDate);

    // Helper to get the "Operational Date" (the date the business day started)
    const getOperationalDate = (date: Date, startHour: number): Date => {
        const opDate = new Date(date);
        // If the current hour is before the start hour, it belongs to the previous calendar day
        if (date.getHours() < startHour) {
            opDate.setDate(opDate.getDate() - 1);
        }
        opDate.setHours(0, 0, 0, 0); // Normalize to midnight
        return opDate;
    };

    const currentOperationalDate = getOperationalDate(now, businessStartHour);
    const sessionOperationalDate = getOperationalDate(sessionDate, businessStartHour);

    // If the current operational date is strictly after the session's operational date,
    // it means we have crossed into a new business day.
    return currentOperationalDate.getTime() > sessionOperationalDate.getTime();
};
