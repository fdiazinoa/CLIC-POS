"""Offline ERP procedure + captured native helpers; no application runtime."""
import pathlib,json,hashlib,subprocess,sys,tempfile,zipfile
root=pathlib.Path(__file__).resolve().parents[2];d=root/'docs/pos-recovery-j8'
read=lambda p:json.loads(p.read_text())
def checks(r):
    for l in (r/'SHA256SUMS').read_text().splitlines():
        h,n=l.split(None,1);assert hashlib.sha256((r/n).read_bytes()).hexdigest()==h,n
archive=pathlib.Path(sys.argv[1]).resolve()
assert hashlib.sha256(archive.read_bytes()).hexdigest()==read(d/'input.json')['sha256']
with tempfile.TemporaryDirectory(prefix='j8-erp-') as tmp:
    r=pathlib.Path(tmp)
    with zipfile.ZipFile(archive) as z:z.extractall(r)
    checks(r);pos=r/'pos-j7-review';pos.mkdir()
    with zipfile.ZipFile(r/'inputs/pos-recovery-j7-d2ac964.zip') as z:z.extractall(pos)
    checks(pos)
    subprocess.run([sys.executable,'docs/pos-recovery-j7/verify-evidence.py','inputs/pos-recovery-erp-j6-64cabf53.zip'],cwd=pos,check=True)
for p,h in read(d/'historical-sha256.json').items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h,p
subprocess.run(['node','docs/pos-recovery-j8/verify-native.cjs'],cwd=root,check=True)
s=read(d/'source-bundle.json')
if '--source' in sys.argv:
    for p,x in {**s['modules'],**s['staticSources']}.items():
        b=subprocess.check_output(['git','show',s['sourceCommit']+':'+p],cwd=root)
        assert b.decode()==x['source'];assert hashlib.sha256(b).hexdigest()==x['sha256']
    for x in s['fragments'].values():
        b=subprocess.check_output(['git','show',s['sourceCommit']+':'+x['path']],cwd=root)
        assert hashlib.sha256(b).hexdigest()==x['sourceSha256']
        assert b.decode().splitlines(keepends=True)[x['startLine']-1:][0].endswith(x['source'].splitlines(keepends=True)[0]) or x['source'] in b.decode()
        assert x['source'] in b.decode()
    print('PASS: captured complete helper sources and fragments match pinned git commit.')
print('PASS J8: B09/B11 documentary coverage confirmed; B02–B06 PENDING. Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.')
