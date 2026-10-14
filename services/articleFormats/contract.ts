/** ERP DTO v1: keep commercial snake_case names and snapshot camelCase intact. */
export interface ArticleFormatSnapshot {
  schemaVersion: 1;
  id: string;
  variantId: string | null;
  name: string;
  abbreviation: string;
  factor: number;
  barcode: string | null;
}

export interface ArticleFormat extends ArticleFormatSnapshot {
  active: boolean;
  is_base: boolean;
  default_purchase: boolean;
  default_sale: boolean;
  allow_purchase: boolean;
  allow_sale: boolean;
  allow_transfer: boolean;
  sort_order: number;
  prices: { tariffId: string; price: number }[];
}

export interface ArticleFormatsDTO {
  schema_version: 1;
  inventory_quantity_unit: 'BASE';
  item_id: string;
  formats: ArticleFormat[];
}

export interface ArticleFormatLine {
  cartId: string;
  id: string;
  quantity: number;
  price: number;
  articleFormat?: ArticleFormatSnapshot;
  baseQuantity?: number;
  variantSku?: string;
}

export interface ArticleFormatScope {
  tenantId: string;
  companyId: string;
}

/** Local adapter envelope, NOT an existing ERP network/event schema. */
export interface ArticleFormatMasterPage {
  scope: ArticleFormatScope;
  pageId: string;
  revision: number;
  nextCursor: string | null;
  items: ArticleFormatsDTO[];
}
