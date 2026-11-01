import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / 'scripts' / 'preserve-cs2.py'
spec = importlib.util.spec_from_file_location('preserve_cs2', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(root, version):
    data = root / module.DATA
    (data / 'configs').mkdir(parents=True, exist_ok=True)
    (data / 'configs.json').write_text(json.dumps({'items': [{'id': '123'}], 'last_success_at': version}))
    (data / 'configs' / '123.json').write_text(json.dumps({'version': version}))
    (data / 'crosshairs.json').write_text(json.dumps({'items': [{'code': version}], 'xh_sheet': {'base': '/assets/img/xh/sheet-', 'count': 1}}))
    (data / 'status.json').write_text('{}')
    images = root / module.IMAGES
    images.mkdir(parents=True, exist_ok=True)
    (images / 'sheet-0.png').write_bytes(b'\x89PNG\r\n\x1a\n' + version.encode())


class PreservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.live = Path(self.temp.name) / 'live'
        self.checkout = Path(self.temp.name) / 'checkout'
        fixture(self.live, 'fresh-full-update')
        fixture(self.checkout, 'old-repository')

    def fetch(self, base, relative, optional=False):
        path = self.live / relative
        if not path.exists():
            if optional:
                return None
            raise RuntimeError('Unavailable published file')
        return path.read_bytes()

    def assert_fresh(self):
        self.assertEqual(json.loads((self.checkout / module.DATA / 'configs' / '123.json').read_text())['version'], 'fresh-full-update')
        self.assertEqual((self.checkout / module.IMAGES / 'sheet-0.png').read_bytes(), b'\x89PNG\r\n\x1a\nfresh-full-update')

    def test_first_install_replaces_existing_old_config_and_images(self):
        with patch.object(module, 'download', side_effect=self.fetch):
            module.restore('https://example.invalid', self.checkout)
        self.assert_fresh()

    def test_quick_update_preserves_full_snapshot_including_extra_files(self):
        (self.live / module.DATA / 'extra.json').write_text('{"new":true}')
        module.pack(self.live)
        with patch.object(module, 'download', side_effect=self.fetch):
            module.restore('https://example.invalid', self.checkout)
        self.assert_fresh()
        self.assertTrue((self.checkout / module.DATA / 'extra.json').exists())
        module.pack(self.checkout)
        with tarfile.open(self.checkout / module.ARCHIVE) as archive:
            entry = archive.extractfile('assets/js/data/cs2/configs/123.json')
            self.assertIsNotNone(entry)
            self.assertEqual(json.load(entry)['version'], 'fresh-full-update')

    def test_missing_published_image_stops_publication_before_replacing_data(self):
        (self.live / module.IMAGES / 'sheet-0.png').unlink()
        with patch.object(module, 'download', side_effect=self.fetch):
            with self.assertRaises(RuntimeError):
                module.restore('https://example.invalid', self.checkout)
        self.assertEqual(json.loads((self.checkout / module.DATA / 'configs' / '123.json').read_text())['version'], 'old-repository')

    def test_archive_cannot_write_outside_generated_paths(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode='w:gz') as archive:
            entry = tarfile.TarInfo('../outside.txt')
            entry.size = 1
            archive.addfile(entry, io.BytesIO(b'x'))
        with self.assertRaises(ValueError):
            module.extract_snapshot(payload.getvalue(), self.checkout)


if __name__ == '__main__':
    unittest.main()