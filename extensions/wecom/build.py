"""Stage portable WeCom sources; publish only after the packaged tests pass."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parent
target = Path(sys.argv[1]).resolve()
if target.exists() or target.is_relative_to(source):
    raise SystemExit('Choose a new output directory outside the source tree')
target.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
    stage = Path(temporary) / 'release'
    package = stage / 'wecom'
    package.mkdir(parents=True)
    for name in ('gateway.mjs', 'gateway.test.mjs', 'README.md', 'wecom.caddy', 'wecom-gateway.service'):
        shutil.copy2(source / name, package / name)
    shutil.copy2(source.parents[1] / 'config/wecom.env.example', package)
    subprocess.run(['node', '--test', 'gateway.test.mjs'], cwd=package, check=True)
    os.rename(stage, target)
print('Verified staged WeCom release:', target)
