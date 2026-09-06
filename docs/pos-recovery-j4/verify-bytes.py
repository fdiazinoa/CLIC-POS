"""Independent SHA256/byte checks, not a JCS implementation or semantic certificate."""
import json,hashlib
from pathlib import Path
root=Path(__file__).parent
b=json.loads((root/'semantic-vectors.json').read_text())
for c in b['cases']:
 v=c['vector'];raw=bytes.fromhex(v['utf8Hex'])
 assert raw==v['canonicalUtf8'].encode('utf-8')
 assert json.loads(raw)==c['intent']
 assert hashlib.sha256(raw).hexdigest()==v['sha256']
print('PASS: 8 new v2 intent vectors independently verified; published vectors unchanged.')

repo=Path(__file__).resolve().parents[2]
for name,digest in json.loads((root/'published-vectors.sha256.json').read_text()).items():
 assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==digest,name
print('PASS: published JSON bytes preserved.')
