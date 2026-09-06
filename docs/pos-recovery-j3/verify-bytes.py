"""Independent offline digest check. Not a JCS/native profile implementation."""
import json,hashlib
from pathlib import Path
b=json.loads((Path(__file__).parent/'contract-vectors.json').read_text())
for c in b['commands']:
 v=c['vector'];raw=bytes.fromhex(v['utf8Hex'])
 assert raw==v['canonicalUtf8'].encode()
 assert hashlib.sha256(raw).hexdigest()==v['sha256']
 assert json.loads(raw)==c['intent']
print('PASS: 8 intent byte/digests independently checked; no business semantics certified.')
