"""A fresh installation never discovers existing accounts or session directories."""
import json, os, pathlib, sqlite3, subprocess, sys

SOURCE = pathlib.Path(__file__).resolve().parents[1]

def test_fresh_install_is_empty_and_credentials_are_explicit(tmp_path):
    home = tmp_path / 'home'
    for name in ['.codex/sessions', '.dsh/sessions']:
        folder = home / name
        folder.mkdir(parents=True)
        (folder / 'session.jsonl').write_text('{"private":"must not be discovered"}')
    data = tmp_path / 'memory'
    env = {k:v for k,v in os.environ.items() if not k.startswith('MEMORY_')}
    env.update(HOME=str(home), MEMORY_DATA=str(data))
    subprocess.run([sys.executable, str(SOURCE / 'initialize.py')], env=env, check=True)
    token = (data / 'bridge-token').read_bytes()
    assert len(token) > 40
    assert (data / 'bridge-token').stat().st_mode & 0o777 == 0o600
    subprocess.run([sys.executable, str(SOURCE / 'initialize.py')], env=env, check=True)
    assert (data / 'bridge-token').read_bytes() == token
    with sqlite3.connect(data / 'catalog.sqlite') as db:
        for table in ['sources', 'sessions', 'messages', 'jobs', 'banks']:
            assert db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
    probe = subprocess.run([sys.executable, '-c', 'import core; print(len(core.sources()))'], cwd=SOURCE, env=env, check=True, capture_output=True, text=True)
    assert probe.stdout.strip() == '0'
    missing = subprocess.run([sys.executable, str(SOURCE / 'model_config.py'), '--connection'], env=env, capture_output=True, text=True)
    assert missing.returncode != 0
    env.update(MEMORY_MODEL_BASE_URL='https://model.example/v1', MEMORY_MODEL_API_KEY='synthetic-test-key')
    configured = subprocess.run([sys.executable, str(SOURCE / 'model_config.py'), '--connection'], env=env, check=True, capture_output=True, text=True)
    assert json.loads(configured.stdout) == {'baseUrl':'https://model.example/v1','apiKey':'synthetic-test-key'}
