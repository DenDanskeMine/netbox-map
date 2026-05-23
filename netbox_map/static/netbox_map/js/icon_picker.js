/* #63 — Icon picker for Custom Marker Types.
 *
 * Provides a searchable, visual grid of common MDI icons that injects the
 * chosen `mdi-…` slug into the icon text input. The raw text input remains
 * usable as a fallback for icons not in the curated list (and shows a live
 * preview chip next to the color so the user sees what they're picking).
 */
(function () {
    'use strict';

    // Curated quick-pick set — common infrastructure / monitoring / building
    // icons. Shown when no search query is active. The search input falls
    // through to the full MDI catalog discovered from the loaded stylesheet
    // (see ALL_ICONS below), so any of MDI's ~7000 icons can be selected.
    var CURATED = [
        // Network / infrastructure
        'lan', 'server', 'server-network', 'router', 'router-network',
        'router-wireless', 'switch', 'ethernet', 'ethernet-cable',
        'access-point', 'access-point-network', 'antenna', 'satellite-uplink',
        'connection', 'transit-connection-variant', 'call-split',
        'package-variant-closed',
        // Buildings / rooms
        'office-building', 'office-building-outline', 'home', 'home-city',
        'warehouse', 'factory', 'domain', 'door', 'door-open', 'wall',
        'floor-plan', 'stairs', 'elevator-up', 'window-open',
        // Power
        'flash', 'flash-outline', 'power-plug', 'power-socket-eu',
        'battery', 'battery-high', 'lightning-bolt', 'transmission-tower',
        // Security / safety
        'cctv', 'shield-check', 'fire', 'fire-extinguisher', 'smoke-detector',
        'lock', 'lock-open',
        // IoT / sensors
        'thermometer', 'water', 'gauge', 'speedometer', 'motion-sensor',
        'leak', 'snowflake', 'weather-windy',
        // Cabling / fiber
        'cable-data', 'pipe', 'cable',
        // Status / utility
        'check-circle', 'alert-circle', 'information-outline', 'help-circle',
        'star', 'flag', 'map-marker', 'map-marker-outline', 'crosshairs-gps',
        // Other common
        'wifi', 'wifi-off', 'printer', 'desktop-tower', 'monitor',
        'cellphone', 'phone', 'cog', 'wrench',
    ];

    // Cap how many search hits we render at once — DOM perf with 7000 buttons
    // is fine but the list gets unwieldy to scroll. Searches with a query
    // narrow down quickly so this very rarely truncates.
    var MAX_RESULTS = 300;

    // Discover every MDI icon from the already-loaded stylesheet at runtime.
    // We look for CSS rules of the form `.mdi-NAME::before { content: "\f…" }`
    // and ignore the utility classes (rotate, flip, size, dark/light) by
    // requiring a `content` property on the rule.
    var _allIconsCache = null;
    function getAllMdiIcons() {
        if (_allIconsCache) return _allIconsCache;
        var set = new Set();
        for (var i = 0; i < document.styleSheets.length; i++) {
            var sheet = document.styleSheets[i];
            var rules;
            try { rules = sheet.cssRules || sheet.rules; }
            catch (e) { continue; }  // cross-origin sheet — skip
            if (!rules) continue;
            for (var j = 0; j < rules.length; j++) {
                var rule = rules[j];
                if (!rule || !rule.selectorText || !rule.style) continue;
                if (!rule.style.content || rule.style.content === 'none') continue;
                // selectorText may contain a comma-separated list. Match every
                // .mdi-<name>:before or ::before that is followed by ":"/"{"/EOL.
                var re = /\.mdi-([a-z0-9-]+)(?:::|:)before(?=\s*[,{]|$)/gi;
                var m;
                while ((m = re.exec(rule.selectorText)) !== null) {
                    set.add(m[1]);
                }
            }
        }
        _allIconsCache = Array.from(set).sort();
        return _allIconsCache;
    }

    function build(inputEl) {
        var wrap = document.createElement('div');
        wrap.className = 'icon-picker';

        // Search box
        var search = document.createElement('input');
        search.type = 'text';
        search.className = 'form-control form-control-sm icon-picker-search';
        search.placeholder = 'Search any MDI icon (e.g. router, fire, server)…';
        wrap.appendChild(search);

        // Live preview chip
        var preview = document.createElement('div');
        preview.className = 'icon-picker-preview';
        preview.innerHTML = '<span class="icon-picker-preview-label">Preview</span><span class="icon-picker-preview-chip"><i class="mdi"></i></span>';
        wrap.appendChild(preview);

        // Result count footer
        var footer = document.createElement('div');
        footer.className = 'icon-picker-footer text-muted small mt-1';
        wrap.appendChild(footer);

        // Icon grid
        var grid = document.createElement('div');
        grid.className = 'icon-picker-grid';
        wrap.appendChild(grid);

        function makeButton(name) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-picker-btn';
            btn.title = 'mdi-' + name;
            btn.dataset.icon = 'mdi-' + name;
            btn.innerHTML = '<i class="mdi mdi-' + name + '"></i>';
            if (inputEl.value === 'mdi-' + name) btn.classList.add('active');
            btn.addEventListener('click', function () {
                inputEl.value = 'mdi-' + name;
                updatePreview();
                grid.querySelectorAll('.icon-picker-btn.active').forEach(function (el) {
                    el.classList.remove('active');
                });
                btn.classList.add('active');
            });
            return btn;
        }

        function render(filter) {
            grid.innerHTML = '';
            var q = (filter || '').toLowerCase().trim();
            var pool, hits, truncated = 0;
            if (!q) {
                // No query → show the curated quick-pick set
                pool = CURATED;
                hits = pool.slice();
            } else {
                // Search the full MDI catalog discovered from the stylesheet.
                // Substring match — could be smarter but this is fast and
                // works well for the kinds of terms users type.
                pool = getAllMdiIcons();
                hits = [];
                for (var i = 0; i < pool.length; i++) {
                    if (pool[i].indexOf(q) !== -1) hits.push(pool[i]);
                }
                if (hits.length > MAX_RESULTS) {
                    truncated = hits.length - MAX_RESULTS;
                    hits = hits.slice(0, MAX_RESULTS);
                }
            }
            hits.forEach(function (name) { grid.appendChild(makeButton(name)); });

            if (!q) {
                footer.textContent = 'Showing ' + hits.length + ' common picks — type to search all '
                    + getAllMdiIcons().length + ' MDI icons';
            } else if (hits.length === 0) {
                footer.textContent = 'No MDI icons match "' + q + '" — try a shorter term';
            } else if (truncated) {
                footer.textContent = 'Showing ' + hits.length + ' of ' + (hits.length + truncated)
                    + ' matches — refine your search to see more';
            } else {
                footer.textContent = hits.length + ' match' + (hits.length === 1 ? '' : 'es');
            }
        }

        function updatePreview() {
            var icon = preview.querySelector('.mdi');
            var chip = preview.querySelector('.icon-picker-preview-chip');
            // Strip every existing mdi-* class
            icon.className = 'mdi';
            var name = (inputEl.value || '').trim();
            if (name) icon.classList.add(name);
            // Sync background from the color picker if present
            var colorEl = document.getElementById('id_color');
            if (chip && colorEl && colorEl.value) chip.style.background = colorEl.value;
            // Sync foreground from the icon_foreground select (auto/light/dark)
            var fgEl = document.getElementById('id_icon_foreground');
            if (chip) {
                var fg = fgEl ? fgEl.value : 'auto';
                if (fg === 'auto' && colorEl && colorEl.value) {
                    fg = isLightBg(colorEl.value) ? 'dark' : 'light';
                }
                chip.style.color = fg === 'dark' ? '#1a1a1a' : '#ffffff';
            }
        }

        function isLightBg(hex) {
            var c = (hex || '').replace('#', '');
            if (c.length !== 6) return false;
            var r = parseInt(c.substring(0, 2), 16);
            var g = parseInt(c.substring(2, 4), 16);
            var b = parseInt(c.substring(4, 6), 16);
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 160;
        }

        // Debounce search input — 7000 icons match fast but rendering 300
        // buttons per keystroke at full typing speed wastes work.
        var searchTimer = null;
        search.addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { render(search.value); }, 100);
        });
        inputEl.addEventListener('input', updatePreview);
        // Live preview when the color picker or foreground selector changes
        var colorEl = document.getElementById('id_color');
        if (colorEl) colorEl.addEventListener('input', updatePreview);
        var fgEl = document.getElementById('id_icon_foreground');
        if (fgEl) fgEl.addEventListener('change', updatePreview);

        // Insert directly after the input (above the help-text if any)
        var anchor = inputEl.closest('.field-group, .mb-3, .form-group') || inputEl.parentElement;
        if (anchor && anchor.parentElement) {
            anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
        } else {
            inputEl.parentElement.appendChild(wrap);
        }

        render('');
        updatePreview();
    }

    function init() {
        document.querySelectorAll('.icon-picker-input').forEach(build);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
