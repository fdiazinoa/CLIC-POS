import type { CartItem, Product } from '../../types';
import type { ArticleFormat, ArticleFormatsDTO } from './contract';
import { ArticleFormatError, addQuantities, freezeLine, inventoryQuantity, resizeLine } from './domain';

export function addFormatLine(cart: CartItem[], product: Product, format: ArticleFormat, quantity: number,
  price: number, lineId: string, modifiers: string[] = []): CartItem[] {
  if (!format.active || !format.allow_sale || !product.article_formats?.formats.some(f => f.id === format.id && f.variantId === format.variantId)) throw new ArticleFormatError('ARTICLE_FORMAT_NOT_SELLABLE');
  if (quantity <= 0) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_QUANTITY');
  const variantSku = format.variantId === null ? undefined : product.articleFormatVariantSkus ? product.articleFormatVariantSkus[format.variantId] : format.variantId;
  if (format.variantId !== null && (typeof variantSku !== 'string' || product.variants.filter(variant => variant.sku === variantSku).length !== 1)) throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_NOT_FOUND');
  const frozen = freezeLine({ ...product,cartId:lineId,quantity,price,originalPrice:price,modifiers:[...modifiers],variantSku:variantSku || undefined },format);
  const existing = cart.find(item => item.id === product.id && item.price === price
    && item.articleFormat?.id === format.id && item.articleFormat?.variantId === format.variantId
    && item.articleFormat?.factor === format.factor && JSON.stringify(item.articleFormat) === JSON.stringify(frozen.articleFormat)
    && JSON.stringify([...(item.modifiers || [])].sort()) === JSON.stringify([...modifiers].sort()));
  return existing ? cart.map(item => item.cartId === existing.cartId ? resizeLine(item,addQuantities(item.quantity,quantity)) : item) : [frozen,...cart];
}

export function selectedVariantId(product: Product, selections: Record<string,string>): string | undefined {
  const matches = product.variants.filter(variant => product.attributes.length > 0 && product.attributes.every(attribute => {
    const value = variant.attributeValues[attribute.id] ?? variant.attributeValues[attribute.name];
    return value !== undefined && selections[attribute.id] === value;
  }));
  if (matches.length !== 1) return undefined;
  if (!product.articleFormatVariantSkus) return matches[0].sku;
  const ids = Object.entries(product.articleFormatVariantSkus).filter(([,sku]) => sku === matches[0].sku);
  if (ids.length !== 1) throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_MAPPING_MISSING');
  return ids[0][0];
}

export function formatStockDemand(cart: CartItem[], itemId: string): number {
  return cart.filter(item => item.id === itemId).reduce((sum,item) => addQuantities(sum,inventoryQuantity(item)),0);
}

/** Legacy unit entry must never merge into a historical format line, even at the same price. */
export function legacyMergeCandidate(cart: CartItem[], productId: string, price: number, modifiers: string[] = []): CartItem | undefined {
  const key = [...modifiers].sort().join('|');
  return cart.find(item => !item.articleFormat && item.id === productId && item.price === price
    && [...(item.modifiers || [])].sort().join('|') === key);
}

/** Shared by Enter and scanner. A format refund must originate in the original sale line. */
export function routeQuickFormat(format: ArticleFormat | undefined, isReturnMode: boolean,
  onSale: (format: ArticleFormat) => void): boolean {
  if (!format) return false;
  if (isReturnMode) throw new ArticleFormatError('ARTICLE_FORMAT_ORIGINAL_SALE_REQUIRED');
  onSale(format);
  return true;
}

/** A master flag changing must not turn a formatted return into an anonymous legacy unit. */
export function assertOriginalSaleForFormatReturn(
  product: { article_formats?: ArticleFormatsDTO; articleFormat?: unknown }, isReturnMode: boolean
): void {
  if (isReturnMode && (product.article_formats?.formats.length || product.articleFormat !== undefined)) {
    throw new ArticleFormatError('ARTICLE_FORMAT_ORIGINAL_SALE_REQUIRED');
  }
}

/** Parent/variant legacy codes mean base units; negotiated masters must authorize that format. */
export function baseCodeFormat(dto: ArticleFormatsDTO | undefined, variantId: string | null): ArticleFormat | undefined {
  if (!dto?.formats.length) return undefined;
  const format = dto.formats.find(format => format.variantId === variantId && format.is_base);
  if (!format || !format.active || !format.allow_sale) throw new ArticleFormatError('ARTICLE_FORMAT_NOT_SELLABLE');
  return format;
}

export function skuForFormatVariant(product: Pick<Product,'articleFormatVariantSkus'>, erpId:string|null):string|undefined {
  if (erpId===null) return undefined;
  if (!product.articleFormatVariantSkus) return erpId;
  const sku=product.articleFormatVariantSkus[erpId];
  if (typeof sku!=='string') throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_MAPPING_MISSING');
  return sku;
}
export function formatVariantForSku(product: Pick<Product,'articleFormatVariantSkus'>, sku:string):string {
  if (!product.articleFormatVariantSkus) return sku;
  const matches=Object.entries(product.articleFormatVariantSkus).filter(([,value])=>value===sku);
  if (matches.length!==1) throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_MAPPING_MISSING');
  return matches[0][0];
}
