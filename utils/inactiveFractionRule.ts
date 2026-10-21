/** A proven inactive editor rule carries no fraction behavior. Unknown/malformed rules remain unsupported. */
export function isInactiveFractionRule(input: unknown): boolean {
    const value = input as Record<string, any>;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.enabled !== false) return false;
    const keys = ['enabled', 'fraction_mode', 'pricing_rule', 'max_parts', 'require_equal_parts', 'options'];
    if (Object.keys(value).some(key => !keys.includes(key))) return false;
    if (value.fraction_mode !== undefined && !['HALF', 'QUARTER', 'CUSTOM'].includes(value.fraction_mode)) return false;
    if (value.pricing_rule !== undefined && !['HIGHEST_PRICE', 'AVERAGE_PRICE', 'SUM_PARTS', 'BASE_PLUS_DIFF'].includes(value.pricing_rule)) return false;
    if (value.max_parts !== undefined && (!Number.isSafeInteger(value.max_parts) || value.max_parts < 1 || value.max_parts > 100)) return false;
    if (value.require_equal_parts !== undefined && typeof value.require_equal_parts !== 'boolean') return false;
    if (value.options !== undefined) {
        if (!Array.isArray(value.options) || value.options.length > 100) return false;
        for (const option of value.options) {
            if (!option || typeof option !== 'object' || Array.isArray(option)
                || typeof option.id !== 'string' || !option.id.trim() || option.id.length > 128
                || typeof option.option_product_id !== 'string' || !option.option_product_id.trim() || option.option_product_id.length > 128
                || typeof option.active !== 'boolean' || !Number.isSafeInteger(option.sort_order) || option.sort_order < 0
                || Object.keys(option).some(key => !['id', 'option_product_id', 'name', 'price_override', 'active', 'sort_order'].includes(key))
                || option.name !== undefined && (typeof option.name !== 'string' || option.name.length > 256)
                || option.price_override != null && (typeof option.price_override !== 'number' || !Number.isFinite(option.price_override) || option.price_override < 0)) return false;
        }
    }
    return true;
}
