"""
Generate massive realistic demo data for the netbox-map Application Mapping plugin.

Usage:
    cd /home/crosk/netbox-dev/netbox/netbox
    python manage.py shell < /home/crosk/netbox-dev/netbox-map/generate_demo_data.py
"""
import os
import sys
import random
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'netbox.settings')
django.setup()

from django.contrib.contenttypes.models import ContentType
from django.utils.text import slugify
from dcim.models import Site, Device, DeviceType, DeviceRole, Manufacturer
from netbox_map.models import (
    ApplicationGroup, Application, ApplicationDeployment, ApplicationDependency,
)
from netbox_map.choices import (
    ApplicationStatusChoices,
    ApplicationCriticalityChoices,
    ApplicationEnvironmentChoices,
    DeploymentRoleChoices,
    DependencyTypeChoices,
    DependencyProtocolChoices,
)

random.seed(42)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def pick(choices, weights=None):
    """Pick a random value from a list (optionally weighted)."""
    if weights:
        return random.choices(choices, weights=weights, k=1)[0]
    return random.choice(choices)

STATUSES = [
    ApplicationStatusChoices.STATUS_ACTIVE,
    ApplicationStatusChoices.STATUS_PLANNED,
    ApplicationStatusChoices.STATUS_DEPRECATED,
]
STATUS_WEIGHTS = [80, 12, 8]  # mostly active

CRITICALITIES = [
    ApplicationCriticalityChoices.CRITICALITY_LOW,
    ApplicationCriticalityChoices.CRITICALITY_MEDIUM,
    ApplicationCriticalityChoices.CRITICALITY_HIGH,
    ApplicationCriticalityChoices.CRITICALITY_CRITICAL,
]

ENVIRONMENTS = [
    ApplicationEnvironmentChoices.ENV_PRODUCTION,
    ApplicationEnvironmentChoices.ENV_STAGING,
    ApplicationEnvironmentChoices.ENV_DEVELOPMENT,
    ApplicationEnvironmentChoices.ENV_TESTING,
]
ENV_WEIGHTS = [55, 20, 15, 10]

DEPLOYMENT_ROLES = [
    DeploymentRoleChoices.ROLE_PRIMARY,
    DeploymentRoleChoices.ROLE_REPLICA,
    DeploymentRoleChoices.ROLE_WORKER,
    DeploymentRoleChoices.ROLE_STANDBY,
]

# ---------------------------------------------------------------------------
# 1. Site
# ---------------------------------------------------------------------------
print("=== Creating site ===")
site, _ = Site.objects.get_or_create(name="App Test", defaults={"slug": "app-test", "status": "active"})
print(f"  Site: {site}")

# ---------------------------------------------------------------------------
# 2. Manufacturers & DeviceTypes
# ---------------------------------------------------------------------------
print("\n=== Creating manufacturers & device types ===")

MANUFACTURER_TYPES = {
    "Cisco": ["Catalyst 9300", "Nexus 9000", "ASR 1001-X", "ISR 4431", "Firepower 4110"],
    "Arista": ["DCS-7050SX3", "DCS-7280SR", "DCS-7060CX"],
    "Juniper": ["EX4300", "QFX5100", "SRX4600", "MX204"],
    "Palo Alto": ["PA-5260", "PA-3260", "PA-850"],
    "Dell": ["PowerEdge R750", "PowerEdge R650", "PowerSwitch S5248F"],
    "HPE": ["ProLiant DL380 Gen10", "ProLiant DL360 Gen10", "Nimble HF20"],
    "Supermicro": ["SYS-620U-TNR", "SYS-110P-WTR"],
    "NetApp": ["AFF A400", "FAS8700"],
    "Fortinet": ["FortiGate 600E", "FortiGate 200F"],
}

manufacturers = {}
device_types = {}
for mfr_name, types in MANUFACTURER_TYPES.items():
    mfr, _ = Manufacturer.objects.get_or_create(name=mfr_name, defaults={"slug": slugify(mfr_name)})
    manufacturers[mfr_name] = mfr
    for dt_name in types:
        dt, _ = DeviceType.objects.get_or_create(
            manufacturer=mfr, model=dt_name,
            defaults={"slug": slugify(dt_name)},
        )
        device_types[dt_name] = dt
print(f"  Manufacturers: {len(manufacturers)}, Device types: {len(device_types)}")

# ---------------------------------------------------------------------------
# 3. Device Roles
# ---------------------------------------------------------------------------
print("\n=== Creating device roles ===")

ROLE_DEFS = {
    "Router":   {"color": "aa1409", "vm_role": False},
    "Switch":   {"color": "2196f3", "vm_role": False},
    "Firewall": {"color": "ff9800", "vm_role": False},
    "Server":   {"color": "4caf50", "vm_role": False},
    "Storage":  {"color": "9c27b0", "vm_role": False},
}
roles = {}
for role_name, props in ROLE_DEFS.items():
    r, _ = DeviceRole.objects.get_or_create(
        name=role_name,
        defaults={"slug": slugify(role_name), "color": props["color"], "vm_role": props["vm_role"]},
    )
    roles[role_name] = r
print(f"  Roles: {list(roles.keys())}")

# ---------------------------------------------------------------------------
# 4. Devices (~300)
# ---------------------------------------------------------------------------
print("\n=== Creating devices ===")

# Map role -> (count, manufacturer choices, device type choices)
DEVICE_SPECS = {
    "Router": {
        "count": 20,
        "prefix": "rtr",
        "types": ["ASR 1001-X", "ISR 4431", "MX204"],
    },
    "Switch": {
        "count": 60,
        "prefix": "sw",
        "types": ["Catalyst 9300", "Nexus 9000", "DCS-7050SX3", "DCS-7280SR", "EX4300", "QFX5100", "PowerSwitch S5248F"],
    },
    "Firewall": {
        "count": 20,
        "prefix": "fw",
        "types": ["Firepower 4110", "PA-5260", "PA-3260", "PA-850", "SRX4600", "FortiGate 600E", "FortiGate 200F"],
    },
    "Server": {
        "count": 180,
        "prefix": "srv",
        "types": ["PowerEdge R750", "PowerEdge R650", "ProLiant DL380 Gen10", "ProLiant DL360 Gen10", "SYS-620U-TNR", "SYS-110P-WTR"],
    },
    "Storage": {
        "count": 20,
        "prefix": "sto",
        "types": ["AFF A400", "FAS8700", "Nimble HF20"],
    },
}

devices_by_role = {role_name: [] for role_name in ROLE_DEFS}
existing_device_names = set(Device.objects.filter(site=site).values_list("name", flat=True))
devices_to_create = []

for role_name, spec in DEVICE_SPECS.items():
    for i in range(1, spec["count"] + 1):
        name = f"{spec['prefix']}-{i:03d}"
        if name in existing_device_names:
            continue
        dt = device_types[pick(spec["types"])]
        devices_to_create.append(Device(
            name=name,
            site=site,
            device_type=dt,
            role=roles[role_name],
            status="active",
        ))

if devices_to_create:
    Device.objects.bulk_create(devices_to_create, batch_size=200)

# Reload all devices for this site keyed by role
for role_name in ROLE_DEFS:
    devices_by_role[role_name] = list(
        Device.objects.filter(site=site, role=roles[role_name]).order_by("name")
    )

total_devices = sum(len(v) for v in devices_by_role.values())
print(f"  Total devices: {total_devices}")
for rn, devs in devices_by_role.items():
    print(f"    {rn}: {len(devs)}")

# Convenience: all servers, all devices
all_servers = devices_by_role["Server"]
all_devices = []
for devs in devices_by_role.values():
    all_devices.extend(devs)

device_ct = ContentType.objects.get_for_model(Device)

# ---------------------------------------------------------------------------
# 5. Application Groups (~30)
# ---------------------------------------------------------------------------
print("\n=== Creating application groups ===")

GROUP_DEFS = [
    ("Web Services",        "#3498db"),
    ("API Gateway",         "#2980b9"),
    ("Backend Services",    "#27ae60"),
    ("Data Stores",         "#8e44ad"),
    ("Caching",             "#e74c3c"),
    ("Messaging",           "#f39c12"),
    ("Search & Analytics",  "#1abc9c"),
    ("Monitoring",          "#e67e22"),
    ("Logging",             "#d35400"),
    ("Alerting",            "#c0392b"),
    ("Security",            "#2c3e50"),
    ("Secret Management",   "#7f8c8d"),
    ("CI/CD",               "#16a085"),
    ("Container Platform",  "#2ecc71"),
    ("Service Mesh",        "#9b59b6"),
    ("DNS & Discovery",     "#34495e"),
    ("Load Balancing",      "#e84393"),
    ("Mail Services",       "#6c5ce7"),
    ("Identity & Auth",     "#00b894"),
    ("File Storage",        "#fdcb6e"),
    ("Backup & Recovery",   "#636e72"),
    ("CDN & Edge",          "#0984e3"),
    ("Machine Learning",    "#a29bfe"),
    ("Data Pipeline",       "#55efc4"),
    ("Batch Processing",    "#fab1a0"),
    ("CRM & ERP",           "#74b9ff"),
    ("Communication",       "#ff7675"),
    ("Observability",       "#fd79a8"),
    ("Configuration Mgmt",  "#dfe6e9"),
    ("Database Admin",      "#b2bec3"),
]

groups = {}
for gname, gcolor in GROUP_DEFS:
    g, _ = ApplicationGroup.objects.get_or_create(
        name=gname,
        defaults={"slug": slugify(gname), "color": gcolor, "description": f"{gname} application group"},
    )
    groups[gname] = g

print(f"  Application groups: {len(groups)}")

# ---------------------------------------------------------------------------
# 6. Applications (~200+)
# ---------------------------------------------------------------------------
print("\n=== Creating applications ===")

# Each tuple: (app_name, group, criticality, version, description, deploy_to, deploy_count_range, port, protocol)
# deploy_to: "servers" | "web" | "db" | "all" | "monitoring" | "network" | "firewall" | "storage" | specific role
# We will use this blueprint to create Application objects.

APP_BLUEPRINTS = [
    # ── Web Services ──
    ("nginx",               "Web Services",       "critical", "1.25.3",  "Reverse proxy and web server",        "servers", (8, 16), 80, "HTTP"),
    ("nginx-ingress",       "Web Services",       "critical", "1.9.4",   "Kubernetes ingress controller",       "servers", (4, 8),  443, "HTTPS"),
    ("apache-httpd",        "Web Services",       "high",     "2.4.58",  "Apache HTTP server",                  "servers", (3, 6),  80, "HTTP"),
    ("caddy",               "Web Services",       "medium",   "2.7.6",   "Modern web server with auto-TLS",     "servers", (2, 4),  443, "HTTPS"),
    ("tomcat",              "Web Services",       "high",     "10.1.17", "Java servlet container",              "servers", (4, 8),  8080, "HTTP"),
    ("gunicorn",            "Web Services",       "high",     "21.2.0",  "Python WSGI HTTP server",             "servers", (5, 10), 8000, "HTTP"),
    ("uvicorn",             "Web Services",       "high",     "0.25.0",  "Python ASGI server",                  "servers", (3, 6),  8000, "HTTP"),

    # ── API Gateway ──
    ("kong",                "API Gateway",        "critical", "3.5.0",   "API gateway and service mesh",        "servers", (3, 6),  8000, "HTTP"),
    ("traefik",             "API Gateway",        "high",     "2.10.7",  "Cloud-native reverse proxy",          "servers", (3, 6),  8080, "HTTP"),
    ("envoy-proxy",         "API Gateway",        "critical", "1.28.0",  "High-performance edge proxy",         "servers", (4, 8),  10000, "HTTP"),

    # ── Backend Services ──
    ("user-service",        "Backend Services",   "critical", "3.2.1",   "User management microservice",        "servers", (4, 8),  8080, "HTTP"),
    ("order-service",       "Backend Services",   "critical", "2.8.0",   "Order processing service",            "servers", (4, 8),  8081, "HTTP"),
    ("payment-service",     "Backend Services",   "critical", "1.14.2",  "Payment processing gateway",          "servers", (3, 6),  8082, "HTTP"),
    ("inventory-service",   "Backend Services",   "high",     "2.1.0",   "Inventory tracking service",          "servers", (3, 6),  8083, "HTTP"),
    ("notification-service","Backend Services",   "high",     "1.7.3",   "Push/email notification service",     "servers", (3, 6),  8084, "HTTP"),
    ("auth-service",        "Backend Services",   "critical", "4.0.1",   "Authentication & authorization",      "servers", (4, 8),  8085, "HTTP"),
    ("catalog-service",     "Backend Services",   "high",     "2.3.5",   "Product catalog service",             "servers", (3, 6),  8086, "HTTP"),
    ("shipping-service",    "Backend Services",   "high",     "1.5.0",   "Shipping & logistics service",        "servers", (2, 5),  8087, "HTTP"),
    ("pricing-service",     "Backend Services",   "high",     "1.9.2",   "Dynamic pricing engine",              "servers", (2, 5),  8088, "HTTP"),
    ("search-service",      "Backend Services",   "high",     "2.0.4",   "Product search service",              "servers", (3, 6),  8089, "HTTP"),
    ("recommendation-svc",  "Backend Services",   "medium",   "1.2.0",   "ML recommendation engine",            "servers", (2, 4),  8090, "gRPC"),
    ("media-service",       "Backend Services",   "medium",   "1.4.1",   "Image/video processing service",      "servers", (2, 4),  8091, "HTTP"),
    ("analytics-service",   "Backend Services",   "medium",   "1.6.0",   "Business analytics service",          "servers", (2, 4),  8092, "HTTP"),
    ("email-service",       "Backend Services",   "high",     "2.1.3",   "Transactional email service",         "servers", (2, 4),  8093, "HTTP"),
    ("report-service",      "Backend Services",   "medium",   "1.3.2",   "Report generation service",           "servers", (2, 4),  8094, "HTTP"),

    # ── Data Stores ──
    ("postgresql",          "Data Stores",        "critical", "16.1",    "Primary relational database",         "servers", (5, 10), 5432, "TCP"),
    ("mysql",               "Data Stores",        "critical", "8.2.0",   "MySQL relational database",           "servers", (3, 6),  3306, "TCP"),
    ("mongodb",             "Data Stores",        "high",     "7.0.4",   "Document database",                   "servers", (3, 6),  27017, "TCP"),
    ("cockroachdb",         "Data Stores",        "high",     "23.2.0",  "Distributed SQL database",            "servers", (3, 6),  26257, "TCP"),
    ("mariadb",             "Data Stores",        "high",     "11.2.2",  "MariaDB server",                      "servers", (2, 4),  3306, "TCP"),
    ("timescaledb",         "Data Stores",        "high",     "2.13.0",  "Time-series database",                "servers", (2, 4),  5432, "TCP"),
    ("clickhouse",          "Data Stores",        "high",     "23.10",   "Column-oriented OLAP database",       "servers", (2, 4),  8123, "TCP"),

    # ── Caching ──
    ("redis",               "Caching",            "critical", "7.2.3",   "In-memory key-value store",           "servers", (6, 12), 6379, "TCP"),
    ("memcached",           "Caching",            "high",     "1.6.22",  "Distributed memory cache",            "servers", (4, 8),  11211, "TCP"),
    ("hazelcast",           "Caching",            "medium",   "5.3.6",   "Distributed in-memory grid",          "servers", (2, 4),  5701, "TCP"),
    ("varnish",             "Caching",            "high",     "7.4.2",   "HTTP accelerator / reverse proxy cache", "servers", (3, 6), 6081, "HTTP"),

    # ── Messaging ──
    ("kafka",               "Messaging",          "critical", "3.6.1",   "Distributed event streaming",         "servers", (5, 10), 9092, "TCP"),
    ("rabbitmq",            "Messaging",          "critical", "3.12.10", "Message broker",                      "servers", (3, 6),  5672, "AMQP"),
    ("nats",                "Messaging",          "high",     "2.10.5",  "Cloud-native messaging system",       "servers", (3, 6),  4222, "TCP"),
    ("activemq",            "Messaging",          "medium",   "5.18.3",  "Java message broker",                 "servers", (2, 4),  61616, "TCP"),
    ("pulsar",              "Messaging",          "high",     "3.1.1",   "Multi-tenant messaging platform",     "servers", (2, 4),  6650, "TCP"),

    # ── Search & Analytics ──
    ("elasticsearch",       "Search & Analytics", "critical", "8.11.3",  "Distributed search engine",           "servers", (5, 10), 9200, "HTTP"),
    ("opensearch",          "Search & Analytics", "high",     "2.11.1",  "Open-source search suite",            "servers", (3, 6),  9200, "HTTP"),
    ("kibana",              "Search & Analytics", "high",     "8.11.3",  "Elasticsearch visualization",         "servers", (2, 4),  5601, "HTTP"),
    ("solr",                "Search & Analytics", "medium",   "9.4.0",   "Enterprise search platform",          "servers", (2, 4),  8983, "HTTP"),

    # ── Monitoring ──
    ("prometheus",          "Monitoring",         "critical", "2.48.1",  "Metrics collection & alerting",       "servers", (3, 6),  9090, "HTTP"),
    ("grafana",             "Monitoring",         "critical", "10.2.3",  "Observability dashboards",            "servers", (2, 4),  3000, "HTTP"),
    ("node-exporter",       "Monitoring",         "high",     "1.7.0",   "Hardware/OS metrics exporter",        "all",     (1, 1),  9100, "HTTP"),
    ("blackbox-exporter",   "Monitoring",         "high",     "0.24.0",  "Probing endpoints exporter",          "servers", (2, 3),  9115, "HTTP"),
    ("thanos",              "Monitoring",         "high",     "0.33.0",  "HA Prometheus with long-term storage", "servers", (2, 4), 10902, "gRPC"),
    ("victoria-metrics",    "Monitoring",         "high",     "1.96.0",  "Time-series database for monitoring", "servers", (2, 4),  8428, "HTTP"),
    ("datadog-agent",       "Monitoring",         "high",     "7.50.0",  "Datadog monitoring agent",            "all",     (1, 1),  8125, "UDP"),
    ("zabbix-agent",        "Monitoring",         "medium",   "6.4.10",  "Zabbix monitoring agent",             "all",     (1, 1),  10050, "TCP"),

    # ── Logging ──
    ("fluentd",             "Logging",            "high",     "1.16.3",  "Log collector & forwarder",           "all",     (1, 1),  24224, "TCP"),
    ("logstash",            "Logging",            "high",     "8.11.3",  "Log processing pipeline",             "servers", (2, 4),  5044, "TCP"),
    ("loki",                "Logging",            "high",     "2.9.3",   "Log aggregation system",              "servers", (2, 4),  3100, "HTTP"),
    ("vector",              "Logging",            "medium",   "0.34.1",  "High-perf observability data pipeline","servers",(2, 4),  8686, "HTTP"),
    ("filebeat",            "Logging",            "medium",   "8.11.3",  "Lightweight log shipper",             "all",     (1, 1),  5066, "TCP"),

    # ── Alerting ──
    ("alertmanager",        "Alerting",           "critical", "0.26.0",  "Alert routing & deduplication",       "servers", (2, 3),  9093, "HTTP"),
    ("pagerduty-agent",     "Alerting",           "high",     "3.8.0",   "PagerDuty integration agent",         "servers", (1, 2),  8081, "HTTP"),
    ("opsgenie-agent",      "Alerting",           "medium",   "2.16.0",  "Opsgenie alerting bridge",            "servers", (1, 2),  8082, "HTTP"),

    # ── Security ──
    ("vault",               "Secret Management",  "critical", "1.15.4",  "Secret & encryption management",      "servers", (3, 6),  8200, "HTTP"),
    ("consul",              "DNS & Discovery",    "critical", "1.17.1",  "Service discovery & config",          "servers", (3, 6),  8500, "HTTP"),
    ("cert-manager",        "Security",           "high",     "1.13.3",  "X.509 certificate management",        "servers", (2, 3),  9402, "HTTP"),
    ("falco",               "Security",           "high",     "0.37.0",  "Runtime security monitoring",         "servers", (3, 6),  8765, "gRPC"),
    ("trivy",               "Security",           "medium",   "0.48.0",  "Vulnerability scanner",               "servers", (1, 3),  8080, "HTTP"),
    ("crowdsec",            "Security",           "high",     "1.5.4",   "Collaborative IPS",                   "servers", (2, 4),  8080, "HTTP"),
    ("wazuh-agent",         "Security",           "high",     "4.7.1",   "SIEM/XDR agent",                      "all",     (1, 1),  1514, "TCP"),

    # ── CI/CD ──
    ("jenkins",             "CI/CD",              "high",     "2.434",   "Automation server",                   "servers", (2, 4),  8080, "HTTP"),
    ("gitlab-runner",       "CI/CD",              "high",     "16.7.0",  "GitLab CI runner",                    "servers", (4, 8),  8093, "HTTP"),
    ("argocd",              "CI/CD",              "high",     "2.9.3",   "GitOps continuous delivery",          "servers", (2, 3),  8080, "HTTP"),
    ("tekton",              "CI/CD",              "medium",   "0.54.0",  "Cloud-native CI/CD pipelines",        "servers", (2, 3),  9090, "HTTP"),
    ("nexus",               "CI/CD",              "high",     "3.64.0",  "Artifact repository",                 "servers", (2, 3),  8081, "HTTP"),
    ("harbor",              "CI/CD",              "high",     "2.10.0",  "Container image registry",            "servers", (2, 3),  443, "HTTPS"),

    # ── Container Platform ──
    ("containerd",          "Container Platform", "critical", "1.7.11",  "Container runtime",                   "servers", (10, 20), 0, ""),
    ("kubelet",             "Container Platform", "critical", "1.28.4",  "Kubernetes node agent",               "servers", (10, 20), 10250, "HTTPS"),
    ("etcd",                "Container Platform", "critical", "3.5.11",  "Distributed key-value store for k8s", "servers", (3, 5),  2379, "gRPC"),
    ("coredns",             "DNS & Discovery",    "critical", "1.11.1",  "DNS server for service discovery",    "servers", (2, 4),  53, "DNS"),

    # ── Service Mesh ──
    ("istio-proxy",         "Service Mesh",       "high",     "1.20.2",  "Istio sidecar proxy (Envoy)",         "servers", (8, 16), 15001, "HTTP"),
    ("linkerd-proxy",       "Service Mesh",       "medium",   "2.14.7",  "Linkerd sidecar proxy",               "servers", (3, 6),  4143, "HTTP"),

    # ── Load Balancing ──
    ("haproxy",             "Load Balancing",     "critical", "2.9.3",   "TCP/HTTP load balancer",              "servers", (3, 6),  80, "HTTP"),
    ("keepalived",          "Load Balancing",     "high",     "2.2.8",   "VRRP failover daemon",                "servers", (2, 4),  0, "VRRP"),
    ("metallb",             "Load Balancing",     "high",     "0.14.3",  "Bare-metal load balancer for k8s",    "servers", (2, 4),  7472, "HTTP"),

    # ── Identity & Auth ──
    ("keycloak",            "Identity & Auth",    "critical", "23.0.3",  "Identity & access management",        "servers", (2, 4),  8443, "HTTPS"),
    ("openldap",            "Identity & Auth",    "high",     "2.6.6",   "LDAP directory server",               "servers", (2, 3),  389, "LDAP"),
    ("freeipa",             "Identity & Auth",    "high",     "4.11.0",  "Identity management system",          "servers", (2, 3),  443, "HTTPS"),

    # ── File Storage ──
    ("minio",               "File Storage",       "high",     "2023.12", "S3-compatible object storage",        "storage", (3, 6),  9000, "HTTP"),
    ("ceph",                "File Storage",       "critical", "18.2.1",  "Distributed storage system",          "storage", (4, 8),  6789, "TCP"),
    ("nfs-server",          "File Storage",       "high",     "4.2.0",   "NFS file server",                     "storage", (2, 4),  2049, "NFS"),
    ("glusterfs",           "File Storage",       "medium",   "11.0",    "Scale-out network filesystem",        "storage", (2, 4),  24007, "TCP"),

    # ── Backup & Recovery ──
    ("velero",              "Backup & Recovery",  "high",     "1.12.3",  "Kubernetes backup tool",              "servers", (1, 3),  8085, "HTTP"),
    ("restic",              "Backup & Recovery",  "medium",   "0.16.2",  "Backup program",                      "servers", (2, 4),  0, ""),
    ("barman",              "Backup & Recovery",  "high",     "3.9.0",   "PostgreSQL backup manager",           "servers", (1, 2),  5432, "TCP"),

    # ── CDN & Edge ──
    ("cloudflare-tunnel",   "CDN & Edge",         "high",     "2023.10", "Cloudflare Tunnel connector",         "servers", (2, 4),  0, ""),
    ("squid",               "CDN & Edge",         "medium",   "6.6",     "HTTP caching proxy",                  "servers", (2, 4),  3128, "HTTP"),

    # ── Machine Learning ──
    ("jupyter-hub",         "Machine Learning",   "medium",   "4.0.2",   "Multi-user Jupyter notebook server",  "servers", (2, 3),  8000, "HTTP"),
    ("mlflow",              "Machine Learning",   "medium",   "2.9.2",   "ML lifecycle management",             "servers", (1, 2),  5000, "HTTP"),
    ("ray",                 "Machine Learning",   "medium",   "2.9.0",   "Distributed ML framework",            "servers", (2, 4),  8265, "HTTP"),
    ("triton-server",       "Machine Learning",   "high",     "23.12",   "ML inference server",                 "servers", (2, 4),  8001, "gRPC"),

    # ── Data Pipeline ──
    ("airflow",             "Data Pipeline",      "high",     "2.8.0",   "Workflow orchestration platform",     "servers", (2, 4),  8080, "HTTP"),
    ("spark",               "Data Pipeline",      "high",     "3.5.0",   "Distributed data processing",         "servers", (3, 6),  4040, "HTTP"),
    ("flink",               "Data Pipeline",      "high",     "1.18.0",  "Stream processing framework",         "servers", (2, 4),  8081, "HTTP"),
    ("debezium",            "Data Pipeline",      "high",     "2.5.0",   "Change data capture platform",        "servers", (2, 4),  8083, "HTTP"),

    # ── Batch Processing ──
    ("celery-worker",       "Batch Processing",   "high",     "5.3.6",   "Distributed task queue worker",       "servers", (4, 8),  0, ""),
    ("celery-beat",         "Batch Processing",   "high",     "5.3.6",   "Periodic task scheduler",             "servers", (1, 2),  0, ""),
    ("sidekiq",             "Batch Processing",   "high",     "7.2.0",   "Ruby background job processor",       "servers", (2, 4),  0, ""),

    # ── CRM & ERP ──
    ("odoo",                "CRM & ERP",          "high",     "17.0",    "Business application suite",          "servers", (2, 4),  8069, "HTTP"),
    ("suiteCRM",            "CRM & ERP",          "medium",   "8.4.0",   "CRM system",                          "servers", (1, 2),  443, "HTTPS"),

    # ── Communication ──
    ("mattermost",          "Communication",      "high",     "9.3.0",   "Team messaging platform",             "servers", (2, 3),  8065, "HTTP"),
    ("matrix-synapse",      "Communication",      "medium",   "1.98.0",  "Matrix homeserver",                   "servers", (1, 2),  8008, "HTTP"),
    ("postfix",             "Mail Services",      "high",     "3.8.4",   "Mail transfer agent",                 "servers", (2, 3),  25, "SMTP"),
    ("dovecot",             "Mail Services",      "high",     "2.3.21",  "IMAP/POP3 email server",              "servers", (2, 3),  993, "IMAPS"),

    # ── Observability ──
    ("jaeger",              "Observability",       "high",     "1.52.0",  "Distributed tracing",                "servers", (2, 3),  16686, "HTTP"),
    ("opentelemetry-coll",  "Observability",       "high",     "0.91.0",  "Telemetry data collection",          "servers", (3, 6),  4317, "gRPC"),
    ("tempo",               "Observability",       "high",     "2.3.1",   "Distributed tracing backend",        "servers", (2, 3),  3200, "HTTP"),
    ("mimir",               "Observability",       "high",     "2.11.0",  "Long-term Prometheus storage",       "servers", (2, 3),  9009, "HTTP"),

    # ── Configuration Mgmt ──
    ("ansible-tower",       "Configuration Mgmt", "high",     "4.4.1",   "Automation controller",               "servers", (1, 2),  443, "HTTPS"),
    ("salt-master",         "Configuration Mgmt", "high",     "3006.4",  "Configuration management",            "servers", (1, 2),  4505, "TCP"),
    ("puppet-server",       "Configuration Mgmt", "medium",   "8.3.0",   "Infrastructure automation",           "servers", (1, 2),  8140, "HTTPS"),

    # ── Database Admin ──
    ("pgbouncer",           "Database Admin",     "critical", "1.21.0",  "PostgreSQL connection pooler",        "servers", (3, 6),  6432, "TCP"),
    ("proxysql",            "Database Admin",     "high",     "2.5.5",   "MySQL proxy & load balancer",         "servers", (2, 4),  6033, "TCP"),
    ("redis-sentinel",      "Database Admin",     "high",     "7.2.3",   "Redis high availability",             "servers", (3, 5),  26379, "TCP"),
]

# Map criticality strings to choices
CRIT_MAP = {
    "low": ApplicationCriticalityChoices.CRITICALITY_LOW,
    "medium": ApplicationCriticalityChoices.CRITICALITY_MEDIUM,
    "high": ApplicationCriticalityChoices.CRITICALITY_HIGH,
    "critical": ApplicationCriticalityChoices.CRITICALITY_CRITICAL,
}

# Build applications (with environment variants for key apps)
apps_to_create = []
app_meta = []  # parallel list tracking blueprint info for each app

# Track (name, environment, tenant) for uniqueness constraint
existing_apps = set(
    Application.objects.values_list("name", "environment", "tenant_id")
)

# Decide which apps get multi-environment variants
MULTI_ENV_APPS = {
    "postgresql", "redis", "kafka", "nginx", "elasticsearch", "user-service",
    "order-service", "payment-service", "auth-service", "vault", "consul",
    "kong", "keycloak", "grafana", "prometheus", "jenkins", "argocd",
    "haproxy", "kubelet", "etcd",
}

for bp in APP_BLUEPRINTS:
    app_name, group_name, crit_str, version, desc, deploy_target, deploy_range, port, proto = bp

    if app_name in MULTI_ENV_APPS:
        envs_to_create = [
            ApplicationEnvironmentChoices.ENV_PRODUCTION,
            ApplicationEnvironmentChoices.ENV_STAGING,
        ]
    else:
        envs_to_create = [pick(ENVIRONMENTS, ENV_WEIGHTS)]

    for env in envs_to_create:
        key = (app_name, env, None)
        if key in existing_apps:
            continue
        existing_apps.add(key)

        status = pick(STATUSES, STATUS_WEIGHTS)
        apps_to_create.append(Application(
            name=app_name,
            status=status,
            criticality=CRIT_MAP[crit_str],
            environment=env,
            version=version,
            description=desc,
            group=groups[group_name],
            tenant=None,
            site=site,
        ))
        app_meta.append({
            "deploy_target": deploy_target,
            "deploy_range": deploy_range,
            "port": port,
            "protocol": proto,
            "bp_name": app_name,
        })

if apps_to_create:
    Application.objects.bulk_create(apps_to_create, batch_size=200)
    print(f"  Created {len(apps_to_create)} new applications")

# Reload all apps for this site
all_apps = list(Application.objects.filter(site=site).order_by("name", "environment"))
app_by_name_env = {(a.name, a.environment): a for a in all_apps}
print(f"  Total applications in site: {len(all_apps)}")

# Rebuild app_meta index mapping app objects -> meta
# We need to match created apps back to their meta
app_meta_map = {}
for app_obj, meta in zip(apps_to_create, app_meta):
    # Find the actual saved object by name+env
    key = (app_obj.name, app_obj.environment)
    if key in app_by_name_env:
        app_meta_map[app_by_name_env[key].pk] = meta

# For apps that existed before this run, build a default meta
for a in all_apps:
    if a.pk not in app_meta_map:
        app_meta_map[a.pk] = {
            "deploy_target": "servers",
            "deploy_range": (2, 5),
            "port": 8080,
            "protocol": "HTTP",
            "bp_name": a.name,
        }

# ---------------------------------------------------------------------------
# 7. Application Deployments (~4000+)
# ---------------------------------------------------------------------------
print("\n=== Creating application deployments ===")

existing_deployments = set(
    ApplicationDeployment.objects.filter(host_type=device_ct).values_list(
        "application_id", "host_id", flat=False
    )
)

deployments_to_create = []

# Helper to pick N devices from a pool
def pick_devices(pool, count):
    count = min(count, len(pool))
    return random.sample(pool, count)

for app in all_apps:
    meta = app_meta_map.get(app.pk)
    if not meta:
        continue

    target = meta["deploy_target"]
    lo, hi = meta["deploy_range"]
    port = meta["port"] if meta["port"] else None
    proto = meta["protocol"]

    # Determine device pool
    if target == "all":
        pool = all_devices
        # For agents deployed everywhere, deploy to a large chunk
        count = random.randint(max(lo, len(all_devices) // 3), len(all_devices) // 2)
    elif target == "servers":
        pool = all_servers
        count = random.randint(lo, hi)
    elif target == "storage":
        pool = devices_by_role["Storage"]
        count = random.randint(lo, min(hi, len(pool)))
    elif target == "network":
        pool = devices_by_role["Router"] + devices_by_role["Switch"]
        count = random.randint(lo, min(hi, len(pool)))
    elif target == "firewall":
        pool = devices_by_role["Firewall"]
        count = random.randint(lo, min(hi, len(pool)))
    else:
        pool = all_servers
        count = random.randint(lo, hi)

    devices_for_app = pick_devices(pool, count)

    for idx, dev in enumerate(devices_for_app):
        if (app.pk, dev.pk) in existing_deployments:
            continue
        existing_deployments.add((app.pk, dev.pk))

        # First device is primary, rest get mixed roles
        if idx == 0:
            role = DeploymentRoleChoices.ROLE_PRIMARY
        else:
            role = pick([
                DeploymentRoleChoices.ROLE_PRIMARY,
                DeploymentRoleChoices.ROLE_REPLICA,
                DeploymentRoleChoices.ROLE_WORKER,
                DeploymentRoleChoices.ROLE_STANDBY,
            ], weights=[30, 30, 25, 15])

        deployments_to_create.append(ApplicationDeployment(
            application=app,
            host_type=device_ct,
            host_id=dev.pk,
            role=role,
            port=port,
            protocol=proto,
        ))

if deployments_to_create:
    ApplicationDeployment.objects.bulk_create(deployments_to_create, batch_size=500)

total_deployments = ApplicationDeployment.objects.filter(
    application__site=site
).count()
print(f"  Created {len(deployments_to_create)} new deployments")
print(f"  Total deployments in site: {total_deployments}")

# ---------------------------------------------------------------------------
# 8. Application Dependencies (~800+)
# ---------------------------------------------------------------------------
print("\n=== Creating application dependencies ===")

existing_deps = set(
    ApplicationDependency.objects.values_list(
        "source_application_id", "target_application_id", flat=False
    )
)

deps_to_create = []

def add_dep(source, target, dep_type, proto, port, desc=""):
    """Queue a dependency if it doesn't exist and source != target."""
    if source.pk == target.pk:
        return
    key = (source.pk, target.pk)
    if key in existing_deps:
        return
    existing_deps.add(key)
    deps_to_create.append(ApplicationDependency(
        source_application=source,
        target_application=target,
        dependency_type=dep_type,
        protocol=proto,
        port=port,
        status=ApplicationStatusChoices.STATUS_ACTIVE,
        description=desc,
    ))

def find_app(name, env=None):
    """Find an app by name, optionally in a specific environment. Returns list."""
    results = []
    for a in all_apps:
        if a.name == name:
            if env is None or a.environment == env:
                results.append(a)
    return results

def find_apps_in_group(group_name):
    """Find all apps in a group."""
    g = groups.get(group_name)
    if not g:
        return []
    return [a for a in all_apps if a.group_id == g.pk]

PROD = ApplicationEnvironmentChoices.ENV_PRODUCTION
STAGING = ApplicationEnvironmentChoices.ENV_STAGING
HARD = DependencyTypeChoices.TYPE_HARD
SOFT = DependencyTypeChoices.TYPE_SOFT
P_API = DependencyProtocolChoices.PROTO_API
P_DB = DependencyProtocolChoices.PROTO_DATABASE
P_MSG = DependencyProtocolChoices.PROTO_MESSAGING
P_GRPC = DependencyProtocolChoices.PROTO_GRPC
P_FS = DependencyProtocolChoices.PROTO_FILESYSTEM
P_OTHER = DependencyProtocolChoices.PROTO_OTHER

# ── Structured dependency chains ──

# Web frontends -> API gateway -> backend services -> data stores
for env in [PROD, STAGING]:
    nginx_apps = find_app("nginx", env)
    kong_apps = find_app("kong", env)
    haproxy_apps = find_app("haproxy", env)
    traefik_apps = find_app("traefik")
    envoy_apps = find_app("envoy-proxy")

    pg_apps = find_app("postgresql", env)
    mysql_apps = find_app("mysql")
    mongo_apps = find_app("mongodb")
    redis_apps = find_app("redis", env)
    es_apps = find_app("elasticsearch", env)
    kafka_apps = find_app("kafka", env)
    rabbit_apps = find_app("rabbitmq")

    backend_services = [
        "user-service", "order-service", "payment-service", "inventory-service",
        "notification-service", "auth-service", "catalog-service", "shipping-service",
        "pricing-service", "search-service", "recommendation-svc", "media-service",
        "analytics-service", "email-service", "report-service",
    ]

    backend_apps = []
    for svc_name in backend_services:
        backend_apps.extend(find_app(svc_name))

    # nginx -> kong / haproxy (load balancing to gateway)
    for ng in nginx_apps:
        for k in kong_apps:
            add_dep(ng, k, HARD, P_API, 8000, "Reverse proxy to API gateway")
        for h in haproxy_apps:
            add_dep(ng, h, HARD, P_API, 80, "Reverse proxy to load balancer")

    # kong -> backend services
    for k in kong_apps:
        for svc in backend_apps:
            add_dep(k, svc, HARD, P_API, 8080, "API gateway routes to service")

    # traefik / envoy -> backend services (some)
    for t in traefik_apps:
        for svc in random.sample(backend_apps, min(8, len(backend_apps))):
            add_dep(t, svc, HARD, P_API, 8080, "Proxy to backend service")
    for e in envoy_apps:
        for svc in random.sample(backend_apps, min(10, len(backend_apps))):
            add_dep(e, svc, HARD, P_API, 8080, "Envoy proxy to service")

    # Backend services -> databases
    for svc in backend_apps:
        # Most services depend on postgresql
        for pg in pg_apps:
            if random.random() < 0.7:
                add_dep(svc, pg, HARD, P_DB, 5432, "Primary database")
        # Some depend on MySQL
        for m in mysql_apps:
            if random.random() < 0.2:
                add_dep(svc, m, HARD, P_DB, 3306, "MySQL database")
        # Some depend on MongoDB
        for mo in mongo_apps:
            if random.random() < 0.2:
                add_dep(svc, mo, HARD, P_DB, 27017, "Document store")
        # Most use Redis for caching
        for r in redis_apps:
            if random.random() < 0.6:
                add_dep(svc, r, SOFT, P_DB, 6379, "Cache layer")
        # Some use Kafka for events
        for kf in kafka_apps:
            if random.random() < 0.4:
                add_dep(svc, kf, SOFT, P_MSG, 9092, "Event streaming")
        # Some use RabbitMQ
        for rb in rabbit_apps:
            if random.random() < 0.2:
                add_dep(svc, rb, SOFT, P_MSG, 5672, "Message queue")

    # search-service -> elasticsearch
    for ss in find_app("search-service"):
        for es in find_app("elasticsearch", env) or find_app("elasticsearch"):
            add_dep(ss, es, HARD, P_API, 9200, "Search index queries")

# ── Inter-service dependencies ──
# order-service -> payment-service, inventory-service, shipping-service
for os_app in find_app("order-service"):
    for pay in find_app("payment-service"):
        add_dep(os_app, pay, HARD, P_API, 8082, "Process payments")
    for inv in find_app("inventory-service"):
        add_dep(os_app, inv, HARD, P_API, 8083, "Check/update inventory")
    for ship in find_app("shipping-service"):
        add_dep(os_app, ship, SOFT, P_API, 8087, "Schedule shipping")
    for notif in find_app("notification-service"):
        add_dep(os_app, notif, SOFT, P_MSG, 8084, "Send order notifications")

# payment-service -> vault (secrets for payment keys)
for pay in find_app("payment-service"):
    for v in find_app("vault"):
        add_dep(pay, v, HARD, P_API, 8200, "Retrieve payment encryption keys")

# auth-service -> keycloak, openldap, vault
for auth in find_app("auth-service"):
    for kc in find_app("keycloak"):
        add_dep(auth, kc, HARD, P_API, 8443, "Identity provider")
    for ldap in find_app("openldap"):
        add_dep(auth, ldap, HARD, P_OTHER, 389, "LDAP directory")
    for v in find_app("vault"):
        add_dep(auth, v, HARD, P_API, 8200, "Secret management")

# notification-service -> postfix, rabbitmq
for notif in find_app("notification-service"):
    for pf in find_app("postfix"):
        add_dep(notif, pf, HARD, P_OTHER, 25, "Send emails")
    for rb in find_app("rabbitmq"):
        add_dep(notif, rb, SOFT, P_MSG, 5672, "Notification queue")

# email-service -> postfix, dovecot
for em in find_app("email-service"):
    for pf in find_app("postfix"):
        add_dep(em, pf, HARD, P_OTHER, 25, "SMTP relay")
    for dv in find_app("dovecot"):
        add_dep(em, dv, HARD, P_OTHER, 993, "IMAP access")

# ── Monitoring dependencies (monitoring -> everything it scrapes) ──
prometheus_apps = find_app("prometheus")
grafana_apps = find_app("grafana")
alertmanager_apps = find_app("alertmanager")

# grafana -> prometheus, loki, tempo, mimir, elasticsearch
for g in grafana_apps:
    for p in prometheus_apps:
        add_dep(g, p, HARD, P_API, 9090, "Metrics data source")
    for l in find_app("loki"):
        add_dep(g, l, HARD, P_API, 3100, "Log data source")
    for t in find_app("tempo"):
        add_dep(g, t, SOFT, P_API, 3200, "Tracing data source")
    for m in find_app("mimir"):
        add_dep(g, m, SOFT, P_API, 9009, "Long-term metrics source")
    for es in find_app("elasticsearch"):
        add_dep(g, es, SOFT, P_API, 9200, "Elasticsearch data source")

# prometheus -> alertmanager
for p in prometheus_apps:
    for am in alertmanager_apps:
        add_dep(p, am, HARD, P_API, 9093, "Alert routing")

# prometheus -> thanos, victoria-metrics
for p in prometheus_apps:
    for th in find_app("thanos"):
        add_dep(p, th, SOFT, P_GRPC, 10902, "Long-term storage sidecar")
    for vm in find_app("victoria-metrics"):
        add_dep(p, vm, SOFT, P_API, 8428, "Remote write")

# alertmanager -> pagerduty, opsgenie
for am in alertmanager_apps:
    for pd in find_app("pagerduty-agent"):
        add_dep(am, pd, SOFT, P_API, 8081, "Alert escalation")
    for og in find_app("opsgenie-agent"):
        add_dep(am, og, SOFT, P_API, 8082, "Alert escalation")

# Prometheus scrapes many services (soft deps representing scrape targets)
scrape_targets = [
    "node-exporter", "blackbox-exporter", "nginx", "kong", "haproxy",
    "redis", "postgresql", "kafka", "rabbitmq", "elasticsearch",
    "etcd", "kubelet", "user-service", "order-service", "payment-service",
    "auth-service", "vault", "consul",
]
for p in prometheus_apps:
    for target_name in scrape_targets:
        for t in find_app(target_name):
            add_dep(p, t, SOFT, P_API, 9090, f"Scrape {target_name} metrics")

# ── Logging chain ──
# fluentd/filebeat -> logstash/vector -> elasticsearch/loki
for fb in find_app("fluentd") + find_app("filebeat"):
    for ls in find_app("logstash"):
        add_dep(fb, ls, HARD, P_OTHER, 5044, "Forward logs")
    for vec in find_app("vector"):
        if random.random() < 0.5:
            add_dep(fb, vec, HARD, P_OTHER, 8686, "Forward logs")
for ls in find_app("logstash"):
    for es in find_app("elasticsearch"):
        add_dep(ls, es, HARD, P_API, 9200, "Index logs")
for vec in find_app("vector"):
    for loki in find_app("loki"):
        add_dep(vec, loki, HARD, P_API, 3100, "Push logs")
    for es in find_app("elasticsearch"):
        add_dep(vec, es, SOFT, P_API, 9200, "Index logs")

# kibana -> elasticsearch
for kb in find_app("kibana"):
    for es in find_app("elasticsearch"):
        add_dep(kb, es, HARD, P_API, 9200, "Query logs & data")

# opensearch dependencies
for os_app in find_app("opensearch"):
    for kb in find_app("kibana"):
        # kibana might also query opensearch
        pass

# ── Observability chain ──
# opentelemetry-collector -> jaeger, tempo, prometheus
for otel in find_app("opentelemetry-coll"):
    for j in find_app("jaeger"):
        add_dep(otel, j, HARD, P_GRPC, 16686, "Export traces")
    for t in find_app("tempo"):
        add_dep(otel, t, HARD, P_GRPC, 3200, "Export traces")
    for p in prometheus_apps:
        add_dep(otel, p, SOFT, P_API, 9090, "Export metrics")

# ── Container platform ──
# kubelet -> etcd, coredns, containerd
for kl in find_app("kubelet"):
    for et in find_app("etcd"):
        add_dep(kl, et, HARD, P_GRPC, 2379, "Cluster state")
    for cd in find_app("coredns"):
        add_dep(kl, cd, HARD, P_OTHER, 53, "Service DNS resolution")
    for cr in find_app("containerd"):
        add_dep(kl, cr, HARD, P_OTHER, 0, "Container runtime")

# ── Service mesh ──
# istio-proxy -> consul (service discovery), envoy
for ip in find_app("istio-proxy"):
    for c in find_app("consul"):
        add_dep(ip, c, SOFT, P_API, 8500, "Service discovery")
for lp in find_app("linkerd-proxy"):
    for c in find_app("consul"):
        add_dep(lp, c, SOFT, P_API, 8500, "Service discovery")

# ── CI/CD chains ──
# jenkins -> nexus, harbor, gitlab-runner
for j in find_app("jenkins"):
    for n in find_app("nexus"):
        add_dep(j, n, HARD, P_API, 8081, "Pull/push artifacts")
    for h in find_app("harbor"):
        add_dep(j, h, HARD, P_API, 443, "Push container images")
    for gl in find_app("gitlab-runner"):
        add_dep(j, gl, SOFT, P_API, 8093, "Trigger CI jobs")
# argocd -> harbor, consul
for ac in find_app("argocd"):
    for h in find_app("harbor"):
        add_dep(ac, h, HARD, P_API, 443, "Pull container images")
    for c in find_app("consul"):
        add_dep(ac, c, SOFT, P_API, 8500, "Config sync")

# ── Data pipeline ──
# airflow -> postgresql, redis, celery-worker, spark
for af in find_app("airflow"):
    for pg in find_app("postgresql"):
        add_dep(af, pg, HARD, P_DB, 5432, "Metadata database")
    for r in find_app("redis"):
        add_dep(af, r, HARD, P_DB, 6379, "Celery broker")
    for cw in find_app("celery-worker"):
        add_dep(af, cw, HARD, P_OTHER, 0, "Task execution")
    for sp in find_app("spark"):
        add_dep(af, sp, SOFT, P_API, 4040, "Submit Spark jobs")

# spark -> kafka, postgresql, minio
for sp in find_app("spark"):
    for kf in find_app("kafka"):
        add_dep(sp, kf, SOFT, P_MSG, 9092, "Stream ingestion")
    for pg in find_app("postgresql"):
        add_dep(sp, pg, SOFT, P_DB, 5432, "Read/write data")
    for mn in find_app("minio"):
        add_dep(sp, mn, HARD, P_API, 9000, "Object storage I/O")

# flink -> kafka
for fl in find_app("flink"):
    for kf in find_app("kafka"):
        add_dep(fl, kf, HARD, P_MSG, 9092, "Stream source/sink")

# debezium -> kafka, postgresql, mysql
for db in find_app("debezium"):
    for kf in find_app("kafka"):
        add_dep(db, kf, HARD, P_MSG, 9092, "Publish change events")
    for pg in find_app("postgresql"):
        add_dep(db, pg, HARD, P_DB, 5432, "Capture DB changes")
    for my in find_app("mysql"):
        add_dep(db, my, SOFT, P_DB, 3306, "Capture DB changes")

# celery-worker / celery-beat -> redis, rabbitmq
for cw in find_app("celery-worker") + find_app("celery-beat"):
    for r in find_app("redis"):
        add_dep(cw, r, HARD, P_DB, 6379, "Task broker/result backend")
    for rb in find_app("rabbitmq"):
        add_dep(cw, rb, SOFT, P_MSG, 5672, "Alternate broker")

# ── Storage dependencies ──
# ceph -> mon (self, skip), minio
for mn in find_app("minio"):
    for c in find_app("ceph"):
        add_dep(mn, c, SOFT, P_FS, 6789, "Underlying storage")

# velero -> minio (backup storage)
for v in find_app("velero"):
    for mn in find_app("minio"):
        add_dep(v, mn, HARD, P_API, 9000, "Backup storage target")
    for et in find_app("etcd"):
        add_dep(v, et, HARD, P_GRPC, 2379, "Backup etcd snapshots")

# barman -> postgresql
for b in find_app("barman"):
    for pg in find_app("postgresql"):
        add_dep(b, pg, HARD, P_DB, 5432, "PostgreSQL backup source")

# ── Database admin ──
# pgbouncer -> postgresql
for pgb in find_app("pgbouncer"):
    for pg in find_app("postgresql"):
        add_dep(pgb, pg, HARD, P_DB, 5432, "Connection pooling target")

# proxysql -> mysql
for ps in find_app("proxysql"):
    for my in find_app("mysql"):
        add_dep(ps, my, HARD, P_DB, 3306, "Proxy target")

# redis-sentinel -> redis
for rs in find_app("redis-sentinel"):
    for r in find_app("redis"):
        add_dep(rs, r, HARD, P_DB, 6379, "Monitor Redis instances")

# Backend services use pgbouncer instead of direct postgres (some)
for svc_name in ["user-service", "order-service", "payment-service", "catalog-service"]:
    for svc in find_app(svc_name):
        for pgb in find_app("pgbouncer"):
            add_dep(svc, pgb, HARD, P_DB, 6432, "Connection pool")

# ── ML pipeline ──
for jh in find_app("jupyter-hub"):
    for pg in find_app("postgresql"):
        add_dep(jh, pg, SOFT, P_DB, 5432, "Notebook metadata")
    for mn in find_app("minio"):
        add_dep(jh, mn, SOFT, P_API, 9000, "Data storage")
for ml in find_app("mlflow"):
    for pg in find_app("postgresql"):
        add_dep(ml, pg, HARD, P_DB, 5432, "Experiment tracking DB")
    for mn in find_app("minio"):
        add_dep(ml, mn, HARD, P_API, 9000, "Artifact storage")
for ray_app in find_app("ray"):
    for r in find_app("redis"):
        add_dep(ray_app, r, HARD, P_DB, 6379, "Object store")
for ts in find_app("triton-server"):
    for mn in find_app("minio"):
        add_dep(ts, mn, HARD, P_API, 9000, "Model repository")

# ── Communication ──
for mm in find_app("mattermost"):
    for pg in find_app("postgresql"):
        add_dep(mm, pg, HARD, P_DB, 5432, "Message database")
    for r in find_app("redis"):
        add_dep(mm, r, SOFT, P_DB, 6379, "Session cache")
for ms in find_app("matrix-synapse"):
    for pg in find_app("postgresql"):
        add_dep(ms, pg, HARD, P_DB, 5432, "Homeserver database")

# ── CRM ──
for od in find_app("odoo"):
    for pg in find_app("postgresql"):
        add_dep(od, pg, HARD, P_DB, 5432, "Application database")
    for r in find_app("redis"):
        add_dep(od, r, SOFT, P_DB, 6379, "Session cache")

# ── Vault / Consul widespread dependencies ──
# Many services depend on vault for secrets and consul for discovery
vault_dependents = [
    "kong", "nginx", "haproxy", "jenkins", "argocd", "keycloak",
    "airflow", "mattermost", "odoo", "grafana", "cert-manager",
]
for vd_name in vault_dependents:
    for vd in find_app(vd_name):
        for v in find_app("vault"):
            add_dep(vd, v, SOFT, P_API, 8200, "Retrieve secrets")

consul_dependents = [
    "kong", "traefik", "envoy-proxy", "haproxy", "nginx",
    "user-service", "order-service", "payment-service", "auth-service",
    "kubelet", "prometheus", "vault",
]
for cd_name in consul_dependents:
    for cd in find_app(cd_name):
        for c in find_app("consul"):
            add_dep(cd, c, SOFT, P_API, 8500, "Service discovery")

# ── cert-manager dependencies ──
for cm in find_app("cert-manager"):
    for v in find_app("vault"):
        add_dep(cm, v, HARD, P_API, 8200, "PKI secrets engine")

# ── Security agents ──
# wazuh -> elasticsearch, falco -> (standalone)
for wa in find_app("wazuh-agent"):
    for es in find_app("elasticsearch"):
        add_dep(wa, es, HARD, P_API, 9200, "SIEM index")

# ── Cross-cutting: many backend services emit to opentelemetry-collector ──
otel_emitters = [
    "user-service", "order-service", "payment-service", "auth-service",
    "catalog-service", "shipping-service", "pricing-service", "search-service",
    "notification-service", "inventory-service", "kong", "envoy-proxy",
    "nginx", "haproxy",
]
for em_name in otel_emitters:
    for em in find_app(em_name):
        for otel in find_app("opentelemetry-coll"):
            add_dep(em, otel, SOFT, P_GRPC, 4317, "Export telemetry")

# ── Additional random soft dependencies for density ──
# Randomly wire some additional connections to reach ~800+
additional_count = 0
attempts = 0
while additional_count < 100 and attempts < 2000:
    attempts += 1
    a1 = random.choice(all_apps)
    a2 = random.choice(all_apps)
    if a1.pk == a2.pk:
        continue
    key = (a1.pk, a2.pk)
    if key in existing_deps:
        continue
    # Only create if they share an environment or one is production
    if a1.environment != a2.environment and a1.environment != PROD and a2.environment != PROD:
        continue
    existing_deps.add(key)
    deps_to_create.append(ApplicationDependency(
        source_application=a1,
        target_application=a2,
        dependency_type=pick([HARD, SOFT], [30, 70]),
        protocol=pick([P_API, P_DB, P_MSG, P_GRPC, P_OTHER]),
        port=random.choice([80, 443, 8080, 8443, 5432, 6379, 9092, 9090, 0]) or None,
        status=ApplicationStatusChoices.STATUS_ACTIVE,
        description="Cross-service integration",
    ))
    additional_count += 1

if deps_to_create:
    ApplicationDependency.objects.bulk_create(deps_to_create, batch_size=500)

total_deps = ApplicationDependency.objects.count()
print(f"  Created {len(deps_to_create)} new dependencies")
print(f"  Total dependencies: {total_deps}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("DEMO DATA GENERATION COMPLETE")
print("=" * 60)
print(f"  Site:                  {site.name}")
print(f"  Devices:               {total_devices}")
print(f"  Application Groups:    {len(groups)}")
print(f"  Applications:          {len(all_apps)}")
print(f"  Deployments:           {total_deployments}")
print(f"  Dependencies:          {total_deps}")
print("=" * 60)
