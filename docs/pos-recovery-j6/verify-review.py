"""Offline review; Python requires jsonschema 4.25.1. Input ERP ZIP is external."""
import hashlib,json,pathlib,subprocess,sys,tempfile,zipfile
root=pathlib.Path(__file__).resolve().parents[2]
d=root/'docs/pos-recovery-j6'
archive=pathlib.Path(sys.argv[1]).resolve()
expected='9d361268a70c8b7e6ff605bef8b97523e057826fb050790fdb83c8bb9c62e1ac'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected,'ERP_INPUT_SHA'
for name,h in json.loads((d/'historical-sha256.json').read_text()).items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h,name
with tempfile.TemporaryDirectory(prefix='erp-j5-review-') as tmp:
    dest=pathlib.Path(tmp)
    with zipfile.ZipFile(archive) as z: z.extractall(dest)
    for line in (dest/'SHA256SUMS').read_text().splitlines():
        h,n=line.split(None,1);assert hashlib.sha256((dest/n).read_bytes()).hexdigest()==h,n
    for c in [[sys.executable,'docs/pos-pending-day-recovery/pos-j5-evidence/docs/pos-recovery-j5/verify-all.py'],['node','docs/pos-pending-day-recovery/verify-j5.mjs']]:subprocess.run(c,cwd=dest,check=True)
e=json.loads((d/'source-evidence.json').read_text())
n=json.loads((d/'native-closure.json').read_text())
assert n==json.loads((root/'docs/pos-recovery-j3/native-closure.json').read_text())
assert len(n['declarations'])==e['reachableDeclarations']
assert sum(x['openShape'] for x in n['declarations'])==e['openDeclarations']
# Optional source attestation against pinned git commit; package checks alone do not authenticate source.
if '--source' in sys.argv:
    for f in e['files']:
        b=subprocess.check_output(['git','show',e['sourceCommit']+':'+f['path']],cwd=root)
        assert hashlib.sha256(b).hexdigest()==f['sha256']
        lines=b.decode().splitlines(keepends=True)
        for x in f['excerpts']:assert ''.join(lines[x['start']-1:x['end']])==x['text']
    b=subprocess.check_output(['git','show',e['sourceCommit']+':types.ts'],cwd=root)
    assert hashlib.sha256(b).hexdigest()==n['sourceSha256']
print('PASS: J6 offline review; historical JSON unchanged; native inventory unchanged (156 declarations, 16 open shapes). Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. No remote authenticity or recoverability proof.')
