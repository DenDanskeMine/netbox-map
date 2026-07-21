/* NetBox Map — Topology Core Module */
/* EventBus, State, API client, utility functions */

window.TopologyApp = (function() {
    'use strict';

    /* ===== EventBus ===== */

    function EventBus() {
        this._listeners = {};
    }

    EventBus.prototype.on = function(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    };

    EventBus.prototype.off = function(event, fn) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(function(f) { return f !== fn; });
    };

    EventBus.prototype.emit = function(event, data) {
        var fns = this._listeners[event];
        if (!fns) return;
        for (var i = 0; i < fns.length; i++) {
            fns[i](data);
        }
    };

    /* ===== State ===== */

    function State(config) {
        this.topologyUrl = config.topologyUrl;
        this.deviceDetailUrl = config.deviceDetailUrl;
        this.saveUrl = config.saveUrl;
        this.csrfToken = config.csrfToken;
        this.initialFilters = config.initialFilters || {};
        this.savedViewId = config.savedViewId || null;
        this.savedLayout = config.savedLayout || {};
        this.nodes = [];
        this.edges = [];
        this.selectedNode = null;
        this.visibleRoles = new Set();
        this.hiddenNodes = new Set();
        this.portOverrides = {};  // portId -> 'left'|'right'
        this.layout = 'force';
        this.viewMode = 'stencil';
        this.cableStyle = 'curve'; // 'curve' or 'ortho'
        this.cableColorMode = 'physical'; // 'physical' or 'speed'
        this.snapToGrid = false;
        this.gridSize = 20;
        this.autoSortPorts = true;
        this.customHierarchy = null;
        this.addedDeviceIds = new Set();
        this.searchQuery = '';
        this.topologyMode = 'network';  // 'network' or 'apps'
        this.appDataUrl = config.appDataUrl || '';
        this.appDetailUrl = config.appDetailUrl || '';
    }

    /* ===== API ===== */

    function API(state) {
        this.state = state;
    }

    API.prototype.get = function(url) {
        return fetch(url, {
            method: 'GET',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': this.state.csrfToken,
            },
            credentials: 'same-origin',
        }).then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        });
    };

    API.prototype.post = function(url, data) {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': this.state.csrfToken,
            },
            credentials: 'same-origin',
            body: JSON.stringify(data),
        }).then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        });
    };

    /* ===== CSRF ===== */

    function getCsrfToken(configToken) {
        if (configToken) return configToken;
        // Fallback: read from cookie (standard Django AJAX pattern)
        var match = document.cookie.match(/csrftoken=([^;]+)/);
        return match ? match[1] : '';
    }

    /* ===== Config Parser ===== */

    function parseJsonScript(id) {
        var el = document.getElementById(id);
        if (!el) return {};
        try { return JSON.parse(el.textContent || '{}'); } catch(e) { return {}; }
    }

    function parseConfig(container) {
        var deviceDetailUrl = container.getAttribute('data-device-detail-url') || '';
        deviceDetailUrl = deviceDetailUrl.replace(/0\/$/, '');

        // Read JSON data from safe <script> tags (avoids escaping issues)
        var initialFilters = parseJsonScript('topo-initial-filters');
        // initial-filters is double-encoded (json string inside json_script), parse inner string
        if (typeof initialFilters === 'string') {
            try { initialFilters = JSON.parse(initialFilters); } catch(e) { initialFilters = {}; }
        }
        var savedLayout = parseJsonScript('topo-saved-layout');
        if (typeof savedLayout === 'string') {
            try { savedLayout = JSON.parse(savedLayout); } catch(e) { savedLayout = {}; }
        }

        var appDetailUrl = container.getAttribute('data-app-detail-url') || '';
        appDetailUrl = appDetailUrl.replace(/0\/$/, '');

        return {
            topologyUrl: container.getAttribute('data-topology-url') || '',
            deviceDetailUrl: deviceDetailUrl,
            saveUrl: container.getAttribute('data-save-url') || '',
            csrfToken: getCsrfToken(container.getAttribute('data-csrf-token') || ''),
            initialFilters: initialFilters,
            savedViewId: container.getAttribute('data-saved-view-id') || null,
            savedLayout: savedLayout,
            appDataUrl: container.getAttribute('data-app-data-url') || '',
            appDetailUrl: appDetailUrl,
        };
    }

    /* ===== Utilities ===== */

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatSpeed(kbps) {
        if (!kbps) return '';
        if (kbps >= 1000000) return (kbps / 1000000) + 'G';
        if (kbps >= 1000) return (kbps / 1000) + 'M';
        return kbps + 'K';
    }

    function speedColor(kbps) {
        if (!kbps) return '#6c757d';
        if (kbps >= 100000000) return '#e91e63';
        if (kbps >= 40000000) return '#e74c3c';
        if (kbps >= 25000000) return '#9b59b6';
        if (kbps >= 10000000) return '#3498db';
        if (kbps >= 1000000) return '#2ecc71';
        return '#f39c12';
    }

    function speedClass(kbps) {
        if (!kbps) return '';
        if (kbps >= 100000000) return 'speed-100g';
        if (kbps >= 40000000) return 'speed-40g';
        if (kbps >= 25000000) return 'speed-25g';
        if (kbps >= 10000000) return 'speed-10g';
        if (kbps >= 1000000) return 'speed-1g';
        return 'speed-100m';
    }

    function statusColor(status) {
        switch (status) {
            case 'active': return '#2ecc71';
            case 'planned': return '#3498db';
            case 'staged': return '#f39c12';
            case 'failed': return '#e74c3c';
            case 'offline': return '#95a5a6';
            case 'decommissioning': return '#e67e22';
            case 'inventory': return '#9b59b6';
            default: return '#6c757d';
        }
    }

    // Map device role slugs to MDI icon Unicode codepoints. Verified against
    // the currently-bundled Material Design Icons 7.4.47 (NetBox core's own
    // netbox-external.css) \u2014 most MDI icons live in the Supplementary
    // Private Use Area (codepoints > U+FFFF) and need the \u{XXXXX} code
    // point escape, not \uXXXXX, which silently truncates to \uXXXX plus a
    // stray literal trailing character (#XX, garbled text in exports where
    // it isn't clipped by a small on-screen circle).
    const ROLE_ICONS = {
        'router': '\u{F11E2}',          // mdi-router
        'core-router': '\u{F11E2}',
        'switch': '\u{F0317}',          // mdi-lan
        'core-switch': '\u{F0317}',
        'access-switch': '\u{F0317}',
        'distribution-switch': '\u{F0317}',
        'firewall': '\u{F099D}',        // mdi-shield-lock
        'server': '\u{F048B}',          // mdi-server
        'storage': '\u{F02CA}',         // mdi-harddisk
        'access-point': '\u{F0003}',    // mdi-access-point
        'wireless': '\u{F0003}',
        'pdu': '\u{F0427}',             // mdi-power-socket
        'ups': '\u{F0079}',             // mdi-battery
        'console-server': '\u{F018D}',  // mdi-console
        'patch-panel': '\u{F0200}',     // mdi-ethernet
        'phone': '\u{F03F2}',           // mdi-phone
        'camera': '\u{F0100}',          // mdi-camera
        'printer': '\u{F042A}',         // mdi-printer
    };
    const ROLE_ICON_DEFAULT = '\u{F0379}'; // mdi-monitor

    function roleIcon(roleSlug) {
        if (!roleSlug) return ROLE_ICON_DEFAULT;
        // Try exact match, then partial
        if (ROLE_ICONS[roleSlug]) return ROLE_ICONS[roleSlug];
        for (var key in ROLE_ICONS) {
            if (roleSlug.indexOf(key) !== -1) return ROLE_ICONS[key];
        }
        return ROLE_ICON_DEFAULT;
    }

    /* ===== Application Utilities ===== */

    function criticalityColor(level) {
        var colors = {critical:'#e74c3c', high:'#e67e22', medium:'#f39c12', low:'#3498db'};
        return colors[level] || '#6c757d';
    }

    const APP_TYPE_ICONS = {
        'web-app': '\u{F059F}',    // mdi-web
        'database': '\u{F01BC}',   // mdi-database
        'api': '\u{F109B}',        // mdi-api
        'messaging': '\u{F0361}',  // mdi-message
        'cache': '\u{F035B}',      // mdi-memory
        'monitoring': '\u{F0430}', // mdi-pulse
        'storage': '\u{F02CA}',    // mdi-harddisk
        'auth': '\u{F0BC4}',       // mdi-shield-key
    };
    const APP_TYPE_ICON_DEFAULT = '\u{F08C6}'; // mdi-application

    function appTypeIcon(type) {
        return APP_TYPE_ICONS[type] || APP_TYPE_ICON_DEFAULT;
    }

    return {
        EventBus: EventBus,
        State: State,
        API: API,
        parseConfig: parseConfig,
        escapeHtml: escapeHtml,
        formatSpeed: formatSpeed,
        speedColor: speedColor,
        speedClass: speedClass,
        statusColor: statusColor,
        roleIcon: roleIcon,
        criticalityColor: criticalityColor,
        appTypeIcon: appTypeIcon,
        APP_TYPE_ICONS: APP_TYPE_ICONS,
    };
})();
