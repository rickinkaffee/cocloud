"""Initialize fresh memory state; do not discover another application's accounts."""
import os,secrets
from core import init,ROOT
init()
p=ROOT/'bridge-token'
if not p.exists():
 with open(p,'x',opener=lambda path,flags:os.open(path,flags,0o600)) as f:
  f.write(secrets.token_urlsafe(48)+'\n')
print('Initialized memory state; bridge credential remains in the private data directory.')
