/**
 * Export Utilities
 * Handles conversion of JSON data to CSV and triggers browser downloads.
 */

export const ExportUtils = {
    /**
     * Convert an array of objects to a CSV string
     */
    jsonToCsv: (data: any[]): string => {
        if (!data || data.length === 0) return '';

        // Extract headers from the first object
        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Add header row
        csvRows.push(headers.join(','));

        // Add data rows
        for (const row of data) {
            const values = headers.map(header => {
                const val = row[header];
                const escaped = ('' + val).replace(/"/g, '""'); // Escape double quotes
                return `"${escaped}"`; // Wrap in quotes to handle commas in data
            });
            csvRows.push(values.join(','));
        }

        return csvRows.join('\n');
    },

    /**
     * Trigger a browser download for a string content
     */
    downloadFile: (content: string, fileName: string, contentType: string) => {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 100);
    },

    /**
     * Export data as CSV
     */
    exportAsCsv: (data: any[], fileName: string) => {
        const csv = ExportUtils.jsonToCsv(data);
        ExportUtils.downloadFile(csv, `${fileName}.csv`, 'text/csv;charset=utf-8;');
    },

    /**
     * Export data as JSON
     */
    exportAsJson: (data: any[], fileName: string) => {
        const json = JSON.stringify(data, null, 2);
        ExportUtils.downloadFile(json, `${fileName}.json`, 'application/json;charset=utf-8;');
    }
};
