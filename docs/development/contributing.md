# Contributing

## Development Setup

1. Clone the repositories:

    ```bash
    git clone https://github.com/netbox-community/netbox.git
    git clone https://github.com/DenDanskeMine/netbox-map.git
    ```

2. Set up NetBox per its [documentation](https://docs.netbox.dev/en/stable/installation/)

3. Install the plugin in editable mode:

    ```bash
    source /path/to/netbox/venv/bin/activate
    pip install -e ./netbox-map[dev,test]
    ```

4. Add `'netbox_map'` to `PLUGINS` in your `configuration.py`

5. Run migrations:

    ```bash
    cd netbox/netbox
    python manage.py migrate
    ```

## Running Tests

```bash
cd netbox/netbox
NETBOX_CONFIGURATION=netbox.configuration_testing python manage.py test netbox_map.tests -v2
```

With coverage:

```bash
NETBOX_CONFIGURATION=netbox.configuration_testing python -m coverage run --source=netbox_map manage.py test netbox_map.tests
coverage report
```

## Linting

The project uses [ruff](https://docs.astral.sh/ruff/) with configuration aligned to NetBox's own style:

```bash
cd netbox-map
ruff check netbox_map/        # Check for issues
ruff check --fix netbox_map/  # Auto-fix
ruff format netbox_map/       # Format code
```

Or via make:

```bash
make lint
make lint-fix
make format
```

## Pull Request Process

1. Open or reference a [GitHub issue](https://github.com/DenDanskeMine/netbox-map/issues) describing the change
2. Create a feature branch from `main`
3. Make your changes with tests
4. Ensure `ruff check` passes
5. Ensure all tests pass
6. Submit a pull request referencing the issue

## Code Style

- Follow existing patterns in the codebase
- Use NetBox conventions for models, views, serializers, and forms
- Line length: 120 characters
- Single quotes for strings
- Import sorting handled by ruff (isort rules)

## Building Documentation

```bash
pip install mkdocs-material
mkdocs serve
```

Then open `http://127.0.0.1:8000` to preview.
