# Large Master Sync V3 receiver (dark integration)

The receiver is integrated with POS database bootstrap and foreground resume, but remains compile-time disabled through `LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED = false` in `services/sync/LargeMasterSyncV3Lifecycle.ts`.

While dark it performs no V3 HTTP request, adds no capability header, does not change legacy full/delta/config flows, and does not replace the React `products` or `productPrices` arrays. If a previously activated V3 database exists, the runtime pointer also stays unused while the guard is false; legacy remains authoritative.

Enabling requires a separate reviewed change after schema, resume, checksum, storage, regression, physical Android 54k × 6 and performance gates pass. That later change must:

1. Change the lifecycle guard under an independently reviewed rollout flag.
2. Add the capability announcement to the authenticated ERP transport only then.
3. Instantiate the client from the ERP lifecycle without routing V3 through legacy `db.save()`.
4. Refresh the immutable `LargeMasterSyncV3Runtime` only after atomic activation.
5. Migrate individual POS read paths to paginated article queries, tariff-scoped price lookup and direct barcode lookup before removing any legacy in-memory collection.
6. Keep the prior runtime object alive for sales already in progress and swap only between sales.

Disabling the future rollout must stop new requests without deleting or changing `active_version`; legacy rehydration must be completed before changing the authoritative read path.
