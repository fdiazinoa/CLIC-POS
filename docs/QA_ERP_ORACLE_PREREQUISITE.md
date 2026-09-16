# Independent ERP recovery oracle prerequisite

The full POS Node suite intentionally fails closed when the independent ERP
recovery contract checkout is unavailable. Do not skip retained-set tests, copy
their oracle into POS, substitute expected data, or use production RPCs to make
this gate green.

Use Node 22 and a separately reviewed, tracked-clean CLIC-ERP checkout containing
the recovery descriptor builder required by `tests/recoveryRetainedSet.test.ts`.
Record its remote URL, exact commit and tracked diff in the QA evidence. Set
`CLIC_ERP_REVIEW_PATH` explicitly to that checkout's absolute path; no repository
default or machine-specific path is configured here.

```sh
git -C /absolute/path/to/reviewed/CLIC-ERP remote get-url origin
git -C /absolute/path/to/reviewed/CLIC-ERP rev-parse HEAD
git -C /absolute/path/to/reviewed/CLIC-ERP diff --exit-code HEAD
CLIC_ERP_REVIEW_PATH=/absolute/path/to/reviewed/CLIC-ERP ./node_modules/.bin/tsx --test --test-concurrency=4 tests/*.test.ts
```

The reviewed prerequisite for the September 16, 2026 baseline was genuine
`https://github.com/fdiazinoa/CLIC-ERP.git`, commit
`0ae614e531525bf6053f6531a407f8e44c1272ee`. This is provenance, not an automatic
selection rule: a different checkout must be reviewed and its actual SHA recorded.
The retained-set tests invoke the real pure ERP builder with isolated inputs;
they must not contact ERP/Supabase or modify operational data. Missing or
incompatible ERP source remains a setup blocker, never an invented PASS.

Providing the prerequisite may also enable previously skipped integration tests.
Run the entire suite and report its actual totals, every failure and every skip;
do not selectively exclude newly enabled tests. Host tests do not certify APK
behavior, physical performance, device identity, or release approval.
