import React, { useState } from 'react';
import { AlertTriangle, Database, X, Trash2 } from 'lucide-react';

interface FactoryResetModalProps {
    onClose: () => void;
    onConfirm: (selectedCategories: ResetCategory[]) => void;
}

export interface ResetCategory {
    id: string;
    name: string;
    description: string;
    collections: string[];
    dependsOn?: string[];  // Categories that must be deleted if this is deleted
    cascadeDeletes?: string[];  // Categories that will be auto-deleted with this one
}

const RESET_CATEGORIES: ResetCategory[] = [
    {
        id: 'products',
        name: 'Artículos',
        description: 'Catálogo de productos, variantes, precios y costos',
        collections: ['products'],
        cascadeDeletes: ['inventory_ledger']
    },
    {
        id: 'tariffs',
        name: 'Tarifas',
        description: 'Listas de precios y tarifas especiales',
        collections: ['config.tariffs']
    },
    {
        id: 'suppliers',
        name: 'Proveedores',
        description: 'Base de datos de proveedores',
        collections: ['suppliers'],
        cascadeDeletes: ['purchase_orders']
    },
    {
        id: 'customers',
        name: 'Clientes',
        description: 'Base CRM con historial y puntos de fidelidad',
        collections: ['customers'],
        cascadeDeletes: ['transactions']
    },
    {
        id: 'stock',
        name: 'Stock/Existencias',
        description: 'Saldos actuales de inventario por almacén',
        collections: ['products.stockBalances'],
        cascadeDeletes: ['inventory_ledger']
    },
    {
        id: 'transactions',
        name: 'Facturas/Tickets',
        description: 'Ventas realizadas (transacciones)',
        collections: ['transactions'],
        dependsOn: ['customers'],
        cascadeDeletes: ['z_reports', 'accounts_receivable']
    },
    {
        id: 'credit_notes',
        name: 'Notas de Crédito',
        description: 'Devoluciones y notas de crédito',
        collections: ['transactions.refunded']
    },
    {
        id: 'purchase_orders',
        name: 'Pedidos de Compra',
        description: 'Órdenes de compra a proveedores',
        collections: ['purchaseOrders'],
        dependsOn: ['suppliers']
    },
    {
        id: 'purchase_reception',
        name: 'Recepción de Mercancía',
        description: 'Registros de recepciones de compras',
        collections: ['purchaseOrders.received', 'receptions']
    },
    {
        id: 'inventory_ledger',
        name: 'Kardex (Movimientos)',
        description: 'Historial detallado de movimientos de inventario',
        collections: ['inventoryLedger'],
        dependsOn: ['products', 'stock']
    },
    {
        id: 'accounts_receivable',
        name: 'Cuentas por Cobrar',
        description: 'Saldos pendientes de clientes',
        collections: ['accountsReceivable'],
        dependsOn: ['transactions']
    },
    {
        id: 'z_reports',
        name: 'Cierres Z',
        description: 'Reportes de cierre diario',
        collections: ['zReports'],
        dependsOn: ['transactions']
    },
    {
        id: 'cash_movements',
        name: 'Movimientos de Caja',
        description: 'Entradas y salidas de efectivo',
        collections: ['cashMovements']
    }
];

const FactoryResetModal: React.FC<FactoryResetModalProps> = ({ onClose, onConfirm }) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showWarning, setShowWarning] = useState(false);

    const toggleCategory = (categoryId: string) => {
        const newSelected = new Set(selectedIds);

        if (newSelected.has(categoryId)) {
            newSelected.delete(categoryId);

            // Remove cascaded items
            const category = RESET_CATEGORIES.find(c => c.id === categoryId);
            if (category?.cascadeDeletes) {
                category.cascadeDeletes.forEach(id => newSelected.delete(id));
            }
        } else {
            newSelected.add(categoryId);

            // Auto-select cascaded items
            const category = RESET_CATEGORIES.find(c => c.id === categoryId);
            if (category?.cascadeDeletes) {
                category.cascadeDeletes.forEach(id => newSelected.add(id));
            }
        }

        setSelectedIds(newSelected);
        setShowWarning(newSelected.size > 0);
    };

    const getCategoryStyle = (category: ResetCategory) => {
        const isSelected = selectedIds.has(category.id);
        const isDisabled = category.dependsOn?.some(dep => !selectedIds.has(dep));
        const isCascaded = RESET_CATEGORIES.some(c =>
            selectedIds.has(c.id) && c.cascadeDeletes?.includes(category.id)
        );

        if (isDisabled) return 'opacity-50 cursor-not-allowed';
        if (isCascaded) return 'bg-orange-50 border-orange-300';
        if (isSelected) return 'bg-red-50 border-red-500';
        return 'hover:bg-gray-50';
    };

    const handleConfirm = () => {
        if (selectedIds.size === 0) {
            alert('Debe seleccionar al menos una categoría para eliminar.');
            return;
        }

        const categories = RESET_CATEGORIES.filter(c => selectedIds.has(c.id));
        onConfirm(categories);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white p-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertTriangle size={32} />
                        <div>
                            <h2 className="text-2xl font-bold">Reinicio de Fábrica</h2>
                            <p className="text-red-100 text-sm">Seleccione los datos a eliminar</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="hover:bg-white/20 p-2 rounded">
                        <X size={24} />
                    </button>
                </div>

                {/* Warning Banner */}
                {showWarning && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 flex items-start gap-3">
                        <AlertTriangle className="text-yellow-600 flex-shrink-0" size={20} />
                        <div className="text-sm text-yellow-800">
                            <p className="font-semibold">⚠️ ADVERTENCIA: Esta acción NO se puede deshacer</p>
                            <p className="mt-1">Los datos marcados serán eliminados permanentemente. Algunos elementos se eliminarán automáticamente por integridad referencial.</p>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="overflow-y-auto flex-1 p-6">
                    <div className="grid gap-3">
                        {/* Catálogos Maestros */}
                        <div>
                            <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                                <Database size={18} className="text-blue-600" />
                                Catálogos Maestros
                            </h3>
                            <div className="grid gap-2 ml-6">
                                {RESET_CATEGORIES.filter(c =>
                                    ['products', 'tariffs', 'suppliers', 'customers', 'stock'].includes(c.id)
                                ).map(category => (
                                    <CategoryCheckbox
                                        key={category.id}
                                        category={category}
                                        isSelected={selectedIds.has(category.id)}
                                        onToggle={toggleCategory}
                                        style={getCategoryStyle(category)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Documentos Comerciales */}
                        <div className="mt-4">
                            <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                                <Trash2 size={18} className="text-purple-600" />
                                Documentos Comerciales
                            </h3>
                            <div className="grid gap-2 ml-6">
                                {RESET_CATEGORIES.filter(c =>
                                    ['transactions', 'credit_notes', 'accounts_receivable'].includes(c.id)
                                ).map(category => (
                                    <CategoryCheckbox
                                        key={category.id}
                                        category={category}
                                        isSelected={selectedIds.has(category.id)}
                                        onToggle={toggleCategory}
                                        style={getCategoryStyle(category)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Compras e Inventarios */}
                        <div className="mt-4">
                            <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                                <Trash2 size={18} className="text-green-600" />
                                Compras e Inventarios
                            </h3>
                            <div className="grid gap-2 ml-6">
                                {RESET_CATEGORIES.filter(c =>
                                    ['purchase_orders', 'purchase_reception', 'inventory_ledger'].includes(c.id)
                                ).map(category => (
                                    <CategoryCheckbox
                                        key={category.id}
                                        category={category}
                                        isSelected={selectedIds.has(category.id)}
                                        onToggle={toggleCategory}
                                        style={getCategoryStyle(category)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Operaciones */}
                        <div className="mt-4">
                            <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                                <Trash2 size={18} className="text-indigo-600" />
                                Operaciones
                            </h3>
                            <div className="grid gap-2 ml-6">
                                {RESET_CATEGORIES.filter(c =>
                                    ['z_reports', 'cash_movements'].includes(c.id)
                                ).map(category => (
                                    <CategoryCheckbox
                                        key={category.id}
                                        category={category}
                                        isSelected={selectedIds.has(category.id)}
                                        onToggle={toggleCategory}
                                        style={getCategoryStyle(category)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="mt-6 pt-4 border-t border-gray-200">
                        <p className="text-xs text-gray-600 mb-2 font-semibold">Leyenda:</p>
                        <div className="grid gap-1 text-xs text-gray-600">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-red-500 bg-red-50"></div>
                                <span>Seleccionado manualmente</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-orange-300 bg-orange-50"></div>
                                <span>Se eliminará automáticamente (integridad referencial)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-gray-300 bg-gray-100 opacity-50"></div>
                                <span>Deshabilitado (requiere otra categoría)</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 p-4 flex justify-between items-center border-t">
                    <p className="text-sm text-gray-600">
                        {selectedIds.size} categoría(s) seleccionada(s)
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={selectedIds.size === 0}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                        >
                            <Trash2 size={18} />
                            Eliminar Datos Seleccionados
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface CategoryCheckboxProps {
    category: ResetCategory;
    isSelected: boolean;
    onToggle: (id: string) => void;
    style: string;
}

const CategoryCheckbox: React.FC<CategoryCheckboxProps> = ({ category, isSelected, onToggle, style }) => {
    // Checkbox is disabled if it depends on unselected categories
    const isDisabled = false; // Dependencies are enforced by UI logic, not at checkbox level

    return (
        <label className={`border-2 rounded-lg p-3 cursor-pointer transition ${style}`}>
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(category.id)}
                    disabled={isDisabled}
                    data-category={category.id}
                    className="mt-1 w-4 h-4 accent-red-600"
                />
                <div className="flex-1">
                    <p className="font-semibold text-sm text-gray-800">{category.name}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{category.description}</p>
                    {category.cascadeDeletes && category.cascadeDeletes.length > 0 && (
                        <p className="text-xs text-orange-600 mt-1">
                            ⚠️ Eliminará también: {category.cascadeDeletes.map(id =>
                                RESET_CATEGORIES.find(c => c.id === id)?.name
                            ).join(', ')}
                        </p>
                    )}
                </div>
            </div>
        </label>
    );
};

export default FactoryResetModal;
