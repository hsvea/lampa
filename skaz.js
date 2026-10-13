/* Lampa: experimental timeline -> player controls focus repair, v0.6 diagnostics.
 * Uses Lampa controllers, so it also covers MSX-generated navigation.
 * No network requests, key remapping or player replacement. Diagnostics preference is saved.
 * Disable this extension and restart Lampa to undo.
 */
(function () {
    'use strict';
    if (window.skazRemoteFocusFix) return;
    var api = {version: '0.6', applied: 0, lastError: ''};
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
        if (name === 'player_panel') {
            ['left', 'right'].forEach(function (direction) {
                var previous = handler[direction];
                handler[direction] = function () {
                    var root = panel();
                    if (root && root.querySelector('.player-panel__timeline.focus') && !buttonFocused(root)) {
                        // A focused timeline needs the seek controller, not button navigation.
                        Lampa.Controller.toggle('player_rewind');
                        if (Lampa.Controller.enabled().name === 'player_rewind') {
                            Lampa.Controller.trigger(direction);
                            return;
                        }
                    }
                    if (typeof previous === 'function') return previous.apply(this, arguments);
                    if (typeof previous === 'string') return Lampa.Controller.trigger(previous);
                };
            });
        }
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
    var state = {version: '0.6', lines: [], sequence: 0};
    window.skazRemoteDiagnostics = state;
    var box = null;
    var preference = 'skaz_remote_diagnostics';
    function enabled() {
        if (!window.Lampa || !Lampa.Storage) return false;
        var value = Lampa.Storage.get(preference, false);
        return value === true || value === 'true' || value === 1 || value === '1';
    }
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
        if (!enabled()) return;
        state.lines.push(++state.sequence + ' ' + clean(message));
        if (state.lines.length > 8) state.lines.shift();
        render();
    }
    function render() {
        if (!enabled()) {
            if (box && box.parentNode) box.parentNode.removeChild(box);
            box = null;
            state.lines = [];
            return;
        }
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
        box.textContent = 'SKAZ DIAG 0.6 | Lampa ' + clean(version) + ' | frame=' + (window.top === window.self ? 'top' : 'iframe') + '\n' +
            'CTRL: ' + clean(a && a.name) + ' | mobile=' + mobile + ' | fixes=' + (fix.applied || 0) + '\n' +
            'PANELS: ' + panels.length + '/' + visible + ' visible | buttons=' + document.querySelectorAll('.player-panel .button.selector').length + '\n' +
            'PANEL CSS: ' + (panels.length ? clean(window.getComputedStyle(panels[0]).display + '/' + window.getComputedStyle(panels[0]).position + ' offsetParent=' + (panels[0].offsetParent === null ? 'null' : 'set')) : '-') + '\n' +
            'FOCUS: ' + focus() + '\n' +
            (fix.lastError ? 'FIX ERROR: ' + clean(fix.lastError) + '\n' : '') + state.lines.join('\n');
    }
    function observeController() {
        if (!enabled()) return;
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
        if (!enabled()) return;
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
        Lampa.SettingsApi.addComponent({
            component: 'skaz_remote_control',
            name: 'Skaz: управление',
            icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="2" width="12" height="20" rx="3" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/><path d="M10 17h4" stroke="currentColor" stroke-width="2"/></svg>'
        });
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: preference, type: 'trigger', default: false},
            field: {
                name: 'Показывать диагностику',
                description: 'Кнопки пульта, контроллер и фокус на экране. Исправление управления работает независимо от этого переключателя.'
            },
            onChange: function () { setTimeout(function () { observeController(); render(); }, 0); }
        });
        Lampa.Controller.listener.follow('toggle', function (event) {
            add('CTRL -> ' + clean(event && event.name));
            observeController();
        });
        observeController();
        add('READY: play Skaz, press DOWN twice, then RIGHT');
        setInterval(function () { observeController(); render(); }, 500);

    }
    render();
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
    }
})();

/* Initial stream loading diagnostics; no requests, media URLs or credentials sent. */
(function () {
    'use strict';
    if (window.skazStreamDiagnostics) return;
    var state = {version: '0.6', active: false, completed: false, startedAt: 0, stage: '', error: '', host: '-', format: '-', lastTime: null, advances: 0};
    window.skazStreamDiagnostics = state;
    var box = null, timer = null, preference = 'skaz_stream_loading_debug';

    function enabled() {
        var value = Lampa.Storage.get(preference, true);
        return value === true || value === 'true' || value === 1 || value === '1';
    }
    function removeBox() {
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null;
    }
    function cleanError(value) {
        return String(value || 'Неизвестная ошибка').replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
            .replace(/(token|password|authorization|signature|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[скрыто]')
            .replace(/[\r\n\t]+/g, ' ').slice(0, 260);
    }
    function source(data) {
        state.host = '-'; state.format = '-';
        try {
            var link = document.createElement('a');
            link.href = String(data && data.url || '');
            state.host = link.hostname || '-';
            var match = (link.pathname || '').match(/\.(m3u8|mpd|mp4|mkv|webm|ts)$/i);
            state.format = match ? match[1].toUpperCase() : 'не определён по URL';
        } catch (e) {}
    }
    function render() {
        if (!state.active || state.completed || !enabled()) { removeBox(); return; }
        if (!document.body) return;
        if (!box || !document.body.contains(box)) {
            box = document.createElement('pre');
            box.id = 'skaz-stream-loading-debug';
            box.setAttribute('aria-hidden', 'true');
            box.style.cssText = 'position:fixed!important;right:22px!important;bottom:22px!important;width:70vw!important;max-width:1250px!important;padding:16px!important;margin:0!important;background:rgba(0,0,0,.9)!important;color:#fff!important;font:22px/1.4 monospace!important;z-index:2147483646!important;white-space:pre-wrap!important;word-break:break-word!important;pointer-events:none!important;display:block!important;visibility:visible!important;opacity:1!important;';
            document.body.appendChild(box);
        }
        var seconds = Math.floor((Date.now() - state.startedAt) / 1000);
        box.textContent = 'ПОТОК · DEBUG 0.6 · ' + seconds + ' с\n' +
            'Сервер: ' + state.host + ' | Формат: ' + state.format + '\n' +
            'Этап: ' + state.stage + '\n' +
            (state.error ? 'Ошибка: ' + state.error : (seconds >= 30 ? 'Долгое ожидание. Причина пока не определена.' : 'Ожидаю начало воспроизведения…'));
    }
    function stop() {
        state.active = false;
        clearInterval(timer); timer = null;
        removeBox();
    }
    function complete() {
        if (!state.active) return;
        state.completed = true;
        stop();
    }
    function begin(data) {
        stop();
        state.active = true; state.completed = false; state.startedAt = Date.now();
        state.stage = 'Ссылка передана плееру'; state.error = '';
        state.lastTime = null; state.advances = 0;
        source(data);
        render(); timer = setInterval(render, 500);
    }
    function stage(text) {
        if (!state.active) return;
        state.stage = text;
        render();
    }
    function start() {
        if (state.started || !window.Lampa || !Lampa.Player) return;
        state.started = true;
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: preference, type: 'trigger', default: true},
            field: {name: 'Диагностика загрузки потока', description: 'Показывать при запуске видео и скрывать после начала воспроизведения. При ошибке окно остаётся до выхода из плеера.'},
            onChange: function () { setTimeout(render, 0); }
        });
        Lampa.Player.listener.follow('start', begin);
        Lampa.Player.listener.follow('destroy', stop);
        Lampa.Player.listener.follow('external', stop);
        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
            var video = Lampa.PlayerVideo.listener;
            video.follow('loadeddata', function () { stage('Данные видео получены'); });
            video.follow('canplay', function () { stage('Плеер готов; ожидаю воспроизведение'); });
            video.follow('error', function (e) {
                if (!state.active) return;
                state.error = cleanError(e && (e.error || e.message));
                stage(e && e.fatal ? 'Ошибка запуска' : 'Ошибка; ожидаю повторную попытку');
            });
            // A play command or canplay does not prove that video has started.
            // Require two small forward time steps to ignore initial resume seeks.
            video.follow('timeupdate', function (e) {
                if (!state.active || !e || typeof e.current !== 'number' || !isFinite(e.current)) return;
                if (state.lastTime !== null) {
                    var delta = e.current - state.lastTime;
                    if (delta > 0 && delta < 3) state.advances++;
                    else if (delta !== 0) state.advances = 0;
                }
                state.lastTime = e.current;
                if (state.advances >= 2) complete();
            });
        }
        // Some HTML5 backends expose native events instead of PlayerVideo events.
        document.addEventListener('playing', function (e) {
            if (!state.active || !e.target || String(e.target.tagName).toLowerCase() !== 'video') return;
            var root = null;
            try { root = Lampa.Player.render(); root = root && (root[0] || root); } catch (ignore) {}
            if (root && root.contains(e.target)) complete();
        }, true);
    }
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
