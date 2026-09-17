# Bounded scanner-focus attribution (hito A only)

The normal build uses `CLIC_POS_SCANNER_FOCUS_DIAGNOSTICS=false` (default).
Only an explicit frontend opt-in build with the variable set to `true` inserts
the specific transform/runtime. It cannot be combined with `CLIC_POS_DIAGNOSTICS=true`.
No Zone, global instrumentation, native policy, storage, reader algorithm or
functional source change is included. This preparation does not authorize an APK.

The diagnostic-only frontend entry installs `window.__CLIC_POS_SCANNER_FOCUS__`.
Installation creates no listeners, observers, interval, RAF or timer. An operator
explicitly calls `startCapture()`, then `arm(action, durationMs)` immediately before
one action; duration is capped at 5000 ms. Supported actions: `default-resume`,
`manual-resume`, `host-reveal`, `manual-touch`, `control`. One expiry timeout exists
only while armed. `disarm()` stops recording and removes it. `snapshot()` returns
an in-memory copy; `cleanup()` erases records/timer and removes the API. No app
field values, DOM dumps, IDs, arbitrary labels, PINs, barcodes or tokens are read.

Schema 1: action ordinal/kind, automatic/manual intent, enumerated point/reason,
monotonic start/end/duration (ms), active/target category, document visibility,
post-focus active category (only DOM-focus/total) and boolean guard/match results,
optional JS bridge object presence. Capture includes performance.timeOrigin for
external clock correlation. Categories are receiver, manual marked scanner target,
other-editable, body, other; the manual label is a field category, not evidence of
a prior human gesture. Reasons describe the observed scheduler input, not causal
proof of the IME request. `manual-bridge-call-site` proves only a JS site was
reached; bridgePresent does NOT prove a method exists or Android executed it.

Detailed records are capped at 64/action and 512/capture; dropped is cumulative.
Observer errors are counted separately; reject such samples as incomplete.
Parent focus-total and child guards-simple/blocked-query/closest/DOM-focus timings
are inclusive and MUST NOT be added together. Existing short-circuit reads and
focus/bridge/timer order remain intact. Classification/clock failures never
replace operational returns/throws. Unarmed wrappers execute original operations
without clocks/classification, but enabled-build wrapper overhead still requires
measurement. No UserTiming emitter or JSON formatter runs in operational callbacks.

After independent review/source QA and separately authorized physical preparation,
root alone operates Android. Reproduce fresh/default HOME/resume separately from
manual search/BACK/HOME, x10 exploratorily on each existing WebView. No BACK cleanup
in default; no reset, clear, identity change, binding transfer, closed sale or
device update. Record nearby screenshots, active native EditorInfo whitelist and
IME request-history timestamps externally, distinguishing current/history. Capture
monotonic/timeOrigin anchors and verify overlap before attribution. Reject results
with drops, incomplete coverage or overhead >5%; compare normal vs opt-in-unarmed
and armed in alternating matched sessions. HOST/fake tests do not prove Android
IME behavior or HID/IME-only reader acceptance. A functional hito B fix and any
APK need separate evidence, approval and gates.

## Physical tooling is not authorized or proven by this implementation

APK400 has native POS_DIAGNOSTICS=false and does not expose DevTools or this API.
No runtime extra can enable them in that normal APK. Existing MainActivity and
PosNativeDiagnostics support a *separately compiled* POS_DIAGNOSTICS=true shell:
the existing intent combination `pos_diagnostic_control=true`,
`pos_diagnostics=false` enables control-only DevTools without native observers.
The focused frontend must nevertheless be built with CLIC_POS_DIAGNOSTICS=false
and CLIC_POS_SCANNER_FOCUS_DIAGNOSTICS=true, not the broad diagnostics bootstrap.
Native Gradle currently derives POS_DIAGNOSTICS from CLIC_POS_DIAGNOSTICS too;
the canonical release script uses that same environment through frontend and
Gradle. Thus it does NOT presently offer a verified single-command split-stage
diagnostic build. No script/Gradle/policy/version was changed here. A future
split-stage preparation/asset/provenance/signature procedure requires separate
review, authorization and physical build gates; do not run ordinary production
release commands with these assumptions or classify such a shell as normal.

If a future approved control-only shell exposes CDP, the external operator must
verify the focused API exists, broad __POS_DIAGNOSTICS__/Zone/native-active do
not, and command execution/clock advances are available in background. For a
30-second background test do NOT arm before HOME: that window expires after5s.
Instead preserve30s background, invoke arm('default-resume') via CDP immediately
before the separately timestamped resume, then snapshot afterwards and verify
the window overlaps that transition. Background page freezing/timer throttling,
CDP accessibility, intent retention and onset coverage are not validated here.
If arming does not execute before resume, report missing coverage/BLOCKED; an
arm after resume cannot retroactively attribute the first focus. Do not add
polling, recurring observers, keyboard policy, autoarming or another bridge to
work around this gap without a newly approved plan.
