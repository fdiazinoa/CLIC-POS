"""Offline index/source verification, not a semantic or operational validator."""
import hashlib,json,pathlib,subprocess,sys,tempfile,zipfile
root=pathlib.Path(__file__).resolve().parents[2]
d=root/'docs/pos-recovery-j7'
read=lambda p:json.loads(p.read_text())
archive=pathlib.Path(sys.argv[1]).resolve()
assert hashlib.sha256(archive.read_bytes()).hexdigest()==read(d/'input.json')['sha256']
for name,h in read(d/'historical-sha256.json').items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==h,name
with tempfile.TemporaryDirectory(prefix='erp-j6-check-') as tmp:
    dest=pathlib.Path(tmp)
    with zipfile.ZipFile(archive) as z:z.extractall(dest)
    for line in (dest/'SHA256SUMS').read_text().splitlines():
        h,n=line.split(None,1);assert hashlib.sha256((dest/n).read_bytes()).hexdigest()==h,n
    subprocess.run([sys.executable,'docs/pos-pending-day-recovery/verify-j6.py'],cwd=dest,check=True)
index=read(d/'evidence-index.json');source=read(d/'source-excerpts.json')
assert index['legacy']=='UNKNOWN' and index['exactZEligible'] is False and index['closeAuthorization']=='NOT_GRANTED'
assert [e['blocker'] for e in index['entries']]==['B02','B03','B04','B05','B06']
for e in index['entries']:
    assert e['acceptance']=='PENDING' and e['missingEvidence']
    assert e['sourceCommit']==source['sourceCommit']
    for p in [e['artifact']]+e['relatedArtifacts']:assert (root/p).is_file(),p
    assert any(x['blocker']==e['blocker'] for x in source['excerpts'])
if '--source' in sys.argv:
    for x in source['excerpts']:
        b=subprocess.check_output(['git','show',source['sourceCommit']+':'+x['path']],cwd=root)
        assert hashlib.sha256(b).hexdigest()==x['sourceSha256'],x['path']
        lines=b.decode().splitlines(keepends=True)
        for p in x['ranges']:assert ''.join(lines[p['start']-1:p['end']])==p['text'],x['path']
    print('PASS: source excerpts match pinned git commit; no runtime executed.')
print('PASS: B02–B06 evidence index, all PENDING; historical files intact. Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. No completeness, remote authenticity or durability certification.')
