import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle, AlertTriangle, Loader2, Download, XCircle } from 'lucide-react';
import { BusinessConfig, Product, Customer, Supplier, Warehouse } from '../../types';
import { ImportMode, ImportJob, ImportError } from '../../types/importExport';
import { SYSTEM_FIELDS } from '../../constants/importFields';

interface Step4ProcessingProps {
    data: any[];
    mapping: { [key: string]: string };
    entityType: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY';
    importMode: ImportMode;
    config: BusinessConfig;
    products: Product[];
    customers: Customer[];
    suppliers: Supplier[];
    warehouses: Warehouse[];
    onUpdateProducts: (products: Product[]) => Promise<void>;
    onUpdateCustomers: (customers: Customer[]) => Promise<void>;
    onUpdateSuppliers: (suppliers: Supplier[]) => Promise<void>;
    onUpdateWarehouses: (warehouses: Warehouse[]) => Promise<void>;
    onClose: () => void;
}

const Step4Processing: React.FC<Step4ProcessingProps> = ({
    data,
    mapping,
    entityType,
    importMode,
    config,
    products,
    customers,
    suppliers,
    warehouses,
    onUpdateProducts,
    onUpdateCustomers,
    onUpdateSuppliers,
    onUpdateWarehouses,
    onClose
}) => {
    const [job, setJob] = useState<ImportJob>({
        id: 'JOB-' + Date.now(),
        status: 'IDLE',
        totalRows: data.length,
        processedRows: 0,
        successCount: 0,
        errorCount: 0,
        errors: []
    });

    const processedRef = useRef(false);

    useEffect(() => {
        if (processedRef.current) return;
        processedRef.current = true;
        processData();
    }, []);

    const processData = async () => {
        setJob(prev => ({ ...prev, status: 'PROCESSING' }));

        const errors: ImportError[] = [];
        let successCount = 0;

        // Helper to get value from row based on mapping
        const getValue = (row: any, fieldId: string) => {
            const header = mapping[fieldId];
            return header ? row[header] : undefined;
        };

        try {
            if (entityType === 'PRODUCT') {
                const currentProducts = [...products];
                // Use barcode as the key for products since they don't have SKU at top level
                const productsMap = new Map(currentProducts.map(p => [p.barcode || p.id, p]));

                // 1. Process Parents & Standalone
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const sku = getValue(row, 'sku'); // This maps to barcode for products
                    const parentSku = getValue(row, 'parentSku');

                    if (!sku) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: 'SKU/Barcode is missing' });
                        continue;
                    }

                    // Skip variants in first pass
                    if (parentSku) continue;

                    try {
                        const product: Product = {
                            id: productsMap.get(sku)?.id || crypto.randomUUID(),
                            name: String(getValue(row, 'name') || 'Unnamed Product'),
                            price: parseFloat(getValue(row, 'price')) || 0,
                            cost: parseFloat(getValue(row, 'cost')) || 0,
                            category: String(getValue(row, 'category') || 'General'),
                            // Map SKU column to barcode field for the product
                            barcode: String(sku),
                            stock: parseFloat(getValue(row, 'stock')) || 0,
                            minStock: 0,
                            variants: [],
                            // modifiers: [], // Removed as it might not be in the strict type or optional
                            images: [],
                            attributes: [],
                            tariffs: [],
                            appliedTaxIds: []
                        };

                        productsMap.set(sku, product);
                        successCount++;
                    } catch (e) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: (e as Error).message });
                    }

                    // Update progress periodically
                    if (i % 50 === 0) setJob(prev => ({ ...prev, processedRows: i }));
                }

                // 2. Process Variants
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const sku = getValue(row, 'sku');
                    const parentSku = getValue(row, 'parentSku');

                    if (!parentSku) continue;

                    const parent = productsMap.get(parentSku);
                    if (!parent) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: `Parent SKU ${parentSku} not found` });
                        continue;
                    }

                    try {
                        const variantName = String(getValue(row, 'variantName') || sku);
                        const price = parseFloat(getValue(row, 'price')) || parent.price;

                        // Check if variant exists
                        const existingVariantIndex = parent.variants?.findIndex(v => v.sku === sku);

                        // Construct attributeValues dynamically
                        const attributeValues: Record<string, string> = {};

                        const attr1 = getValue(row, 'variantAttribute1');
                        const val1 = getValue(row, 'variantValue1');
                        if (attr1 && val1) attributeValues[String(attr1)] = String(val1);

                        const attr2 = getValue(row, 'variantAttribute2');
                        const val2 = getValue(row, 'variantValue2');
                        if (attr2 && val2) attributeValues[String(attr2)] = String(val2);

                        // Fallback to legacy variantName if no attributes defined
                        if (Object.keys(attributeValues).length === 0) {
                            attributeValues['Variant'] = variantName;
                        }

                        // Construct valid ProductVariant
                        const newVariant = {
                            sku: String(sku),
                            barcode: [String(sku)], // Default barcode to SKU
                            attributeValues: attributeValues,
                            price: price,
                            initialStock: parseFloat(getValue(row, 'stock')) || 0
                        };

                        if (!parent.variants) parent.variants = [];

                        if (existingVariantIndex !== undefined && existingVariantIndex >= 0) {
                            parent.variants[existingVariantIndex] = newVariant;
                        } else {
                            parent.variants.push(newVariant);
                        }

                        // Update parent in map (key is parent barcode/sku)
                        if (parent.barcode) {
                            productsMap.set(parent.barcode, parent);
                        }
                        successCount++;
                    } catch (e) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: (e as Error).message });
                    }
                }

                await onUpdateProducts(Array.from(productsMap.values()));
            }

            else if (entityType === 'INVENTORY') {
                const currentProducts = [...products];
                // Map by barcode (which acts as SKU for standalone) OR check variants
                const productsMap = new Map(currentProducts.map(p => [p.barcode, p]));

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const sku = getValue(row, 'sku');
                    const qty = parseFloat(getValue(row, 'quantity'));
                    const cost = parseFloat(getValue(row, 'cost'));

                    if (!sku || isNaN(qty)) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: 'Invalid SKU or Quantity' });
                        continue;
                    }

                    // Try to find product by barcode
                    let product = productsMap.get(sku);

                    // If not found, it might be a variant SKU. 
                    // Complex logic needed to find product by variant SKU.
                    if (!product) {
                        product = currentProducts.find(p => p.variants?.some(v => v.sku === sku));
                    }

                    if (!product) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: `Product SKU ${sku} not found` });
                        continue;
                    }

                    if (importMode === 'ABSOLUTE') {
                        product.stock = qty;
                        if (!isNaN(cost)) product.cost = cost;
                    } else {
                        // Additive (Weighted Average Cost)
                        const currentQty = product.stock || 0;
                        const currentCost = product.cost || 0;
                        const newQty = currentQty + qty;

                        if (newQty > 0 && !isNaN(cost)) {
                            const totalValue = (currentQty * currentCost) + (qty * cost);
                            product.cost = totalValue / newQty;
                        }
                        product.stock = newQty;
                    }

                    // Update the map/list. If it was found via variant, we need to make sure we update the main product list correctly.
                    // Since productsMap is keyed by barcode, if we found it by variant, we might need to update it in the map using its barcode.
                    if (product.barcode) {
                        productsMap.set(product.barcode, product);
                    }

                    successCount++;
                    if (i % 50 === 0) setJob(prev => ({ ...prev, processedRows: i }));
                }

                await onUpdateProducts(Array.from(productsMap.values()).filter(p => p !== undefined) as Product[]);
            }

            else if (entityType === 'CUSTOMER') {
                const currentCustomers = [...customers];
                // Map by TaxID or Email or Name as fallback unique key
                // For simplicity, we'll use ID if provided or generate new

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    const name = getValue(row, 'name');

                    if (!name) {
                        errors.push({ rowIndex: i + 1, rowData: row, reason: 'Name is required' });
                        continue;
                    }

                    const newCustomer: Customer = {
                        id: crypto.randomUUID(),
                        name: String(name),
                        taxId: getValue(row, 'taxId'),
                        email: getValue(row, 'email'),
                        phone: getValue(row, 'phone'),
                        address: getValue(row, 'address'),
                        creditLimit: parseFloat(getValue(row, 'creditLimit')) || 0,
                        currentDebt: 0,
                        loyaltyPoints: 0 // Fixed property name
                    };

                    // Simple append for now (no dedup logic implemented in this snippet for brevity)
                    currentCustomers.push(newCustomer);
                    successCount++;
                }
                await onUpdateCustomers(currentCustomers);
            }

            setJob(prev => ({
                ...prev,
                status: errors.length > 0 ? 'COMPLETED' : 'COMPLETED', // Could be 'FAILED' if all failed
                processedRows: data.length,
                successCount,
                errorCount: errors.length,
                errors
            }));

        } catch (e) {
            console.error(e);
            setJob(prev => ({ ...prev, status: 'FAILED', errorCount: prev.errorCount + 1 }));
        }
    };

    const downloadErrors = () => {
        const csvContent = "data:text/csv;charset=utf-8,"
            + "Row,Reason,Data\n"
            + job.errors.map(e => `${e.rowIndex},"${e.reason}","${JSON.stringify(e.rowData).replace(/"/g, '""')}"`).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "import_errors.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in">
            {job.status === 'PROCESSING' && (
                <div className="text-center space-y-4">
                    <Loader2 size={64} className="animate-spin text-blue-600 mx-auto" />
                    <h2 className="text-2xl font-bold text-gray-900">Procesando Datos...</h2>
                    <p className="text-gray-500">Por favor espera, esto puede tomar unos momentos.</p>
                    <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden mx-auto">
                        <div
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${(job.processedRows / job.totalRows) * 100}%` }}
                        />
                    </div>
                    <p className="text-xs text-gray-400">{job.processedRows} / {job.totalRows} filas</p>
                </div>
            )}

            {(job.status === 'COMPLETED' || job.status === 'FAILED') && (
                <div className="text-center space-y-6 max-w-lg w-full">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto ${job.errorCount === 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-yellow-100 text-yellow-600'}`}>
                        {job.errorCount === 0 ? <CheckCircle size={48} /> : <AlertTriangle size={48} />}
                    </div>

                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">
                            {job.errorCount === 0 ? 'Importación Exitosa' : 'Importación Completada con Errores'}
                        </h2>
                        <p className="text-gray-500 mt-2">
                            Se procesaron {job.successCount} registros correctamente.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-center">
                        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                            <p className="text-2xl font-black text-emerald-600">{job.successCount}</p>
                            <p className="text-xs font-bold text-emerald-700 uppercase">Exitosos</p>
                        </div>
                        <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                            <p className="text-2xl font-black text-red-600">{job.errorCount}</p>
                            <p className="text-xs font-bold text-red-700 uppercase">Fallidos</p>
                        </div>
                    </div>

                    {job.errorCount > 0 && (
                        <button
                            onClick={downloadErrors}
                            className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 flex items-center justify-center gap-2"
                        >
                            <Download size={20} /> Descargar Reporte de Errores
                        </button>
                    )}

                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50"
                    >
                        Cerrar Asistente
                    </button>
                </div>
            )}
        </div>
    );
};

export default Step4Processing;
