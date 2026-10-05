# Large Master Sync V3 receiver (dark integration)

## Canary routing

The emulator-only canary registers its existing terminal identity through `URL ERP` to obtain a session-only sync token. It sends only `/api/sync/v3/master-syncs` requests to the separate `URL Sync V3 (Railway)` origin. This is a direct client request, not a proxy or redirect. The V3 origin defaults to `https://clic-erp-production.up.railway.app` and can be set at build time with `VITE_LARGE_MASTER_SYNC_V3_BASE_URL`. Both origins must be HTTPS (except loopback), and changing either URL invalidates the in-memory registration. Operational credentials are not persisted by the canary.

The receiver is integrated with POS database bootstrap and foreground resume, but remains compile-time disabled through `LARGE_MASTER_SYNC_V3_RECEIVER_ENABLED = false` in `services/sync/LargeMasterSyncV3Lifecycle.ts`.

The contract-v2 receiver stores the added operational article, tariff, tax and variant records in SQLite and migrates existing canary databases additively. It rejects a contract-v1 session for operational reads and exposes bounded, version-fenced article queries. `LargeMasterSyncV3SaleCatalog` additionally pins one snapshot and effective tariff, resolves its active taxes, and refuses missing prices or inactive barcode variants. This is preparation only: the lifecycle guard remains off and the React POS still reads its legacy catalog. Do not build an operational V3 APK from this change alone.

While dark it performs no V3 HTTP request, adds no capability header, does not change legacy full/delta/config flows, and does not replace the React `products` or `productPrices` arrays. If a previously activated V3 database exists, the runtime pointer also stays unused while the guard is false; legacy remains authoritative.

Enabling requires a separate reviewed change after schema, resume, checksum, storage, regression, physical Android 54k × 6 and performance gates pass. That later change must:

1. Change the lifecycle guard under an independently reviewed rollout flag.
2. Add the capability announcement to the authenticated ERP transport only then.
3. Instantiate the client from the ERP lifecycle without routing V3 through legacy `db.save()`.
4. Refresh the immutable `LargeMasterSyncV3Runtime` only after atomic activation.
5. Migrate individual POS read paths to paginated article queries, tariff-scoped price lookup and direct barcode lookup before removing any legacy in-memory collection.
6. Keep the prior runtime object alive for sales already in progress and swap only between sales.

Disabling the future rollout must stop new requests without deleting or changing `active_version`; legacy rehydration must be completed before changing the authoritative read path.

The staging writer pauses for the existing sale-activity signal and the concrete payment and print lifecycles. It checks the gate both before downloading a chunk and again immediately before the SQLite transaction, so activity that starts during download, hashing or parsing cannot overlap the write. There is intentionally no generic `UI_CRITICAL` state: no production lifecycle emitted that signal, so keeping it would imply protection that did not exist. Any future critical UI flow must wire its real mount/unmount lifecycle to this gate explicitly.
