export interface ImportMappingTemplate {
    id: string;
    name: string;
    entityType: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY';
    fileFormat: 'CSV' | 'JSON' | 'TXT';
    delimiter?: string;
    mapping: {
        [systemField: string]: string;
    };
    defaults?: {
        [systemField: string]: any;
    };
}

export interface ImportError {
    rowIndex: number;
    rowData: any;
    reason: string;
}

export interface ImportJob {
    id: string;
    status: 'IDLE' | 'PARSING' | 'VALIDATING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    totalRows: number;
    processedRows: number;
    successCount: number;
    errorCount: number;
    errors: ImportError[];
}

export type ImportMode = 'ADDITIVE' | 'ABSOLUTE' | 'UPSERT';
