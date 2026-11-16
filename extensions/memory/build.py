"""Build a source snapshot and receipt after mandatory regression checks."""
from pathlib import Path
import sys,subprocess,shutil,hashlib,json
root=Path(__file__).resolve().parent
output=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'output'
if output==root or root.is_relative_to(output):raise ValueError('Output must not contain source')
subprocess.run(['node',str(root/'theme-build.mjs')],check=True)
subprocess.run([sys.executable,'-m','pytest','-q',str(root/'tests')],check=True)
for name in ['auth.mjs','model-router.mjs','ui.mjs']:subprocess.run(['node',str(root/'tests'/name)],check=True)
for p in root.glob('*.mjs'):subprocess.run(['node','--check',str(p)],check=True)
for p in root.glob('*.py'):compile(p.read_text(),str(p),'exec')
if output.exists():shutil.rmtree(output)
shutil.copytree(root,output,ignore=shutil.ignore_patterns('node_modules','output','__pycache__','.pytest_cache'))
files={str(p.relative_to(output)):hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
(output/'receipt.json').write_text(json.dumps({'files':files,'tests':'pytest, auth, model router, real Chromium UI'},indent=2)+'\n')
print(output)
