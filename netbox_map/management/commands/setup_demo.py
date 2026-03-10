"""
Create a realistic fiber network demo with splice closures, house drops,
tray labels, fiber labels, and splices.

Usage:
    python manage.py setup_demo
"""
from django.core.management.base import BaseCommand
from django.contrib.contenttypes.models import ContentType
from dcim.models import (
    Cable, Device, DeviceRole, DeviceType, Manufacturer,
    RearPort, Site,
)

from netbox_map.models import (
    CablePath, CablePathAssignment, FiberSplice,
    MapMarker, TrayLabel, FiberLabel,
)

# TIA-598 fiber color names & hex
FIBER_NAMES = [
    'Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White',
    'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua',
]
FIBER_HEX = [
    '#2196F3', '#FF9800', '#4CAF50', '#795548', '#9E9E9E', '#F5F5F5',
    '#F44336', '#212121', '#FFEB3B', '#9C27B0', '#E91E63', '#00BCD4',
]
TUBE_HEX = [
    '#2196F3', '#FF9800', '#4CAF50', '#F5F5F5', '#9C27B0', '#FF5722',
    '#FFEB3B', '#795548', '#9E9E9E', '#E91E63', '#00BCD4', '#8BC34A',
]


class Command(BaseCommand):
    help = 'Create a realistic fiber network demo with splices and house drops'

    def handle(self, *args, **options):
        site = Site.objects.first()
        if not site:
            self.stderr.write('No sites found. Create a site first.')
            return

        self.stdout.write(f'Using site: {site.name}')

        # Get or create device type and role
        role = self._get_role()
        dt_96 = self._get_device_type('Splice Closure 96-Fiber', 8, 12)
        dt_24 = self._get_device_type('Splice Closure 24-Fiber', 2, 12)

        # Enrich existing cable paths
        self._enrich_cable_paths()

        # Set up existing splice closures
        self._setup_existing_closures()

        # Create house drop splice closures along the fiber route
        self._create_house_drops(site, role, dt_24)

        self.stdout.write(self.style.SUCCESS('\nDemo setup complete! Restart NetBox to see changes.'))

    def _get_role(self):
        role, _ = DeviceRole.objects.get_or_create(
            slug='passive-fiber',
            defaults={'name': 'Passive Fiber', 'color': '4caf50'},
        )
        return role

    def _get_device_type(self, model_name, tray_count, fibers_per_tray):
        mfr, _ = Manufacturer.objects.get_or_create(
            slug='netbox-map-auto',
            defaults={'name': 'NetBox Map (Auto)'},
        )
        dt, created = DeviceType.objects.get_or_create(
            manufacturer=mfr,
            model=model_name,
        )
        if created:
            from dcim.models import RearPortTemplate
            for i in range(1, tray_count + 1):
                RearPortTemplate.objects.create(
                    device_type=dt,
                    name=f'Tray {i}',
                    type='splice',
                    positions=fibers_per_tray,
                )
            self.stdout.write(f'  Created device type: {model_name}')
        return dt

    def _enrich_cable_paths(self):
        """Add labels, types, and varied fiber counts to cable paths."""
        types = ['smf-os2', 'smf-os1', 'mmf-om4', 'smf-os2']
        counts = [96, 48, 24, 12]
        statuses = ['active', 'active', 'planned', 'active']
        colors = ['', '#FF6B35', '', '#1E88E5']

        updated = 0
        for i, cp in enumerate(CablePath.objects.all()):
            changed = False
            if not cp.cable_type:
                cp.cable_type = types[i % len(types)]
                changed = True
            if not cp.label or cp.label.startswith('Fiber Route'):
                start = cp.start_marker.label if cp.start_marker else ''
                end = cp.end_marker.label if cp.end_marker else ''
                if start and end:
                    cp.label = f'{start} \u2192 {end}'
                elif start:
                    cp.label = f'{start} \u2192 ...'
                else:
                    route_names = [
                        'Main Trunk A', 'Main Trunk B', 'Distribution Ring',
                        'Feed to Industrial Park', 'Highway Crossing',
                        'North Spur', 'South Branch', 'Drop Feeder 1',
                        'Drop Feeder 2', 'Backbone Link', 'Ring Return',
                        'Emergency Bypass', 'Redundant Path', 'Express Route',
                    ]
                    cp.label = route_names[i % len(route_names)]
                changed = True
            if cp.fiber_count == 12 and i > 0:
                cp.fiber_count = counts[i % len(counts)]
                changed = True
            if cp.status == 'planned' and i % 3 != 0:
                cp.status = statuses[i % len(statuses)]
                changed = True
            if not cp.color and colors[i % len(colors)]:
                cp.color = colors[i % len(colors)]
                changed = True
            if changed:
                cp.save()
                updated += 1
        self.stdout.write(f'  Enriched {updated} cable paths')

    def _setup_existing_closures(self):
        """Set up realistic splicing on existing splice closure devices."""
        devices = Device.objects.filter(
            pk__in=RearPort.objects.values_list('device', flat=True).distinct()
        )
        for device in devices:
            rps = list(RearPort.objects.filter(device=device).order_by('name'))
            if len(rps) < 2:
                continue

            self.stdout.write(f'  Setting up: {device.name} ({len(rps)} trays)')

            # Label trays
            for i, rp in enumerate(rps):
                tl, created = TrayLabel.objects.get_or_create(
                    rear_port=rp,
                    defaults={
                        'label': f'Tube {i + 1} ({FIBER_NAMES[i % 12]})',
                        'tube_color': TUBE_HEX[i % 12],
                        'description': self._tray_description(i, len(rps)),
                    }
                )
                # Label fibers
                for pos in range(1, min(rp.positions + 1, 13)):
                    FiberLabel.objects.get_or_create(
                        rear_port=rp,
                        position=pos,
                        defaults={
                            'label': f'{FIBER_NAMES[(pos - 1) % 12]}-{pos}',
                            'color': FIBER_HEX[(pos - 1) % 12],
                        }
                    )

            # Create realistic splice patterns
            self._create_splice_pattern(device, rps)

    def _tray_description(self, index, total):
        """Generate realistic tray descriptions."""
        if total >= 8:
            descriptions = [
                'Trunk cable from Central Office',
                'Trunk cable from Central Office (cont.)',
                'Distribution cable to Sector A',
                'Distribution cable to Sector B',
                'Drop feeder - Houses 1-12',
                'Drop feeder - Houses 13-24',
                'Spare / dark fiber',
                'Emergency bypass',
            ]
        else:
            descriptions = [
                'Incoming trunk fiber',
                'Outgoing to next closure',
            ]
        return descriptions[index % len(descriptions)]

    def _create_splice_pattern(self, device, rear_ports):
        """Create realistic splice patterns for a splice closure.

        Real-world pattern for 96-fiber (8 tray) closure:
        - Tray 1: Upstream trunk cable (fibers 1-12)
        - Tray 2: Upstream trunk cable continued
        - Tray 3: Downstream trunk (pass-through from Tray 1)
        - Tray 4: Downstream trunk (pass-through from Tray 2)
        - Tray 5: House drop feeder A
        - Tray 6: House drop feeder B
        - Tray 7-8: Spare / dark

        Splice pattern:
        - Tray 1 fibers 1-6 → Tray 3 fibers 1-6 (pass-through)
        - Tray 1 fibers 7-12 → Tray 5 fibers 1-6 (drop to houses)
        - Tray 2 fibers 1-6 → Tray 4 fibers 1-6 (pass-through)
        - Tray 2 fibers 7-12 → Tray 6 fibers 1-6 (drop to houses)

        Important: each fiber can only be spliced to ONE other fiber!
        """
        existing = FiberSplice.objects.filter(device=device).count()
        if existing > 0:
            self.stdout.write(f'    Already has {existing} splices, skipping')
            return

        if len(rear_ports) >= 6:
            # 96-fiber closure pattern
            # Tray 1[1-6] -> Tray 3[1-6] (pass-through)
            self._splice_range(device, rear_ports[0], rear_ports[2], 1, 6, 1,
                               'trunk pass-through')
            # Tray 1[7-12] -> Tray 5[1-6] (house drops)
            self._splice_range(device, rear_ports[0], rear_ports[4], 7, 12, 1,
                               'house drop off')
            # Tray 2[1-6] -> Tray 4[1-6] (pass-through)
            self._splice_range(device, rear_ports[1], rear_ports[3], 1, 6, 1,
                               'trunk pass-through (tube 2)')
            # Tray 2[7-12] -> Tray 6[1-6] (house drops)
            self._splice_range(device, rear_ports[1], rear_ports[5], 7, 12, 1,
                               'house drop off (tube 2)')

        elif len(rear_ports) >= 4:
            # Medium closure
            self._splice_range(device, rear_ports[0], rear_ports[2], 1, 6, 1,
                               'pass-through')
            self._splice_range(device, rear_ports[1], rear_ports[3], 1, 6, 1,
                               'pass-through')

        elif len(rear_ports) >= 2:
            # Small closure: simple 1:1 splice
            max_f = min(rear_ports[0].positions, rear_ports[1].positions, 6)
            self._splice_range(device, rear_ports[0], rear_ports[1], 1, max_f, 1,
                               'simple pass-through')

    def _splice_range(self, device, rp_a, rp_b, start_pos_a, end_pos_a, start_pos_b, desc):
        """Create splices mapping rp_a[start_a..end_a] to rp_b[start_b..start_b+N]."""
        created = 0
        pos_b = start_pos_b
        for pos_a in range(start_pos_a, end_pos_a + 1):
            if pos_a > rp_a.positions or pos_b > rp_b.positions:
                break
            _, was_created = FiberSplice.objects.get_or_create(
                device=device,
                port_a=rp_a,
                position_a=pos_a,
                port_b=rp_b,
                position_b=pos_b,
            )
            if was_created:
                created += 1
            pos_b += 1
        if created:
            self.stdout.write(f'    Spliced {created}F: {rp_a.name}[{start_pos_a}-{end_pos_a}] <-> {rp_b.name}[{start_pos_b}-{pos_b-1}] ({desc})')

    def _create_house_drops(self, site, role, dt_24):
        """Create small splice closures for house/building drops along the route."""
        device_ct = ContentType.objects.get_for_model(Device)

        # House drop locations - small closures near the existing fiber routes
        # Positioned along the route between the existing splice closures
        drops = [
            {
                'name': 'Drop SC-101 (Elm Street)',
                'lat': 56.11380, 'lng': 8.30850,
                'desc': 'Residential drop - 4 homes',
            },
            {
                'name': 'Drop SC-102 (Oak Avenue)',
                'lat': 56.11250, 'lng': 8.31200,
                'desc': 'Residential drop - 3 homes + 1 business',
            },
            {
                'name': 'Drop SC-103 (Industrial Park)',
                'lat': 56.11550, 'lng': 8.30400,
                'desc': 'Business drop - data center feed',
            },
        ]

        for drop_info in drops:
            # Check if device already exists
            device, dev_created = Device.objects.get_or_create(
                name=drop_info['name'],
                defaults={
                    'device_type': dt_24,
                    'role': role,
                    'site': site,
                    'status': 'active',
                },
            )

            if dev_created:
                self.stdout.write(f'  Created drop device: {device.name}')

            # Ensure rear ports exist
            for template in dt_24.rearporttemplates.all():
                RearPort.objects.get_or_create(
                    device=device,
                    name=template.name,
                    defaults={
                        'type': template.type,
                        'positions': template.positions,
                    },
                )

            # Create map marker for the drop
            marker, marker_created = MapMarker.objects.get_or_create(
                assigned_object_type=device_ct,
                assigned_object_id=device.pk,
                defaults={
                    'latitude': drop_info['lat'],
                    'longitude': drop_info['lng'],
                    'label': drop_info['name'],
                    'marker_type': 'splice_closure',
                    'status': 'active',
                    'description': drop_info['desc'],
                },
            )

            if marker_created:
                self.stdout.write(f'    Created marker at ({drop_info["lat"]}, {drop_info["lng"]})')

            # Set up tray labels and splicing
            rps = list(RearPort.objects.filter(device=device).order_by('name'))
            if len(rps) >= 2:
                # Label trays
                tray_descs = [
                    'Incoming feeder from trunk',
                    'Drop to houses / premises',
                ]
                for i, rp in enumerate(rps):
                    TrayLabel.objects.get_or_create(
                        rear_port=rp,
                        defaults={
                            'label': f'Tube {i + 1} ({FIBER_NAMES[i % 12]})',
                            'tube_color': TUBE_HEX[i % 12],
                            'description': tray_descs[i % len(tray_descs)],
                        }
                    )
                    for pos in range(1, min(rp.positions + 1, 13)):
                        FiberLabel.objects.get_or_create(
                            rear_port=rp,
                            position=pos,
                            defaults={
                                'label': f'{FIBER_NAMES[(pos - 1) % 12]}-{pos}',
                                'color': FIBER_HEX[(pos - 1) % 12],
                            }
                        )

                # Splice: incoming fiber -> house drops (1:1 on first few fibers)
                max_f = min(rps[0].positions, rps[1].positions, 4)
                self._splice_range(device, rps[0], rps[1], 1, max_f, 1,
                                   'feeder to premises')

            # Create cable paths from nearest existing closure to this drop
            self._create_drop_cable_path(marker, drop_info)

    def _create_drop_cable_path(self, drop_marker, drop_info):
        """Create a cable path from the nearest splice closure to this drop."""
        # Find nearest existing splice_closure marker
        nearest = None
        nearest_dist = float('inf')
        for m in MapMarker.objects.filter(marker_type='splice_closure').exclude(pk=drop_marker.pk):
            dist = abs(float(m.latitude) - drop_info['lat']) + abs(float(m.longitude) - drop_info['lng'])
            if dist < nearest_dist:
                nearest_dist = dist
                nearest = m

        if not nearest:
            return

        # Check if path already exists
        exists = CablePath.objects.filter(
            start_marker=nearest, end_marker=drop_marker
        ).exists() or CablePath.objects.filter(
            start_marker=drop_marker, end_marker=nearest
        ).exists()
        if exists:
            return

        # Create a simple 3-point cable path with slight curve
        mid_lat = (float(nearest.latitude) + drop_info['lat']) / 2
        mid_lng = (float(nearest.longitude) + drop_info['lng']) / 2
        # Add slight curve
        mid_lng += 0.001

        path = CablePath.objects.create(
            label=f'Drop: {drop_info["name"]}',
            path_coordinates=[
                [float(nearest.latitude), float(nearest.longitude)],
                [float(mid_lat), float(mid_lng)],
                [drop_info['lat'], drop_info['lng']],
            ],
            fiber_count=12,
            cable_type='smf-os2',
            status='active',
            color='#66BB6A',
            weight=2,
            start_marker=nearest,
            end_marker=drop_marker,
        )
        self.stdout.write(f'    Created drop cable path: {path.label}')
