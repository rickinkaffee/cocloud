"""Validate portable sources and emit a checksummed release; never deploy automatically."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys
root=Path(__file__).resolve().parent
out=Path(sys.argv[1]).resolve()
assert out!=root and root not in out.parents, 'Output must be outside source'
subprocess.run(['node','--test',str(root/'server.test.mjs'),str(root/'temporary-proxy.test.mjs'),str(root/'github.test.mjs')],check=True)
subprocess.run(['node',str(root/'../frontend/tests/proxy-entry.mjs')],check=True)
out.mkdir(parents=True,exist_ok=False)
files=['server.mjs','server.test.mjs','build.py','README.md','workbench-proxy-control.service','temporary-proxy.mjs','temporary-proxy.test.mjs','github.mjs','github.test.mjs','github-local.mjs','github-run.mjs']
(out/'proxy').mkdir()
for name in files: shutil.copy2(root/name,out/'proxy'/name)
# Preserve the relative shared-auth import in the installed extensions layout.
shared=root/'../project-import/workbench-auth.mjs'
(out/'project-import').mkdir()
shutil.copy2(shared,out/'project-import/workbench-auth.mjs')
(out/'receipt.json').write_text(json.dumps({'files':{str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}},indent=2))
print('Validated proxy source snapshot:',out)
