import pathlib,subprocess,hashlib,json,zipfile,tempfile,sys,os
root=pathlib.Path(__file__).resolve().parents[2];d=root/'docs/pos-recovery-j9';read=lambda p:json.loads(p.read_text())
archive=pathlib.Path(sys.argv[1]).resolve();assert hashlib.sha256(archive.read_bytes()).hexdigest()==read(d/'input.json')['sha256']
def check(r):
    for l in (r/'SHA256SUMS').read_text().splitlines():
        h,n=l.split(None,1);assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
with tempfile.TemporaryDirectory(prefix='j9-review-') as tmp:
    r=pathlib.Path(tmp)
    with zipfile.ZipFile(archive) as z:z.extractall(r)
    check(r);p=r/'pos-j8-review';p.mkdir()
    with zipfile.ZipFile(r/'inputs/pos-recovery-j8-4ff5a1c.zip') as z:z.extractall(p)
    check(p)
    for c,w in [([sys.executable,'docs/pos-recovery-j8/verify-review.py','inputs/pos-recovery-erp-j7-f0fb5907.zip'],p),(['node','docs/pos-recovery-j8/verify-native.cjs'],p),(['node','docs/pos-pending-day-recovery/verify-j8.cjs',str(p)],r)]:subprocess.run(c,cwd=w,check=True)
for p,h in read(d/'historical-sha256.json').items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h,p
subprocess.run(['node','docs/pos-recovery-j9/verify-native.cjs'],cwd=root,env={**os.environ,'TZ':'America/Santo_Domingo'},check=True)
if '--source' in sys.argv:
    s=read(d/'source.json')
    for p,x in {**s['modules'],**s['sourceFiles']}.items():
        raw=subprocess.check_output(['git','show',s['sourceCommit']+':'+p],cwd=root)
        assert hashlib.sha256(raw).hexdigest()==x['sha256'],p
        if 'source' in x:assert raw.decode()==x['source']
print('PASS J9: ERP procedure, composed native results and historical integrity. All B02–B06 remain PENDING; legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED.')
