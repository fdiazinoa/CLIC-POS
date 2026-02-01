
/**
 * Utility for robust date parsing and formatting to prevent "Invalid Date" in UI.
 * Handles ISO strings, timestamps, and numeric strings.
 */

export const formatSafeDate = (dateValue: any, showTime: boolean = false): string => {
    if (!dateValue) return 'N/A';

    let d = new Date(dateValue);

    // If invalid, try parsing as a numeric string (timestamp)
    if (isNaN(d.getTime())) {
        if (typeof dateValue === 'string' && /^\d+$/.test(dateValue)) {
            d = new Date(parseInt(dateValue));
        }
    }

    // Final check
    if (isNaN(d.getTime())) {
        // As a last resort, if it's a string like "REC-1234..." 
        // we might have the timestamp in the string itself
        if (typeof dateValue === 'string' && dateValue.includes('-')) {
            const parts = dateValue.split('-');
            const lastPart = parts[parts.length - 1];
            if (/^\d+$/.test(lastPart)) {
                d = new Date(parseInt(lastPart));
            }
        }
    }

    if (isNaN(d.getTime())) return 'Fecha inv.';

    if (showTime) {
        return d.toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return d.toLocaleDateString();
};

/**
 * Specifically returns only the time part
 */
export const formatSafeTime = (dateValue: any): string => {
    const d = new Date(dateValue);
    let finalDate = d;

    if (isNaN(d.getTime())) {
        if (typeof dateValue === 'string' && /^\d+$/.test(dateValue)) {
            finalDate = new Date(parseInt(dateValue));
        }
    }

    if (isNaN(finalDate.getTime())) return '--:--';

    return finalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
