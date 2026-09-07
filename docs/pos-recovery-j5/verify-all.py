"""Offline runner. Use Python with jsonschema 4.25.1 installed. No network/DB."""
import hashlib, json, pathlib, subprocess, sys, tempfile, zipfile
root=pathlib.Path(__file__).resolve().parents[2]
archive=root/'inputs/pos-recovery-erp-j4-4793f552.zip'
results=[]
def run(command,cwd):
    p=subprocess.run(command,cwd=cwd,text=True,capture_output=True)
    results.append(dict(command=command,exitCode=p.returncode,stdout=p.stdout,stderr=p.stderr))
    print(p.stdout,end='')
    if p.returncode: raise RuntimeError(p.stderr)
with tempfile.TemporaryDirectory(prefix='erp-j4-offline-') as tmp:
    dest=pathlib.Path(tmp)
    with zipfile.ZipFile(archive) as z: z.extractall(dest)
    for line in (dest/'SHA256SUMS').read_text().splitlines():
        digest,name=line.split(None,1)
        assert hashlib.sha256((dest/name.lstrip('*')).read_bytes()).hexdigest()==digest,name
    print('PASS: ERP input SHA256SUMS')
    p='docs/pos-pending-day-recovery/'
    q=p+'pos-j4-evidence/docs/'
    for command in [['node',q+'pos-recovery-j3/verify-contract.mjs'],[sys.executable,q+'pos-recovery-j3/verify-bytes.py'],['node',q+'pos-recovery-j4/verify-semantics.mjs'],['node',q+'pos-recovery-j4/verify-negatives.mjs'],[sys.executable,q+'pos-recovery-j4/verify-bytes.py']]: run(command,dest)
    for script in ['verify-fixtures.mjs','verify-j2.mjs','verify-j3.mjs','verify-j4.mjs','verify-schema.py','verify-r4.py']:run(['node' if script.endswith('.mjs') else sys.executable,p+script],dest)
for script in ['pos-recovery-j3/verify-contract.mjs','pos-recovery-j3/verify-bytes.py','pos-recovery-j4/verify-semantics.mjs','pos-recovery-j4/verify-negatives.mjs','pos-recovery-j4/verify-bytes.py','pos-recovery-j5/verify-regressions.mjs']:
    run(['node' if script.endswith('.mjs') else sys.executable,'docs/'+script],root)
# Historical JSON remains immutable, including the J4 rules now superseded by J5.
for name,digest in json.loads((root/'docs/pos-recovery-j5/historical-sha256.json').read_text()).items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
print('PASS: all historical JSON preserved; no recovery authorization.')
if '--record' in sys.argv:
    (root/'docs/pos-recovery-j5/results.json').write_text(json.dumps(dict(legacy='UNKNOWN',exactZEligible=False,closeAuthorization='NOT_GRANTED',erpInputSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),commands=results),indent=2)+'\n')
