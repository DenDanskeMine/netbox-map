# Installation

## Requirements

- NetBox 4.5.0 or later
- Python 3.12 or later

## Install from PyPI

```bash
source /opt/netbox/venv/bin/activate
pip install netbox-map
```

## Install from Source

```bash
source /opt/netbox/venv/bin/activate
pip install git+https://github.com/DenDanskeMine/netbox-map.git
```

## Configure NetBox

Add the plugin to your `configuration.py`:

```python
PLUGINS = [
    'netbox_map',
]
```

## Apply Migrations

```bash
cd /opt/netbox/netbox
python3 manage.py migrate
python3 manage.py collectstatic --no-input
```

## Restart NetBox

```bash
sudo systemctl restart netbox netbox-rq
```

## Verify Installation

Navigate to your NetBox instance. You should see:

- **Map** in the navigation menu with sub-items for Floor Plans, Site Map, Topology, and Applications
- **Applications** menu group with Applications, Groups, Deployments, Dependencies, and Templates

## Upgrading

```bash
source /opt/netbox/venv/bin/activate
pip install --upgrade netbox-map
cd /opt/netbox/netbox
python3 manage.py migrate
python3 manage.py collectstatic --no-input
sudo systemctl restart netbox netbox-rq
```

## Uninstalling

1. Remove `'netbox_map'` from `PLUGINS` in `configuration.py`
2. Run `pip uninstall netbox-map`
3. Restart NetBox

!!! warning
    Uninstalling does not remove the plugin's database tables. To fully remove data, drop the `netbox_map_*` tables manually after uninstalling.
