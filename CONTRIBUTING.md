# Contributing to NetBox Map

Thank you for your interest in contributing! This document covers the essentials. For the full guide, see the [Contributing documentation](https://dendanskemine.github.io/netbox-map/development/contributing/).

## Quick Start

```bash
git clone https://github.com/DenDanskeMine/netbox-map.git
cd netbox-map
pip install -e .[dev,test]
```

## Running Tests

```bash
cd /path/to/netbox/netbox
NETBOX_CONFIGURATION=netbox.configuration_testing python manage.py test netbox_map.tests -v2
```

## Linting

```bash
ruff check netbox_map/
ruff check --fix netbox_map/
```

## Pull Requests

1. Reference a [GitHub issue](https://github.com/DenDanskeMine/netbox-map/issues)
2. Branch from `main`
3. Include tests for new functionality
4. Ensure linting and tests pass
5. Submit PR

## Bug Reports

Use [GitHub Issues](https://github.com/DenDanskeMine/netbox-map/issues) with the bug report template. Include your NetBox version, Python version, and plugin version.
