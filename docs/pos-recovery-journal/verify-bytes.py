"""Independent offline byte/digest check; not a full Python JCS implementation."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).parent
bundle = json.loads((root / 'vectors.json').read_text())
vectors = bundle['canonicalization'] + bundle['graph']['vectors']
vectors += json.loads((root / 'erp-own-vectors.json').read_text())
lineage = json.loads((root / 'lineage-vectors.json').read_text())
for scenario in lineage['scenarios']:
    vectors += scenario['expected']['vectors']
for vector in vectors:
    raw = bytes.fromhex(vector['utf8Hex'])
    assert raw == vector['canonicalUtf8'].encode('utf-8'), vector['name']
    assert hashlib.sha256(raw).hexdigest() == vector['sha256'], vector['name']
    assert json.loads(raw) == vector['input'], vector['name']

# Python code point ordering differs from UTF-16 for these valid identifiers.
keys = ['\ue000', '\U0001f600']
assert sorted(keys) != sorted(keys, key=lambda value: value.encode('utf-16-be'))
assert sorted(keys, key=lambda value: value.encode('utf-16-be')) == ['\U0001f600', '\ue000']
print(f'PASS: {len(vectors)} UTF-8/JSON/SHA256 vectors independently checked with Python; UTF-16 ordering example. No runtime certification.')
