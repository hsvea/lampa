/* Lampa: experimental timeline -> player controls focus repair, v0.1.
 * Uses Lampa controllers, so it also covers MSX-generated navigation.
 * No network requests, storage changes, key remapping or player replacement.
 * Disable this extension and restart Lampa to undo.
 */
(function () {
    'use strict';
    if (window.skazRemoteFocusFix) return;
    var api = {version: '0.1', applied: 0, lastError: ''};
    window.skazRemoteFocusFix = api;

    function visible(el) {
        if (!el || !el.getClientRects().length || el.offsetParent === null) return false;
        var style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function panel() {
        var nodes = document.querySelectorAll('.player .player-panel');
        for (var i = nodes.length - 1; i >= 0; i--) {
            if (visible(nodes[i])) return nodes[i];
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
        controller.collectionFocus(target, root);
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
