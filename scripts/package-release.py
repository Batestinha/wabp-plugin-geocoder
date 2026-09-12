"""Build a reproducible, self-contained WABS archive without unused geo-tz datasets."""
from pathlib import Path
import gzip
import hashlib
import io
import json
import os
import subprocess
import tarfile
import tempfile


def build_release():
    root = Path(__file__).resolve().parents[1]
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    provenance = json.loads((root / 'provenance.json').read_text(encoding='utf-8'))
    sdk = root / provenance['sdk']['path']
    if hashlib.sha256(sdk.read_bytes()).hexdigest() != provenance['sdk']['sha256']:
        raise ValueError('Pinned SDK provenance mismatch')
    omissions = {'package/node_modules/geo-tz/' + p for p in provenance['timezoneData']['packagingOmissions']}
    expected_omissions = {
        'package/node_modules/geo-tz/data/timezones-1970.geojson.geo.dat',
        'package/node_modules/geo-tz/data/timezones-1970.geojson.index.json',
        'package/node_modules/geo-tz/data/timezones-now.geojson.geo.dat',
        'package/node_modules/geo-tz/data/timezones-now.geojson.index.json',
    }
    if omissions != expected_omissions:
        raise ValueError('Unexpected timezone data packaging policy')
    cache = root / '.cache'
    cache.mkdir(exist_ok=True)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    with tempfile.TemporaryDirectory(prefix='geocoder-pack-') as temporary:
        result = subprocess.run([npm, 'pack', '--pack-destination', temporary, '--json'], cwd=root,
                                capture_output=True, text=True, encoding='utf-8', check=True)
        info = json.loads(result.stdout[result.stdout.index('[\n'):])[0]
        packed = Path(temporary) / info['filename']
        files = {}
        omitted = {}
        with tarfile.open(packed, 'r:gz') as archive:
            for member in archive.getmembers():
                if not member.isfile() or member.name in files:
                    raise ValueError('Unexpected non-file or duplicate archive entry')
                if '..' in Path(member.name).parts or not member.name.startswith('package/'):
                    raise ValueError('Unsafe archive entry')
                data = archive.extractfile(member).read()
                if member.name in omissions:
                    omitted[member.name] = hashlib.sha256(data).hexdigest()
                else:
                    files[member.name] = data
        if set(omitted) != omissions:
            raise ValueError('Pinned geo-tz data layout changed')
        geo = json.loads(files['package/node_modules/geo-tz/package.json'])
        if geo['version'] != provenance['timezoneData']['version']:
            raise ValueError('Installed timezone dependency differs from provenance')
        for required in ['package/dist/index.js', 'package/wa-plugin.json',
                         'package/node_modules/@wabs/plugin-sdk/dist/clock.js',
                         'package/node_modules/geo-tz/data/timezones.geojson.geo.dat',
                         'package/node_modules/geo-tz/data/timezones.geojson.index.json']:
            if required not in files:
                raise ValueError('Missing runtime file: ' + required)
        # The comprehensive dataset remains byte-for-byte identical to the locked npm input.
        files['package/packaging.json'] = (json.dumps({
            'schemaVersion': 1,
            'upstreamNpmArchiveSha256': hashlib.sha256(packed.read_bytes()).hexdigest(),
            'omittedUnusedFiles': omitted,
            'retainedComprehensiveData': {
                name: hashlib.sha256(data).hexdigest() for name, data in files.items()
                if name.startswith('package/node_modules/geo-tz/data/')
            }
        }, sort_keys=True, indent=2) + '\n').encode()
        target = cache / ('official.geocoder-' + package['version'] + '.tgz')
        with target.open('wb') as raw:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=9) as compressed:
                with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                    for name, data in sorted(files.items()):
                        header = tarfile.TarInfo(name)
                        header.size = len(data)
                        header.mode = 0o644
                        header.mtime = 0
                        header.uid = header.gid = 0
                        archive.addfile(header, io.BytesIO(data))
        if target.stat().st_size > 50 * 1024 * 1024:
            raise ValueError('Release exceeds WABP archive download budget')
        print(json.dumps({'archive': str(target), 'bytes': target.stat().st_size,
                          'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                          'files': len(files)}))


if __name__ == '__main__':
    build_release()
