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
        this.searchQuery = '';
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

    function parseConfig(container) {
        var deviceDetailUrl = container.getAttribute('data-device-detail-url') || '';
        deviceDetailUrl = deviceDetailUrl.replace(/0\/$/, '');

        var savedLayout = {};
        try { savedLayout = JSON.parse(container.getAttribute('data-saved-layout') || '{}'); } catch(e) {}

        return {
            topologyUrl: container.getAttribute('data-topology-url') || '',
            deviceDetailUrl: deviceDetailUrl,
            saveUrl: container.getAttribute('data-save-url') || '',
            csrfToken: getCsrfToken(container.getAttribute('data-csrf-token') || ''),
            initialFilters: JSON.parse(container.getAttribute('data-initial-filters') || '{}'),
            savedViewId: container.getAttribute('data-saved-view-id') || null,
            savedLayout: savedLayout,
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

    // Map device role slugs to MDI icon Unicode codepoints
    var ROLE_ICONS = {
        'router': '\uF522',          // mdi-router
        'core-router': '\uF522',
        'switch': '\uF1B3',          // mdi-lan
        'core-switch': '\uF1B3',
        'access-switch': '\uF1B3',
        'distribution-switch': '\uF1B3',
        'firewall': '\uF587',        // mdi-shield-lock
        'server': '\uF4B8',          // mdi-server
        'storage': '\uF1DA',         // mdi-harddisk
        'access-point': '\uF5A8',    // mdi-access-point
        'wireless': '\uF5A8',
        'pdu': '\uF192C',            // mdi-power-plug
        'ups': '\uF06D5',            // mdi-battery
        'console-server': '\uF120',  // mdi-console
        'patch-panel': '\uF0C73',    // mdi-ethernet
        'phone': '\uF03F2',          // mdi-phone
        'camera': '\uF0124',         // mdi-camera
        'printer': '\uF042A',        // mdi-printer
    };

    function roleIcon(roleSlug) {
        if (!roleSlug) return '\uF1A7';  // mdi-monitor (default)
        // Try exact match, then partial
        if (ROLE_ICONS[roleSlug]) return ROLE_ICONS[roleSlug];
        for (var key in ROLE_ICONS) {
            if (roleSlug.indexOf(key) !== -1) return ROLE_ICONS[key];
        }
        return '\uF1A7';  // mdi-monitor
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
    };
})();
