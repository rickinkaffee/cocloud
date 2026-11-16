"""Required Android release contract for every frontend directory replacement."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import zipfile

CAPABILITY = 'native-blob-download-v1'

def verify_release(folder):
    folder = Path(folder)
    envelope = json.loads((folder / 'latest.json').read_text())
    metadata = json.loads(base64.b64decode(envelope['payload'], validate=True))
    if CAPABILITY not in metadata.get('capabilities', []):
        raise ValueError('Release lacks native Blob download support; rebuild from canonical Android source')
    name = metadata['filename']
    if Path(name).name != name or not name.endswith('.apk'):
        raise ValueError('Unsafe APK filename')
    apk = folder / name
    data = apk.read_bytes()
    if len(data) != metadata['bytes'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
        raise ValueError('APK does not match release manifest')
    with zipfile.ZipFile(apk) as archive:
        script = archive.read('assets/blob-download.js')
        if hashlib.sha256(script).hexdigest() != metadata.get('blobTransportSha256'):
            raise ValueError('Native download transport is absent or stale')
        dex = archive.read('classes.dex')
        for marker in (b'Lcn/cocloud/workbench/BlobDownloads;', b'Lcn/cocloud/workbench/DownloadPolicy;', b'blob-download.js'):
            if marker not in dex:
                raise ValueError('APK is missing native download implementation')
    return metadata

def atomic_copy(source, target):
    target = Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + '.publishing')
    shutil.copyfile(source, temp); temp.chmod(0o644); os.replace(temp, target)

def prepare_frontend(current, incoming, canonical):
    """Keep APKs independent of frontend bundles. Fail closed if release is invalid."""
    current, incoming, canonical = map(Path, (current, incoming, canonical))
    release = verify_release(canonical)
    for folder in (current / 'downloads', incoming / 'downloads'):
        manifest = folder / 'latest.json'
        if manifest.exists():
            old = json.loads(base64.b64decode(json.loads(manifest.read_text())['payload']))
            if old['versionCode'] > release['versionCode']:
                raise ValueError('Canonical release is older than frontend release; do not downgrade')
            if old['versionCode'] == release['versionCode'] and old['sha256'] != release['sha256']:
                raise ValueError('Same version has different APK contents')
    downloads = incoming / 'downloads'; downloads.mkdir(exist_ok=True, parents=True)
    if (current / 'downloads').exists():
        for apk in (current / 'downloads').glob('cocloud-android-*.apk'):
            if not (downloads / apk.name).exists(): atomic_copy(apk, downloads / apk.name)
    atomic_copy(canonical / release['filename'], downloads / release['filename'])
    atomic_copy(canonical / release['filename'], downloads / 'cocloud-android.apk')
    atomic_copy(canonical / 'latest.json', downloads / 'latest.json')
    verify_release(downloads)
    return release
