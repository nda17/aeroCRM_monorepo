#!/usr/bin/env python3
"""Measure Docker save archives without extracting files or assuming compression ratios."""
import gzip
import io
import json
import sys
import tarfile


class CountingReader:
    def __init__(self, source):
        self.source = source
        self.count = 0

    def read(self, size=-1):
        data = self.source.read(size)
        self.count += len(data)
        return data


def count_stream(source):
    count = 0
    while chunk := source.read(1024 * 1024):
        count += len(chunk)
    return count


def inspect_archive(filename):
    manifest = None
    layers = {}
    seen = set()
    with gzip.open(filename, 'rb') as compressed:
        outer = CountingReader(compressed)
        with tarfile.open(fileobj=outer, mode='r|') as archive:
            for member in archive:
                name = member.name.removeprefix('./')
                if name in seen:
                    raise ValueError('Duplicate Docker archive member')
                seen.add(name)
                if not member.isfile():
                    layers[name] = None
                    continue
                stream = archive.extractfile(member)
                if name == 'manifest.json':
                    if member.size > 1024 * 1024:
                        raise ValueError('Docker archive manifest is too large')
                    manifest = json.load(stream)
                    continue
                prefix = stream.read(6)
                if prefix.startswith(b'\x1f\x8b'):
                    # Members stay compressed in the containerd content store and are also unpacked.
                    # Prepend the signature already consumed without reading the layer into memory.
                    class PrefixedReader:
                        def __init__(self):
                            self.prefix = io.BytesIO(prefix)

                        def read(self, size=-1):
                            head = self.prefix.read(size)
                            return head + stream.read(size - len(head) if size >= 0 else -1)

                    with gzip.GzipFile(fileobj=PrefixedReader()) as nested:
                        layers[name] = count_stream(nested)
                elif prefix.startswith((b'\x28\xb5\x2f\xfd', b'BZh', b'\xfd7zXZ\x00')):
                    layers[name] = 'unsupported-compression'
                else:
                    layers[name] = member.size
        # Include all outer tar padding; tarfile stops at its end marker before the gzip EOF.
        count_stream(outer)
        expanded_bytes = outer.count
    if not isinstance(manifest, list) or not manifest:
        raise ValueError('Docker save manifest.json is required')
    selected = set()
    for image in manifest:
        if not isinstance(image, dict) or not isinstance(image.get('Layers'), list):
            raise ValueError('Invalid Docker save layer manifest')
        for layer in image['Layers']:
            if not isinstance(layer, str) or layer.startswith('/') or '..' in layer.split('/'):
                raise ValueError('Invalid Docker save layer path')
            layer = layer.removeprefix('./')
            if layer not in layers or layers[layer] is None:
                raise ValueError('Docker save layer is missing or not a regular file')
            if not isinstance(layers[layer], int):
                raise ValueError('Unsupported Docker save layer compression')
            selected.add(layer)
    unpacked_bytes = sum(layers[layer] for layer in selected)
    return {
        'expandedBytes': expanded_bytes,
        'unpackedLayerBytes': unpacked_bytes,
        'storageBytes': expanded_bytes + unpacked_bytes,
    }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: backend-archive.py image.tar.gz')
    print(json.dumps(inspect_archive(sys.argv[1])))
