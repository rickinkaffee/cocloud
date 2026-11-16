"""Run HTTP regressions and emit a portable checksummed source snapshot."""
from pathlib import Path
import hashlib,json,shutil,subprocess,sys
root=Path(__file__).resolve().parent
out=Path(sys.argv[1]).resolve()
if out==root or root in out.parents or out in root.parents:
    raise ValueError('Use an output directory outside the source tree')
subprocess.run(['node','--test',str(root/'project-import-server.test.mjs')],check=True)
out.mkdir(parents=True,exist_ok=False)
for name in ['project-import-server.mjs','project-sync.mjs','upload-destination.mjs','workbench-auth.mjs','project-import-server.test.mjs','README.md','build.py']:
    shutil.copy2(root/name,out/name)
(out/'receipt.json').write_text(json.dumps({'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir() if p.is_file()},'tests':'25 HTTP regressions'},indent=2)+'\n')
print(out)
