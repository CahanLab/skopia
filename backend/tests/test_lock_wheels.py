"""Every PyPI package in pixi.lock must be a prebuilt wheel on every platform.

A source distribution in the lock means `pixi install` compiles it on the
user's machine. gseapy (a PySingleCellNet dependency) publishes no Intel-Mac
wheel, so the `pyscn` environment locked its tarball for osx-64 and a clean
install there stopped at "can't find Rust compiler". Nothing in the suite saw
it: the lock resolves per platform, and the machines that wrote it had wheels.
"""
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
LOCK = REPO / 'pixi.lock'


def _source_builds() -> list[str]:
    lock = yaml.safe_load(LOCK.read_text())
    found = []
    for env_name, env in lock['environments'].items():
        for platform, packages in env['packages'].items():
            for entry in packages:
                url = entry.get('pypi')
                # A bare path is the editable `skopia` package itself.
                if url is None or '://' not in url or url.endswith('.whl'):
                    continue
                found.append(f'{env_name} / {platform}: {url.rsplit("/", 1)[-1]}')
    return found


@pytest.mark.skipif(not LOCK.exists(), reason='pixi.lock not present in this checkout')
def test_lock_has_no_source_distributions():
    assert _source_builds() == [], (
        'pixi.lock would build these from source at install time; take a '
        'conda package for that platform instead (see the gseapy entry in '
        'pixi.toml)'
    )
