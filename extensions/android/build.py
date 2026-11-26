"""Build the small Android client with pinned Android SDK 35 tools and JDK 17."""
import hashlib
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

raise SystemExit("Android APK retired; use the web application")
source = Path(__file__).resolve().parent
toolchain = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
origin = os.environ.get('WORKBENCH_ORIGIN', 'https://workbench.example')
from urllib.parse import urlsplit
parsed = urlsplit(origin)
if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
    raise ValueError('WORKBENCH_ORIGIN must be a canonical HTTPS origin without a trailing slash')
output.mkdir(parents=True, exist_ok=True)
build = output / 'build'
build.mkdir(exist_ok=True)
sdk = toolchain / 'sdk'
platform = next(sdk.rglob('android.jar'))
tools = next(path.parent for path in sdk.rglob('aapt2') if path.is_file())
java = toolchain / 'jdk/usr/lib/jvm/java-17-openjdk-amd64'
env = dict(os.environ, JAVA_HOME=str(java), PATH=str(java / 'bin') + os.pathsep + os.environ['PATH'])

def run(*args):
    subprocess.run([str(arg) for arg in args], env=env, check=True)

private = Path(os.environ.get('ANDROID_SIGNING_DIR',str(output / 'signing'))).resolve()
private.mkdir(mode=0o700, exist_ok=True)
os.chmod(private, 0o700)
key = private / 'cocloud-android.p12'
password = private / 'password'
if not key.exists():
    assert not password.exists(), 'Orphaned password: review before creating a new signing identity'
    password.write_text(secrets.token_urlsafe(40))
    os.chmod(password, 0o600)
    run(java / 'bin/keytool', '-genkeypair', '-keystore', key, '-storetype', 'PKCS12',
        '-storepass:file', password, '-alias', 'cocloud', '-keyalg', 'RSA', '-keysize', '3072',
        '-validity', '10000', '-dname', 'CN=Cocloud Android, O=Cocloud, C=CN')
os.chmod(key, 0o600)
certificate = subprocess.check_output(['openssl', 'pkcs12', '-in', str(key), '-passin', 'file:' + str(password), '-clcerts', '-nokeys'])
public_pem = subprocess.check_output(['openssl', 'x509', '-pubkey', '-noout'], input=certificate)
public_der = subprocess.check_output(['openssl', 'pkey', '-pubin', '-outform', 'DER'], input=public_pem)
public_key = base64.b64encode(public_der).decode()
generated = build / 'generated/cn/cocloud/workbench/UpdateTrust.java'
generated.parent.mkdir(parents=True, exist_ok=True)
generated.write_text('package cn.cocloud.workbench; final class UpdateTrust { static final String PUBLIC_KEY = "' + public_key + '"; }')
config = build / 'generated/cn/cocloud/workbench/BuildConfig.java'
config.write_text('package cn.cocloud.workbench; final class BuildConfig { static final String ORIGIN = ' + json.dumps(origin) + '; }')
manifest = ET.parse(source / 'AndroidManifest.xml').getroot()
namespace = '{http://schemas.android.com/apk/res/android}'
version = manifest.attrib[namespace + 'versionName']
version_code = int(manifest.attrib[namespace + 'versionCode'])

# These policy tests run against the same pure Java code included in the APK.
test_classes = build / 'test-classes'
test_classes.mkdir(exist_ok=True)
run(java / 'bin/javac', '-encoding', 'UTF-8', '-d', test_classes,
    source / 'src/cn/cocloud/workbench/UpdatePolicy.java', source / 'tests/UpdatePolicyTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.UpdatePolicyTest')
run(sys.executable, source / 'tests/update_install_test.py', java)
run(java / 'bin/javac', '-encoding', 'UTF-8', '-d', test_classes,
    source / 'src/cn/cocloud/workbench/TaskCompletionGate.java', source / 'tests/TaskCompletionGateTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.TaskCompletionGateTest')

# Predictive-back lifecycle and progress dispatch are mandatory regression gates.
run(java / 'bin/javac', '-encoding', 'UTF-8', '-d', test_classes,
    source / 'src/cn/cocloud/workbench/SidebarBackGesture.java', source / 'tests/SidebarBackGestureTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.SidebarBackGestureTest')
run('node', source / 'tests/sidebar-back-integration.test.mjs', java / 'bin/java', test_classes)

# Camera capture and download regressions are required build gates.
run(java / 'bin/javac', '-encoding', 'UTF-8', '-d', test_classes,
    source / 'src/cn/cocloud/workbench/CameraPolicy.java', source / 'tests/CameraPolicyTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.CameraPolicyTest')
run(java / 'bin/javac', '-encoding', 'UTF-8', '-d', test_classes,
    config, source / 'src/cn/cocloud/workbench/DownloadPolicy.java', source / 'tests/DownloadPolicyTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.DownloadPolicyTest')
run(java / 'bin/javac', '-encoding', 'UTF-8', '-cp', test_classes, '-d', test_classes,
    source / 'src/cn/cocloud/workbench/ConversationResume.java', source / 'tests/ConversationResumeTest.java')
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.ConversationResumeTest')
run('node', source / 'tests/blob-download.test.mjs')

run(tools / 'aapt2', 'compile', '--dir', source / 'res', '-o', build / 'resources.zip')
run(tools / 'aapt2', 'link', '-o', build / 'resources.apk', '--manifest', source / 'AndroidManifest.xml',
    '-I', platform, '-A', source / 'assets', '--java', build / 'generated', build / 'resources.zip')
classes = build / 'classes'
if classes.exists():
    shutil.rmtree(classes)
classes.mkdir(exist_ok=True)
run(java / 'bin/javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', platform,
    '-d', classes, *sorted((build / 'generated').rglob('*.java')), *sorted((source / 'src').rglob('*.java')))
jar = build / 'classes.jar'
with zipfile.ZipFile(jar, 'w') as archive:
    for path in sorted(classes.rglob('*.class')):
        archive.write(path, path.relative_to(classes).as_posix())
dex = build / 'dex'
dex.mkdir(exist_ok=True)
run(tools / 'd8', '--release', '--min-api', '29', '--lib', platform, '--output', dex, jar)
unsigned = build / 'unsigned.apk'
shutil.copyfile(build / 'resources.apk', unsigned)
with zipfile.ZipFile(unsigned, 'a') as archive:
    archive.write(dex / 'classes.dex', 'classes.dex')
aligned = build / 'aligned.apk'
run(tools / 'zipalign', '-f', '-p', '4', unsigned, aligned)
apk = output / f'cocloud-android-{version}.apk'
run(tools / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'cocloud',
    '--ks-pass', 'file:' + str(password), '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
    '--v4-signing-enabled', 'false', '--out', apk, aligned)
verification = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], env=env, text=True)
print(verification)
for minimum, maximum, scheme in ((21, 23, 'v1 scheme (JAR signing)'),
                                 (24, 27, 'v2 scheme (APK Signature Scheme v2)'),
                                 (28, 35, 'v3 scheme (APK Signature Scheme v3)')):
    result = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose',
        '--min-sdk-version', str(minimum), '--max-sdk-version', str(maximum), str(apk)], env=env, text=True)
    assert f'Verified using {scheme}: true' in result, 'Missing compatibility signature: ' + scheme
    print('Verified compatibility signature:', scheme)
run(tools / 'zipalign', '-c', '4', apk)
with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None, 'Invalid APK ZIP entry'
    assert archive.read('assets/blob-download.js') == (source / 'assets/blob-download.js').read_bytes(), 'Blob transport missing or stale in APK'
    assert b'Lcn/cocloud/workbench/SidebarBackGesture;' in archive.read('classes.dex'), 'Predictive-back implementation missing from APK'
    assert b'Lcn/cocloud/workbench/CameraProvider;' in archive.read('classes.dex'), 'Camera provider missing'
    assert b'Lcn/cocloud/workbench/UpdateInstallState;' in archive.read('classes.dex'), 'Update reconciliation missing'
    assert archive.getinfo('resources.arsc').compress_type == zipfile.ZIP_STORED
run(tools / 'aapt2', 'dump', 'badging', apk)
metadata = {'schema': 1, 'packageName': manifest.attrib['package'], 'version': version, 'versionCode': version_code,
            'filename': apk.name, 'bytes': apk.stat().st_size,
            'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'minAndroid': '10',
            'origin': origin + '/',
            'capabilities': ['native-blob-download-v1', 'sidebar-predictive-back-v1', 'native-camera-capture-v1'],
            'blobTransportSha256': hashlib.sha256((source / 'assets/blob-download.js').read_bytes()).hexdigest(),
            'notes': '移除工作台 App 的自定义边缘滑动。Android 14 及以上使用系统返回手势控制侧栏；旧版 Android 可通过按钮打开侧栏。'}
signing_key = private / 'manifest-signing.pem'
if not signing_key.exists():
    key_bytes = subprocess.check_output(['openssl', 'pkcs12', '-in', str(key), '-passin', 'file:' + str(password), '-nocerts', '-nodes'])
    with open(signing_key, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
        file.write(key_bytes.decode())
os.chmod(signing_key, 0o600)
payload = json.dumps(metadata, separators=(',', ':'), ensure_ascii=False).encode()
signature = subprocess.check_output(['openssl', 'dgst', '-sha256', '-sign', str(signing_key)], input=payload)
envelope = {'payload': base64.b64encode(payload).decode(), 'signature': base64.b64encode(signature).decode()}
run(java / 'bin/java', '-cp', test_classes, 'cn.cocloud.workbench.UpdatePolicyTest',
    public_key, envelope['payload'], envelope['signature'])
(output / 'latest.json').write_text(json.dumps(envelope, indent=2) + '\n')
(output / 'release-receipt.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(metadata))

# Bind tested source and regression scripts to this exact APK. Publisher rejects stale builds.
files = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in source.rglob('*') if p.is_file() and '.git' not in p.parts
         and '__pycache__' not in p.parts and p.suffix in ('.java', '.js', '.mjs', '.py', '.xml')}
(output / 'source-receipt.json').write_text(json.dumps({'files': files, 'apkSha256': metadata['sha256']}, indent=2))
run(sys.executable, source / 'tests/release_guard_test.py', output)
