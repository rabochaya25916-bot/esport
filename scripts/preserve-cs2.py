#!/usr/bin/env python3
"""Preserve generated CS2 content across independent GitHub Pages builds."""
import argparse
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

DATA = Path('assets/js/data/cs2')
IMAGES = Path('assets/img/xh')
ARCHIVE = 'data/cs2-content.tar.gz'


def download(base, relative, optional=False):
    url = base.rstrip('/') + '/' + str(relative) + '?t=' + str(time.time_ns())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404 and optional:
                return None
            if error.code == 404 or attempt == 2:
                raise RuntimeError(f'Cannot preserve published file: {relative} (HTTP {error.code})') from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 2:
                raise RuntimeError(f'Cannot preserve published file: {relative}') from error
        time.sleep(attempt + 1)
    raise RuntimeError('Download failed')


def config_paths(document):
    result = []
    for item in document['items']:
        identifier = str(item['id'])
        if not identifier or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in identifier):
            raise ValueError('Unsafe config ID')
        result.append(DATA / 'configs' / (identifier + '.json'))
    return result


def sheet_paths(document):
    sheet = document.get('xh_sheet')
    if not sheet:
        if document['items']:
            raise ValueError('Missing crosshair image manifest')
        return []
    if sheet['base'] != '/assets/img/xh/sheet-':
        raise ValueError('Unexpected image path')
    count = sheet['count']
    if not isinstance(count, int) or not 0 <= count <= 10000:
        raise ValueError('Invalid sheet count')
    return [IMAGES / f'sheet-{i}.png' for i in range(count)]


def validate(root):
    configs = json.loads((root / DATA / 'configs.json').read_text())
    crosshairs = json.loads((root / DATA / 'crosshairs.json').read_text())
    if not isinstance(configs['items'], list) or not isinstance(crosshairs['items'], list):
        raise ValueError('Invalid CS2 indexes')
    for relative in config_paths(configs):
        json.loads((root / relative).read_text())
    for relative in sheet_paths(crosshairs):
        if not (root / relative).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f'Invalid image: {relative}')


def extract_snapshot(payload, target):
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe snapshot entry')
            allowed = any(path == PurePosixPath(str(p)) or PurePosixPath(str(p)) in path.parents for p in [DATA, IMAGES])
            if not allowed:
                raise ValueError('Unexpected snapshot entry')
            destination = target / str(path)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError('Unreadable snapshot entry')
                with source, destination.open('wb') as output:
                    shutil.copyfileobj(source, output)


def restore(base, root=Path('.')):
    with tempfile.TemporaryDirectory() as temporary:
        staged = Path(temporary)
        payload = download(base, ARCHIVE, optional=True)
        if payload is not None:
            extract_snapshot(payload, staged)
        else:
            # First run after installing this fix: recover ALL live files,
            # including files that already exist with older contents in Git.
            indexes = {name: download(base, DATA / name, optional=True)
                       for name in ['configs.json', 'crosshairs.json']}
            if all(value is None for value in indexes.values()):
                validate(root)
                print('First publication: using repository CS2 data')
                return
            if any(value is None for value in indexes.values()):
                raise RuntimeError('Published CS2 indexes are incomplete; publication stopped')
            for name, value in indexes.items():
                destination = staged / DATA / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(value)
            configs = json.loads(indexes['configs.json'])
            crosshairs = json.loads(indexes['crosshairs.json'])
            paths = config_paths(configs) + sheet_paths(crosshairs)
            for relative in paths:
                destination = staged / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(download(base, relative))
            status = download(base, DATA / 'status.json', optional=True)
            (staged / DATA / 'status.json').write_bytes(status if status is not None else b'{}')
        validate(staged)
        # Replace only after the entire published set was recovered and validated.
        for relative in [DATA, IMAGES]:
            destination = root / relative
            if destination.exists():
                shutil.rmtree(destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = staged / relative
            if source.exists():
                shutil.copytree(source, destination)
            else:
                destination.mkdir(parents=True, exist_ok=True)
        print('Published CS2 data and images restored')


def pack(root=Path('.')):
    validate(root)
    target = root / ARCHIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    with tarfile.open(temporary, 'w:gz') as archive:
        for relative in [DATA, IMAGES]:
            if (root / relative).exists():
                archive.add(root / relative, arcname=str(relative))
    temporary.replace(target)
    print('CS2 snapshot ready for the next publication')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['restore', 'pack'])
    parser.add_argument('--base-url')
    args = parser.parse_args()
    if args.command == 'restore':
        if not args.base_url:
            parser.error('--base-url is required for restore')
        restore(args.base_url)
    else:
        pack()