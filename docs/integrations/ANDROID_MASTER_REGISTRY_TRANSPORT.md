# Android Master registry transport

Source scope: `fix/android-master-registry-transport`, based on develop
`3da4ffa46f687184898cb25aca0e0f058541dc12` after PR #894. This change is separate
from native article-format financial atomicity. Formats remain disabled.

The Kotlin Master server is HTTP on port 3001. Capacitor's HTTPS asset origin
does not describe that LAN transport. Android publication now advertises HTTP
and reads IPv4 addresses from the existing ClicPOSNativePrinter bridge (or the
legacy AndroidPrinter bridge). Missing, rejected or malformed bridge data does
not authorize publishing a null or loopback endpoint. Unsupported Node routes
`/api/network` and `/api/cloud/master-endpoint/*` are omitted on Android for both
resolution and publication. Browser discovery and proxy candidates are retained.

Authorized direct RPC names, session/auth headers, Cloud tenant identity and
primary-only publication remain unchanged. Publication state is scoped by
tenant, terminal and device. Confirmed identical fingerprints deduplicate;
concurrent identical requests share the pending result. Null/error/timeout
attempts remain retryable. A changed fingerprint supersedes the pending attempt.
Ownership checks protect persistence and completion cleanup even if a transport
ignores abort or returns a late response body. Device discovery invocation order
also prevents an older delayed bridge response replacing a newer address.

`tests/cloudMasterRegistryRuntime.test.ts` executes the complete production
module with controlled platform, auth and transport boundaries. It covers bridge
validation, HTTP/HTTPS behavior, authorized RPC, retries, coalescing, timeout and
late-response ownership, tenant/device scope, and browser proxy preservation.
These fixtures do not certify operational Cloud publication or a second terminal
consuming the published endpoint. Native runtime QA and an authorized isolated
two-node publication/consumption proof remain separate required evidence; no
operational Cloud record should be changed merely to obtain that evidence.

The previously observed 12-second manifest requests remain UNKNOWN_BACKEND.
This change does not alter manifest authority, host, timeout, cursors, ACKs,
licensing, ERP deployment, grants or flags. It does not establish end-to-end ERP
integration or approval to enable article formats, publish a release, or install
an APK.
