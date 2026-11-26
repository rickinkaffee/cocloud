"""Read the selected Codex provider's catalog without returning its credentials."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib
import urllib.request

STATE = Path(os.environ.get('WORKBENCH_USERDATA', Path.home() / '.t3' / 'userdata'))


def discover(instance_id, state=STATE, environ=None, opener=urllib.request.urlopen):
    settings = json.loads((state / 'settings.json').read_text())
    instance = settings.get('providerInstances', {}).get(instance_id)
    if not instance or instance.get('driver') != 'codex' or instance.get('enabled') is False:
        raise ValueError('unsupported_provider')
    config = instance.get('config', {})
    home = Path(config.get('homePath') or os.environ.get('CODEX_HOME', Path.home() / '.codex')).expanduser()
    codex = tomllib.loads((home / 'config.toml').read_text())
    provider = codex.get('model_providers', {}).get(codex.get('model_provider'), {})
    base = provider.get('base_url', '')
    if not base.startswith(('https://', 'http://127.0.0.1:', 'http://localhost:')):
        raise ValueError('catalog_not_configured')
    if environ is None:
        # Use the same environment as the running Codex host, including its configured env_key.
        pid = subprocess.check_output(['systemctl', 'show', 'cocloud-t3.service',
                                      '-p', 'MainPID', '--value'], text=True, timeout=5).strip()
        environ = dict(row.split('=', 1) for row in Path('/proc', pid, 'environ').read_text().split('\0') if '=' in row)
    key = environ.get(provider.get('env_key', 'OPENAI_API_KEY')) or provider.get('experimental_bearer_token')
    if not key:
        raise ValueError('catalog_not_configured')
    request = urllib.request.Request(base.rstrip('/') + '/models', headers={
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
    })
    # Do not follow redirects with an Authorization header.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    if opener is urllib.request.urlopen:
        opener = urllib.request.build_opener(NoRedirect).open
    with opener(request, timeout=20) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('invalid_catalog')
    rows = json.loads(raw).get('data')
    if not isinstance(rows, list):
        raise ValueError('invalid_catalog')
    ids = set()
    for row in rows:
        slug = row.get('id') if isinstance(row, dict) else None
        # Codex uses Responses chat models; image/audio/embedding models cannot run coding turns.
        if not isinstance(slug, str) or not re.fullmatch(r'(?:gpt-[a-zA-Z0-9._-]+|o[1-9][a-zA-Z0-9._-]*)', slug):
            continue
        if re.search(r'image|audio|realtime|transcrib|tts|embedding|moderation|search', slug, re.I):
            continue
        ids.add(slug)
    if not ids:
        raise ValueError('empty_catalog')
    return {'instanceId': instance_id, 'environmentId': (state / 'environment-id').read_text().strip(),
            'models': [{'slug': slug, 'name': re.sub(r'^gpt-', 'GPT-', slug).replace('-sol', ' Sol').replace('-astra', ' Astra').replace('-luna', ' Luna')}
                       for slug in sorted(ids, reverse=True)]}


if __name__ == '__main__':
    try:
        print(json.dumps(discover(sys.argv[1]), ensure_ascii=False))
    except Exception:
        # Provider errors can contain credentials or private connection details.
        print(json.dumps({'error': 'model_catalog_unavailable'}))
        sys.exit(1)
