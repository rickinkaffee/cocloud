import hashlib
import re
import subprocess
from pathlib import Path

TYPES = {'main': (r'main-[A-Za-z0-9_-]+-source-[a-f0-9]{12}\.js', 'text/javascript'),
         'motion': (r'mobile-gesture-source-[a-f0-9]{12}\.css', 'text/css')}
BEGIN = ' # BEGIN workbench fingerprint cache\n'
END = ' # END workbench fingerprint cache\n'


def check_files(folder):
    for path in folder.iterdir():
        if any(re.fullmatch(pattern, path.name) for pattern, _ in TYPES.values()):
            if hashlib.sha256(path.read_bytes()).hexdigest()[:12] != path.stem[-12:]:
                raise ValueError(f'Fingerprint mismatch: {path.name}')


def rules(upstream):
    result = BEGIN
    for name, (pattern, mime) in TYPES.items():
        result += f''' @wb_{name} path_regexp wb_{name} ^/assets/{pattern}$
 handle @wb_{name} {{
  reverse_proxy {upstream} {{
   @typed {{
    status 200
    header Content-Type {mime}*
   }}
   handle_response @typed {{
    header {{
     Cache-Control "private, max-age=31536000, immutable"
     defer
    }}
    copy_response
   }}
  }}
 }}
'''
    return result + END


def install(config, assets, previous):
    check_files(assets)
    original = config.read_text()
    old = original
    if BEGIN in old or END in old:
        if old.count(BEGIN) != 1 or old.count(END) != 1:
            raise ValueError('Ambiguous cache policy')
        old = old[:old.index(BEGIN)] + old[old.index(END) + len(END):]
    anchor = ' # Authenticated WeChat trial desktop and API\n'
    if old.count(anchor) != 1:
        raise ValueError('Ambiguous workbench host')
    updated = old.replace(anchor, rules('127.0.0.1:3773') + anchor)
    if original == updated:
        return
    pending = config.with_name('.workbench-cache-next')
    previous.write_text(original)
    try:
        pending.write_text(updated)
        pending.chmod(0o644)
        subprocess.run(['caddy', 'validate', '--config', str(pending), '--adapter', 'caddyfile'], check=True)
        if config.read_text() != original:
            raise RuntimeError('Caddy configuration changed during validation')
        pending.replace(config)
        try:
            subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        except subprocess.CalledProcessError:
            pending.write_text(original)
            pending.chmod(0o644)
            pending.replace(config)
            subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
            raise
    finally:
        pending.unlink(missing_ok=True)
