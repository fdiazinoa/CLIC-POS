import Papa from 'papaparse';

export const parseFile = (file: File): Promise<{ data: any[]; headers: string[] }> => {
    return new Promise((resolve, reject) => {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        if (fileExtension === 'json') {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target?.result as string);
                    const data = Array.isArray(json) ? json : [json];
                    const headers = data.length > 0 ? Object.keys(data[0]) : [];
                    resolve({ data, headers });
                } catch (error) {
                    reject(new Error("Invalid JSON file"));
                }
            };
            reader.onerror = () => reject(new Error("Error reading file"));
            reader.readAsText(file);
        } else {
            // CSV or TXT
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    if (results.errors.length > 0) {
                        // We might want to handle specific parsing errors here
                        console.warn("CSV Parsing warnings:", results.errors);
                    }
                    resolve({
                        data: results.data,
                        headers: results.meta.fields || []
                    });
                },
                error: (error) => {
                    reject(error);
                }
            });
        }
    });
};
