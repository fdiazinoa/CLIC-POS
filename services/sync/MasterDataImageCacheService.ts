import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Customer, Supplier } from '../../types';
import { db } from '../../utils/db';

export type ImageBackedCollection = 'customers' | 'suppliers';

type SyncImageEntity = (Partial<Customer> & Partial<Supplier> & Record<string, any>);

type ImageState = {
  image?: string;
  imageUrl?: string;
  imageVersion?: string;
  imageLocalPath?: string | null;
};

type CollectionConfig = {
  folder: string;
  urlPaths: string[];
  versionPaths: string[];
  mirrorFields: {
    render: string[];
    url: string[];
    version: string[];
    localPath: string[];
  };
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return '';
};

const firstValue = (...values: unknown[]): unknown => (
  values.find((value) => asString(value) || typeof value === 'number' || typeof value === 'boolean')
);

const isLocalOnlyImageRef = (value: string): boolean =>
  /^file:\/\//i.test(value) ||
  /^content:\/\//i.test(value) ||
  value.includes('/_capacitor_file_');

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map((value) => asString(value)).filter(Boolean)));

const readPath = (value: unknown, path: string): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
};

const COLLECTION_CONFIG: Record<ImageBackedCollection, CollectionConfig> = {
  customers: {
    folder: 'customer-images',
    urlPaths: [
      'imageUrl',
      'image_url',
      'photoUrl',
      'photo_url',
      'avatarUrl',
      'avatar_url',
      'metadata.imageUrl',
      'metadata.image_url',
      'image',
      'photo',
      'avatar',
    ],
    versionPaths: [
      'imageVersion',
      'image_version',
      'photoVersion',
      'photo_version',
      'avatarVersion',
      'avatar_version',
      'metadata.imageVersion',
      'metadata.image_version',
      'updatedAt',
      'updated_at',
    ],
    mirrorFields: {
      render: ['photo', 'avatar'],
      url: ['photoUrl', 'avatarUrl'],
      version: ['photoVersion', 'avatarVersion'],
      localPath: ['photoLocalPath', 'avatarLocalPath'],
    },
  },
  suppliers: {
    folder: 'supplier-images',
    urlPaths: [
      'imageUrl',
      'image_url',
      'logoUrl',
      'logo_url',
      'photoUrl',
      'photo_url',
      'metadata.imageUrl',
      'metadata.image_url',
      'image',
      'logo',
      'photo',
    ],
    versionPaths: [
      'imageVersion',
      'image_version',
      'logoVersion',
      'logo_version',
      'photoVersion',
      'photo_version',
      'metadata.imageVersion',
      'metadata.image_version',
      'updatedAt',
      'updated_at',
    ],
    mirrorFields: {
      render: ['logo'],
      url: ['logoUrl'],
      version: ['logoVersion'],
      localPath: ['logoLocalPath'],
    },
  },
};

class MasterDataImageCacheService {
  private readonly logger = console;

  private isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  private readMasterUrl(): string | null {
    return asString(localStorage.getItem('CLIC_POS_MASTER_URL')) || null;
  }

  private rewriteLoopbackHostname(urlValue: string, masterUrlValue: string | null): string {
    if (!masterUrlValue || !this.isNativeAndroid()) {
      return urlValue;
    }

    try {
      const urlObj = new URL(urlValue);
      if (urlObj.hostname !== 'localhost' && urlObj.hostname !== '127.0.0.1') {
        return urlValue;
      }

      const masterObj = new URL(masterUrlValue);
      urlObj.protocol = masterObj.protocol;
      urlObj.hostname = masterObj.hostname;
      return urlObj.toString();
    } catch {
      return urlValue;
    }
  }

  private resolveRelativeImageBaseUrl(masterUrl: string | null): string | null {
    const env = (import.meta as any)?.env || {};
    const candidates = uniqueStrings([
      env.VITE_SUPABASE_URL,
      localStorage.getItem('CLIC_SUPABASE_URL'),
      localStorage.getItem('SUPABASE_URL'),
      localStorage.getItem('CLIC_ERP_BASE_URL'),
      localStorage.getItem('erp_base_url'),
      masterUrl,
    ]);

    for (const candidate of candidates) {
      try {
        const normalized = this.rewriteLoopbackHostname(candidate, masterUrl);
        return new URL(normalized).toString().replace(/\/$/, '');
      } catch {
        continue;
      }
    }

    return null;
  }

  private resolveRemoteImageUrl(collection: ImageBackedCollection, item: SyncImageEntity): string | null {
    const config = COLLECTION_CONFIG[collection];
    const rawUrl = uniqueStrings(config.urlPaths.map((path) => readPath(item, path))).find((value) => !isLocalOnlyImageRef(value)) || '';

    if (!rawUrl) return null;
    if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) return rawUrl;

    try {
      const masterUrl = this.readMasterUrl();

      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        const baseUrl = this.resolveRelativeImageBaseUrl(masterUrl);
        if (!baseUrl) return rawUrl;

        const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
        return new URL(path, `${baseUrl}/`).toString();
      }

      if (this.isNativeAndroid() && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))) {
        return this.rewriteLoopbackHostname(rawUrl, masterUrl);
      }

      return rawUrl;
    } catch (error) {
      this.logger.warn(`[MasterDataImageCacheService] Failed to resolve remote image URL for ${collection}:`, error);
      return rawUrl;
    }
  }

  private resolveRemoteImageVersion(collection: ImageBackedCollection, item: SyncImageEntity, imageUrl: string | null): string | null {
    const config = COLLECTION_CONFIG[collection];
    const explicitVersion = uniqueStrings(config.versionPaths.map((path) => readPath(item, path)))[0] || '';
    return explicitVersion || imageUrl || null;
  }

  private buildRelativePath(collection: ImageBackedCollection, entityId: string, imageVersion: string, imageUrl: string): string {
    const safeId = entityId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeVersion = imageVersion.replace(/[^a-zA-Z0-9_-]/g, '_');
    const extension = this.resolveExtension(imageUrl);
    return `${COLLECTION_CONFIG[collection].folder}/${collection.slice(0, -1)}_${safeId}_${safeVersion}.${extension}`;
  }

  private resolveExtension(imageUrl: string): string {
    const cleanUrl = imageUrl.split('?')[0] || imageUrl;
    const ext = cleanUrl.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
    return 'jpg';
  }

  private buildRenderableNativePath(uri: string): string {
    return Capacitor.convertFileSrc(uri);
  }

  private buildRenderableWebPath(imageUrl: string): string {
    return imageUrl;
  }

  private buildIdentityKeys(collection: ImageBackedCollection, item: SyncImageEntity): string[] {
    const id = asString(item.id);
    const taxId = firstString(
      item.taxId,
      item.tax_id,
      item.rnc,
      item.cedula,
      item.identification,
      item.identificacion,
      item.document,
      item.documento,
      item.fiscal_id,
      item.fiscalId,
      item.metadata?.taxId,
      item.metadata?.tax_id,
      item.metadata?.rnc
    ).replace(/\W/g, '');
    const email = asString(item.email).toLowerCase();
    const phone = asString(item.phone).replace(/\D/g, '');

    const base = [
      id ? `id:${id}` : '',
      taxId ? `tax:${taxId}` : '',
      email ? `email:${email}` : '',
      phone ? `phone:${phone}` : '',
    ];

    if (collection === 'suppliers') {
      base.push(asString(item.name) ? `name:${asString(item.name).toLowerCase()}` : '');
    }

    return uniqueStrings(base);
  }

  private async getLocalLookups(collection: ImageBackedCollection): Promise<{
    localById: Map<string, SyncImageEntity>;
    localByIdentity: Map<string, SyncImageEntity>;
  }> {
    const entities = (await db.get(collection as any)) as SyncImageEntity[] | null;
    const localById = new Map<string, SyncImageEntity>();
    const localByIdentity = new Map<string, SyncImageEntity>();

    for (const entity of Array.isArray(entities) ? entities : []) {
      const entityId = asString(entity?.id);
      if (entityId) {
        localById.set(entityId, entity);
      }

      for (const key of this.buildIdentityKeys(collection, entity)) {
        if (!localByIdentity.has(key)) {
          localByIdentity.set(key, entity);
        }
      }
    }

    return { localById, localByIdentity };
  }

  private findLocalMatch(
    collection: ImageBackedCollection,
    item: SyncImageEntity,
    lookups: {
      localById: Map<string, SyncImageEntity>;
      localByIdentity: Map<string, SyncImageEntity>;
    }
  ): SyncImageEntity | undefined {
    const entityId = asString(item?.id);
    if (entityId && lookups.localById.has(entityId)) {
      return lookups.localById.get(entityId);
    }

    for (const key of this.buildIdentityKeys(collection, item)) {
      if (lookups.localByIdentity.has(key)) {
        return lookups.localByIdentity.get(key);
      }
    }

    return undefined;
  }

  private normalizeIncomingEntityFields(collection: ImageBackedCollection, item: SyncImageEntity): SyncImageEntity {
    if (collection !== 'customers') {
      return item;
    }

    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata as Record<string, unknown>
      : {};
    const billing = item.billing && typeof item.billing === 'object' && !Array.isArray(item.billing)
      ? item.billing as Record<string, unknown>
      : {};
    const fiscal = item.fiscal && typeof item.fiscal === 'object' && !Array.isArray(item.fiscal)
      ? item.fiscal as Record<string, unknown>
      : {};
    const primaryAddress = Array.isArray(item.addresses) && item.addresses[0] && typeof item.addresses[0] === 'object'
      ? item.addresses[0] as unknown as Record<string, unknown>
      : {};

    const taxId = firstString(
      item.taxId,
      item.tax_id,
      item.rnc,
      item.cedula,
      item.cedula_rnc,
      item.cedulaRnc,
      item.identification,
      item.identificacion,
      item.document,
      item.documento,
      item.document_number,
      item.documentNumber,
      item.fiscal_id,
      item.fiscalId,
      item.nif,
      billing.taxId,
      billing.tax_id,
      billing.rnc,
      fiscal.taxId,
      fiscal.tax_id,
      fiscal.rnc,
      metadata.taxId,
      metadata.tax_id,
      metadata.rnc
    );

    const address = firstString(
      item.address,
      item.direccion,
      item.dirección,
      item.billingAddress,
      item.billing_address,
      item.shippingAddress,
      item.shipping_address,
      item.streetAddress,
      item.street_address,
      item.address_line_1,
      item.addressLine1,
      item.domicilio,
      billing.address,
      billing.direccion,
      billing.billing_address,
      fiscal.address,
      fiscal.direccion,
      metadata.address,
      metadata.direccion,
      primaryAddress.address,
      primaryAddress.direccion,
      primaryAddress.street,
      primaryAddress.line1
    );

    return {
      ...item,
      taxId: taxId || item.taxId,
      address: address || item.address,
      phone: firstString(item.phone, item.telefono, item.tel, item.mobile, item.celular, metadata.phone, metadata.telefono) || item.phone,
      email: firstString(item.email, item.correo, item.email_address, item.emailAddress, metadata.email, metadata.correo) || item.email,
      requiresFiscalInvoice: firstValue(
        item.requiresFiscalInvoice,
        item.requires_fiscal_invoice,
        item.requiere_comprobante,
        item.requiereComprobante,
        item.use_fiscal_invoice,
        item.useFiscalInvoice,
        fiscal.requiresFiscalInvoice,
        fiscal.requires_fiscal_invoice,
        metadata.requiresFiscalInvoice,
        metadata.requires_fiscal_invoice
      ) as any,
    };
  }

  private applyMirrorFields(collection: ImageBackedCollection, entity: SyncImageEntity, state: ImageState): SyncImageEntity {
    const config = COLLECTION_CONFIG[collection];
    const next: SyncImageEntity = {
      ...entity,
      image: state.image,
      imageUrl: state.imageUrl,
      imageVersion: state.imageVersion,
      imageLocalPath: state.imageLocalPath ?? null,
    };

    const assign = (fields: string[], value: string | undefined | null) => {
      for (const field of fields) {
        if (value === undefined) {
          delete next[field];
        } else {
          next[field] = value;
        }
      }
    };

    assign(config.mirrorFields.render, state.image);
    assign(config.mirrorFields.url, state.imageUrl);
    assign(config.mirrorFields.version, state.imageVersion);
    assign(config.mirrorFields.localPath, state.imageLocalPath ?? null);

    return next;
  }

  private normalizeSingleIncomingItem(
    collection: ImageBackedCollection,
    item: SyncImageEntity,
    localEntity?: SyncImageEntity,
  ): SyncImageEntity {
    const imageUrl = this.resolveRemoteImageUrl(collection, item);
    const imageVersion = this.resolveRemoteImageVersion(collection, item, imageUrl);

    let normalized: SyncImageEntity = this.normalizeIncomingEntityFields(collection, { ...item });

    if (localEntity) {
      normalized = this.applyMirrorFields(collection, normalized, {
        image: asString(localEntity.image) || undefined,
        imageUrl: asString(localEntity.imageUrl) || undefined,
        imageVersion: asString(localEntity.imageVersion) || undefined,
        imageLocalPath: asString(localEntity.imageLocalPath) || null,
      });
    }

    if (!imageUrl || !imageVersion) {
      return normalized;
    }

    const canReuseLocalImage =
      asString(localEntity?.imageUrl) === imageUrl &&
      asString(localEntity?.imageVersion) === imageVersion &&
      (this.isNativeAndroid()
        ? asString(localEntity?.imageLocalPath).length > 0
        : asString(localEntity?.image).length > 0);

    if (canReuseLocalImage) {
      return this.applyMirrorFields(collection, normalized, {
        image: asString(localEntity?.image) || undefined,
        imageUrl,
        imageVersion,
        imageLocalPath: asString(localEntity?.imageLocalPath) || null,
      });
    }

    if (!this.isNativeAndroid()) {
      return this.applyMirrorFields(collection, normalized, {
        image: this.buildRenderableWebPath(imageUrl),
        imageUrl,
        imageVersion,
        imageLocalPath: null,
      });
    }

    return this.applyMirrorFields(collection, normalized, {
      image: asString(localEntity?.image) || undefined,
      imageUrl,
      imageVersion,
      imageLocalPath: asString(localEntity?.imageLocalPath) || null,
    });
  }

  async normalizeIncomingItem(collection: ImageBackedCollection, item: SyncImageEntity): Promise<SyncImageEntity> {
    const lookups = await this.getLocalLookups(collection);
    return this.normalizeSingleIncomingItem(collection, item, this.findLocalMatch(collection, item, lookups));
  }

  async normalizeIncomingItems(collection: ImageBackedCollection, items: SyncImageEntity[]): Promise<SyncImageEntity[]> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const lookups = await this.getLocalLookups(collection);
    return items.map((item) => this.normalizeSingleIncomingItem(collection, item, this.findLocalMatch(collection, item, lookups)));
  }

  private async saveLocalImage(
    collection: ImageBackedCollection,
    entity: SyncImageEntity,
    imageUrl: string,
    imageVersion: string,
  ): Promise<boolean> {
    const folder = COLLECTION_CONFIG[collection].folder;
    const relativePath = this.buildRelativePath(collection, asString(entity.id), imageVersion, imageUrl);

    try {
      await Filesystem.mkdir({
        path: folder,
        directory: Directory.Data,
        recursive: true,
      });
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      if (!/exist/i.test(message)) {
        throw error;
      }
    }

    await Filesystem.downloadFile({
      url: imageUrl,
      path: relativePath,
      directory: Directory.Data,
      progress: false,
      recursive: true,
    });

    const uriResult = await Filesystem.getUri({
      path: relativePath,
      directory: Directory.Data,
    });

    const fileUri = asString(uriResult.uri);
    if (!fileUri) {
      throw new Error(`No se pudo resolver la ruta local para ${collection}:${entity.id}.`);
    }

    const renderablePath = this.buildRenderableNativePath(fileUri);
    const updatedEntity = this.applyMirrorFields(collection, entity, {
      image: renderablePath,
      imageUrl,
      imageVersion,
      imageLocalPath: fileUri,
    });

    await db.saveDocument(collection as any, updatedEntity);
    return true;
  }

  private async saveWebFallbackImage(
    collection: ImageBackedCollection,
    entity: SyncImageEntity,
    imageUrl: string,
    imageVersion: string,
  ): Promise<boolean> {
    const updatedEntity = this.applyMirrorFields(collection, entity, {
      image: this.buildRenderableWebPath(imageUrl),
      imageUrl,
      imageVersion,
      imageLocalPath: null,
    });

    await db.saveDocument(collection as any, updatedEntity);
    return true;
  }

  private async clearCachedImage(collection: ImageBackedCollection, entity: SyncImageEntity): Promise<boolean> {
    const hadManagedImage = Boolean(
      asString(entity.imageUrl) ||
      asString(entity.imageLocalPath) ||
      asString(entity.photoUrl) ||
      asString(entity.logoUrl) ||
      asString(entity.avatarUrl)
    );

    if (!hadManagedImage) return false;

    await db.saveDocument(
      collection as any,
      this.applyMirrorFields(collection, entity, {
        image: undefined,
        imageUrl: undefined,
        imageVersion: undefined,
        imageLocalPath: null,
      })
    );

    return true;
  }

  async syncSnapshotItems(collection: ImageBackedCollection, items: SyncImageEntity[]): Promise<{
    scanned: number;
    queued: number;
    downloaded: number;
    skipped: number;
    failed: number;
  }> {
    const incoming = Array.isArray(items) ? items : [];
    if (incoming.length === 0) {
      return { scanned: 0, queued: 0, downloaded: 0, skipped: 0, failed: 0 };
    }

    const lookups = await this.getLocalLookups(collection);
    let queued = 0;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let touched = 0;

    for (const rawItem of incoming) {
      const localEntity = this.findLocalMatch(collection, rawItem, lookups);
      if (!localEntity?.id) {
        skipped += 1;
        continue;
      }

      const imageUrl = this.resolveRemoteImageUrl(collection, rawItem);
      const imageVersion = this.resolveRemoteImageVersion(collection, rawItem, imageUrl);

      if (!imageUrl) {
        const cleared = await this.clearCachedImage(collection, localEntity);
        if (cleared) touched += 1;
        skipped += 1;
        continue;
      }

      const sameVersion =
        asString(localEntity.imageUrl) === imageUrl &&
        asString(localEntity.imageVersion) === (imageVersion || '') &&
        (this.isNativeAndroid()
          ? asString(localEntity.imageLocalPath).length > 0
          : asString(localEntity.image).length > 0);

      if (sameVersion) {
        skipped += 1;
        continue;
      }

      queued += 1;

      try {
        const persisted = this.isNativeAndroid()
          ? await this.saveLocalImage(collection, localEntity, imageUrl, imageVersion || imageUrl)
          : await this.saveWebFallbackImage(collection, localEntity, imageUrl, imageVersion || imageUrl);

        if (persisted) {
          downloaded += 1;
          touched += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`[MasterDataImageCacheService] Failed to cache image for ${collection}:${localEntity.id}`, error);
      }
    }

    if (touched > 0) {
      const eventName = collection === 'customers' ? 'customersUpdated' : 'suppliersUpdated';
      window.dispatchEvent(new CustomEvent(eventName));
    }

    return {
      scanned: incoming.length,
      queued,
      downloaded,
      skipped,
      failed,
    };
  }
}

export const masterDataImageCacheService = new MasterDataImageCacheService();
