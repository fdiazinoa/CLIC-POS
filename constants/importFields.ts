export const SYSTEM_FIELDS = {
    PRODUCT: [
        { id: 'sku', label: 'SKU (Código)', required: true },
        { id: 'name', label: 'Nombre del Producto', required: true },
        { id: 'price', label: 'Precio de Venta', required: true },
        { id: 'cost', label: 'Costo Unitario', required: false },
        { id: 'category', label: 'Categoría', required: false },
        { id: 'taxRate', label: 'Impuesto (0-1)', required: false },
        { id: 'barcode', label: 'Código de Barras', required: false },
        { id: 'parentSku', label: 'SKU Padre (Variantes)', required: false },
        { id: 'parentSku', label: 'SKU Padre (Variantes)', required: false },
        { id: 'variantName', label: 'Nombre Variante (Legacy)', required: false },
        { id: 'variantAttribute1', label: 'Atributo 1 (Ej: Talla)', required: false },
        { id: 'variantValue1', label: 'Valor 1 (Ej: M)', required: false },
        { id: 'variantAttribute2', label: 'Atributo 2 (Ej: Color)', required: false },
        { id: 'variantValue2', label: 'Valor 2 (Ej: Azul)', required: false },
        { id: 'stock', label: 'Stock Inicial', required: false },
    ],
    CUSTOMER: [
        { id: 'name', label: 'Nombre Completo', required: true },
        { id: 'taxId', label: 'RNC / Cédula', required: false },
        { id: 'email', label: 'Email', required: false },
        { id: 'phone', label: 'Teléfono', required: false },
        { id: 'address', label: 'Dirección', required: false },
        { id: 'creditLimit', label: 'Límite de Crédito', required: false },
    ],
    SUPPLIER: [
        { id: 'name', label: 'Nombre Empresa', required: true },
        { id: 'taxId', label: 'RNC', required: false },
        { id: 'contactName', label: 'Contacto', required: false },
        { id: 'email', label: 'Email', required: false },
        { id: 'phone', label: 'Teléfono', required: false },
    ],
    INVENTORY: [
        { id: 'sku', label: 'SKU', required: true },
        { id: 'quantity', label: 'Cantidad', required: true },
        { id: 'cost', label: 'Costo Unitario', required: false },
        { id: 'warehouseId', label: 'ID Almacén', required: false },
    ]
};

export const DEMO_DATA = {
    PRODUCT: {
        sku: 'CAM-001',
        name: 'Camisa Polo Azul',
        price: 1500.00,
        cost: 800.00,
        category: 'Ropa',
        taxRate: 0.18,
        barcode: '740000000001',
        parentSku: '',

        variantName: '',
        variantAttribute1: 'Talla',
        variantValue1: 'M',
        variantAttribute2: 'Color',
        variantValue2: 'Azul',
        stock: 50
    },
    CUSTOMER: {
        name: 'Juan Pérez',
        taxId: '001-0000000-1',
        email: 'juan.perez@email.com',
        phone: '809-555-1234',
        address: 'Av. Winston Churchill #100',
        creditLimit: 10000.00
    },
    SUPPLIER: {
        name: 'Distribuidora XYZ',
        taxId: '101-00000-1',
        contactName: 'María Rodríguez',
        email: 'ventas@xyz.com',
        phone: '809-555-5678'
    },
    INVENTORY: {
        sku: 'CAM-001',
        quantity: 10,
        cost: 800.00,
        warehouseId: 'MAIN'
    }
};
