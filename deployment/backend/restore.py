"""Restore the customized JS from the exact upstream bundle, without bundling the upstream runtime."""
import hashlib
import json
from pathlib import Path
import sys


def restore(base, manifest):
    digest = lambda content: hashlib.sha256(content).hexdigest()
    if digest(base) != manifest['baseSHA256']:
        raise ValueError('Unsupported upstream backend')
    lines = base.decode('utf8').split('\n')
    for start, count, replacements in reversed(manifest['edits']):
        lines[start:start + count] = replacements
    output = '\n'.join(lines).encode('utf8')
    if digest(output) != manifest['outputSHA256']:
        raise ValueError('Backend verification failed')
    return output


if __name__ == '__main__':
    source, destination = map(Path, sys.argv[1:])
    manifest = json.loads(Path(__file__).with_name('changes.json').read_text())
    with destination.open('xb') as stream:
        stream.write(restore(source.read_bytes(), manifest))
