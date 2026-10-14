import type { CartItem, Product } from '../../types';
import type { ArticleFormat } from './contract';
import { ArticleFormatError, addQuantities, freezeLine, inventoryQuantity, resizeLine } from './domain';

export function addFormatLine(cart: CartItem[], product: Product, format: ArticleFormat, quantity: number,
  price: number, lineId: string, modifiers: string[] = []): CartItem[] {
  if (!format.active || !format.allow_sale || !product.article_formats?.formats.some(f => f.id === format.id && f.variantId === format.variantId)) throw new ArticleFormatError('ARTICLE_FORMAT_NOT_SELLABLE');
  if (quantity <= 0) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_QUANTITY');
  if (format.variantId !== null && !product.variants.some(variant => variant.sku === format.variantId)) throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_NOT_FOUND');
  const frozen = freezeLine({ ...product,cartId:lineId,quantity,price,originalPrice:price,modifiers:[...modifiers],variantSku:format.variantId || undefined },format);
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
  return matches.length === 1 ? matches[0].sku : undefined;
}

export function formatStockDemand(cart: CartItem[], itemId: string): number {
  return cart.filter(item => item.id === itemId).reduce((sum,item) => addQuantities(sum,inventoryQuantity(item)),0);
}
