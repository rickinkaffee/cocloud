from pathlib import Path
import base64
import json
import shutil
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release_guard import verify_release, prepare_frontend

def reject(fn):
    try: fn()
    except (ValueError, KeyError, FileNotFoundError): return
    raise AssertionError('Expected deployment to be blocked')

build = Path(sys.argv[1]); metadata = verify_release(build)
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp); old = root/'old'; new = root/'new'; canonical = root/'canonical'
    old.mkdir(); new.mkdir(); canonical.mkdir()
    for name in ('latest.json', metadata['filename']): shutil.copy2(build/name, canonical/name)
    (new/'index.html').write_text('<script src="/assets/new-unpatched-bundle.js"></script>')
    (new/'downloads').mkdir(); legacy = dict(metadata, versionCode=5, version='1.0.4', capabilities=[])
    (new/'downloads/latest.json').write_text(json.dumps({'payload':base64.b64encode(json.dumps(legacy).encode()).decode()}))
    prepare_frontend(old, new, canonical)
    assert verify_release(new/'downloads')['sha256'] == metadata['sha256']
    assert (new/'downloads/cocloud-android.apk').read_bytes() == (build/metadata['filename']).read_bytes()
    assert 'new-unpatched-bundle' in (new/'index.html').read_text()
    saved = (canonical/'latest.json').read_bytes()
    envelope = json.loads(saved); body = dict(metadata, capabilities=[])
    envelope['payload'] = base64.b64encode(json.dumps(body).encode()).decode()
    (canonical/'latest.json').write_text(json.dumps(envelope))
    reject(lambda: prepare_frontend(old, new, canonical))
    (canonical/'latest.json').write_bytes(saved)
    (canonical/metadata['filename']).write_bytes(b'bad apk')
    reject(lambda: prepare_frontend(old, new, canonical))
print('Release regression passed: clean frontend/old package preserves native fix; missing capability and corrupt APK block publication.')
