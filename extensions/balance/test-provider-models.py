import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('provider-models.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class ModelCatalogTests(unittest.TestCase):
    def test_configured_provider_auth_filter_and_deduplication(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            home = state / 'codex'
            home.mkdir()
            (state / 'settings.json').write_text(json.dumps({'providerInstances': {'test': {
                'driver': 'codex', 'config': {'homePath': str(home)}}}}))
            (state / 'environment-id').write_text('test-environment')
            (home / 'config.toml').write_text('model_provider="vendor"\n[model_providers.vendor]\nbase_url="https://example.test/v1"\nenv_key="TEST_MODEL_KEY"\n')

            def opener(request, timeout):
                self.assertEqual(request.full_url, 'https://example.test/v1/models')
                self.assertEqual(request.get_header('Authorization'), 'Bearer test-only-secret')
                self.assertEqual(timeout, 20)
                return io.BytesIO(json.dumps({'data': [{'id': x} for x in [
                    'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.2-sol', 'o3',
                    'gpt-image-1', 'gpt-4o-audio', 'claude-opus', '<script>', None]]}).encode())

            result = catalog.discover('test', state, {'TEST_MODEL_KEY': 'test-only-secret'}, opener)
            self.assertEqual({x['slug'] for x in result['models']}, {'gpt-6.2-sol', 'gpt-6.2-astra', 'o3'})
            self.assertEqual(result['environmentId'], 'test-environment')
            self.assertNotIn('secret', json.dumps(result))
            self.assertNotIn('example.test', json.dumps(result))
            with self.assertRaises(ValueError):
                catalog.discover('missing', state, {}, opener)
            with self.assertRaises(ValueError):
                catalog.discover('test', state, {}, opener)
            with self.assertRaises(ValueError):
                catalog.discover('test', state, {'TEST_MODEL_KEY': 'test'}, lambda *a, **k: io.BytesIO(b'{"data":[]}'))


if __name__ == '__main__':
    unittest.main()
