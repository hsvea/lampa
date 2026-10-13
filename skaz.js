/* Lampa: experimental timeline -> player controls focus repair, v0.3 diagnostics.
 * Uses Lampa controllers, so it also covers MSX-generated navigation.
 * No network requests, storage changes, key remapping or player replacement.
 * Disable this extension and restart Lampa to undo.
 */
(function () {
    'use strict';
    if (window.skazRemoteFocusFix) return;
    var api = {version: '0.3', applied: 0, lastError: ''};
    window.skazRemoteFocusFix = api;

    function visible(el) {
        if (!el || !el.getClientRects().length) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function panel() {
        var nodes = document.querySelectorAll('.player .player-panel');
        for (var i = nodes.length - 1; i >= 0; i--) {
            if (visible(nodes[i]) || buttons(nodes[i]).length) return nodes[i];
        }
        return null;
    }

    function buttons(root) {
        var all = root.querySelectorAll('.button.selector');
        var result = [];
        for (var i = 0; i < all.length; i++) {
            if (visible(all[i]) && !all[i].classList.contains('hide')) result.push(all[i]);
        }
        return result;
    }

    function buttonFocused(root) {
        return !!root.querySelector('.button.selector.focus');
    }

    function repair() {
        var root = panel();
        if (!root) return false;
        var list = buttons(root);
        if (!list.length) return false;
        var controller = Lampa.Controller;
        var current = controller.enabled().name;
        if (current !== 'player_rewind' && current !== 'player_panel') return false;
        // Preserve the standard IPTV controller and any selection dialogs.
        if (current === 'player_rewind') controller.toggle('player_panel');
        if (controller.enabled().name !== 'player_panel') return false;
        list = buttons(root);
        if (!list.length) return false;
        var target = list[0];
        for (var i = 0; i < list.length; i++) {
            if (list[i].classList.contains('player-panel__playpause')) target = list[i];
        }
        controller.collectionSet(root);
        if (target.offsetParent !== null) controller.collectionFocus(target, root);
        else {
            // Fixed elements can be rendered with a null offsetParent on TV browsers.
            // collectionFocus would reject them and select the timeline again.
            controller.focus(window.jQuery ? window.jQuery(target) : target);
        }
        // Lampa may omit the visual marker if it misdetects the platform.
        // collectionFocus above still establishes the actual selected control.
        target.classList.add('focus');
        api.applied++;
        return true;
    }

    function patchActive() {
        var active = Lampa.Controller.enabled();
        if (active.name !== 'player_rewind' && active.name !== 'player_panel') return;
        var handler = active.controller;
        if (!handler || handler.__skazFocusFix) return;
        var original = handler.down;
        var name = active.name;
        handler.__skazFocusFix = true;
        handler.down = function () {
            var root = panel();
            // Only intervene when navigating out of the timeline, or when
            // the panel controller is active but no button has focus.
            if (root && (name === 'player_rewind' || !buttonFocused(root))) {
                try { if (repair()) return; }
                catch (e) {
                    api.lastError = String(e);
                    if (window.console) console.warn('Skaz focus fix:', e);
                }
            }
            if (typeof original === 'function') return original.apply(this, arguments);
            if (typeof original === 'string') return Lampa.Controller.trigger(original);
        };
    }

    function start() {
        if (api.started || !window.Lampa || !Lampa.Controller) return;
        api.started = true;
        Lampa.Controller.listener.follow('toggle', patchActive);
        patchActive();
        if (Lampa.Noty) Lampa.Noty.show('Исправление фокуса плеера включено');
    }

    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
    }
})();

/* On-screen diagnostics. Local only; does not consume or remap key events. */
(function () {
    'use strict';
    if (window.skazRemoteDiagnostics) return;
    var state = {version: '0.3', lines: [], sequence: 0};
    window.skazRemoteDiagnostics = state;
    var box = null;
    var keys = {13: 'OK', 27: 'BACK', 37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN', 461: 'BACK', 10009: 'BACK'};

    function clean(value) {
        return String(value == null ? '-' : value).replace(/[\r\n\t]+/g, ' ').slice(0, 135);
    }
    function active() {
        try { return window.Lampa && Lampa.Controller.enabled(); }
        catch (e) { return null; }
    }
    function focus() {
        var el = document.querySelector('.player .focus') || document.querySelector('.focus');
        return el ? clean(el.className) : 'none';
    }
    function add(message) {
        state.lines.push(++state.sequence + ' ' + clean(message));
        if (state.lines.length > 8) state.lines.shift();
        render();
    }
    function render() {
        if (!document.body) return;
        if (!box || !document.body.contains(box)) {
            box = document.createElement('pre');
            box.id = 'skaz-remote-diagnostics';
            box.setAttribute('aria-hidden', 'true');
            box.style.cssText = 'position:fixed!important;left:18px!important;top:18px!important;right:auto!important;bottom:auto!important;width:78vw!important;max-width:1400px!important;margin:0!important;padding:12px!important;z-index:2147483647!important;background:rgba(0,0,0,.9)!important;color:#b9ffb9!important;font:20px/1.25 monospace!important;white-space:pre-wrap!important;word-break:break-all!important;pointer-events:none!important;text-align:left!important;display:block!important;visibility:visible!important;opacity:1!important;';
            document.body.appendChild(box);
        }
        var a = active();
        var mobile = '?';
        var version = '?';
        try {
            mobile = Lampa.Platform.screen('mobile');
            version = Lampa.Manifest.app_version || Lampa.Manifest.app_digital;
        } catch (e) {}
        var panels = document.querySelectorAll('.player-panel');
        var visible = 0;
        for (var i = 0; i < panels.length; i++) {
            if (panels[i].getClientRects().length) visible++;
        }
        var fix = window.skazRemoteFocusFix || {};
        box.textContent = 'SKAZ DIAG 0.3 | Lampa ' + clean(version) + ' | frame=' + (window.top === window.self ? 'top' : 'iframe') + '\n' +
            'CTRL: ' + clean(a && a.name) + ' | mobile=' + mobile + ' | fixes=' + (fix.applied || 0) + '\n' +
            'PANELS: ' + panels.length + '/' + visible + ' visible | buttons=' + document.querySelectorAll('.player-panel .button.selector').length + '\n' +
            'PANEL CSS: ' + (panels.length ? clean(window.getComputedStyle(panels[0]).display + '/' + window.getComputedStyle(panels[0]).position + ' offsetParent=' + (panels[0].offsetParent === null ? 'null' : 'set')) : '-') + '\n' +
            'FOCUS: ' + focus() + '\n' +
            (fix.lastError ? 'FIX ERROR: ' + clean(fix.lastError) + '\n' : '') + state.lines.join('\n');
    }
    function observeController() {
        var a = active();
        if (!a || !a.controller || String(a.name).indexOf('player') !== 0) return;
        ['up', 'down', 'left', 'right', 'enter', 'back'].forEach(function (name) {
            var original = a.controller[name];
            if (typeof original !== 'function' || original.__skazObserved) return;
            var wrapped = function () {
                add('CALL ' + a.name + '.' + name);
                try { return original.apply(this, arguments); }
                catch (e) { add('ERROR ' + clean(e && e.message)); throw e; }
                finally { setTimeout(render, 60); }
            };
            wrapped.__skazObserved = true;
            a.controller[name] = wrapped;
        });
    }
    function onKey(e) {
        var code = e.keyCode || e.which;
        if (!keys[code]) return;
        var a = active();
        add('KEY ' + e.type + ' ' + keys[code] + '(' + code + ') ctrl=' + clean(a && a.name));
        setTimeout(render, 80);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    function start() {
        if (state.started || !window.Lampa || !Lampa.Controller) return;
        state.started = true;
        Lampa.Controller.listener.follow('toggle', function (event) {
            add('CTRL -> ' + clean(event && event.name));
            observeController();
        });
        observeController();
        add('READY: play Skaz, press DOWN twice, then RIGHT');
        setInterval(function () { observeController(); render(); }, 500);
        if (Lampa.Noty) Lampa.Noty.show('SKAZ DIAG 0.3 загружен');
    }
    render();
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
    }
})();
