/* Lampa: experimental timeline -> player controls focus repair, v0.20 diagnostics.
 * Uses Lampa controllers, so it also covers MSX-generated navigation.
 * Limited startup probes; no key remapping or player replacement. Diagnostics preference is saved.
 * Disable this extension and restart Lampa to undo.
 */
(function () {
    'use strict';
    if (window.skazRemoteFocusFix) return;
    var api = {version: '0.20', applied: 0, lastError: ''};
    window.skazRemoteFocusFix = api;

    function enabled() {
        var value = Lampa.Storage.get('skaz_remote_fix', true);
        return value === true || value === 'true' || value === 1 || value === '1';
    }

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
        var root = enabled() ? panel() : null;
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
                    var root = enabled() ? panel() : null;
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
            var root = enabled() ? panel() : null;
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
        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Skaz: управление и диагностика · версия ' + api.version);
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
    var state = {version: '0.20', lines: [], sequence: 0};
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
        box.textContent = 'SKAZ DIAG 0.20 | Lampa ' + clean(version) + ' | frame=' + (window.top === window.self ? 'top' : 'iframe') + '\n' +
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
            param: {name: 'skaz_remote_group', type: 'title'},
            field: {name: 'Пульт'}
        });
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: 'skaz_remote_fix', type: 'trigger', default: true},
            field: {name: 'Исправление кнопок пульта', description: 'Навигация по кнопкам плеера и перемотка на таймлайне. Изменение применяется сразу.'}
        });
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: preference, type: 'trigger', default: false},
            field: {
                name: 'Диагностика пульта',
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

/* Stream diagnostics. Bounded probes go only to media URLs found in the stream; no telemetry. */
(function () {
    'use strict';
    if (window.skazStreamDiagnostics) return;
    var state = {version: '0.20', active: false, completed: false, startedAt: 0, stage: '', error: '', host: '-', format: '-', lastTime: null, advances: 0};
    window.skazStreamDiagnostics = state;
    var box = null, timer = null, preference = 'skaz_stream_loading_debug';

    var generation = 0, resourceStart = 0, observer = null;
    var lines = [], requests = [], seen = {}, first = {}, manifests = [], linked = {};
    function elapsed() { return ((Date.now() - state.startedAt) / 1000).toFixed(1); }
    function note(text) {
        if (!state.active || !enabled()) return;
        lines.push(elapsed() + ' с: ' + text);
        if (lines.length > 6) lines.shift();
    }
    var mediaDetails = [];
    function inspectMP4(buffer, label) {
        if (!buffer || !buffer.byteLength) return;
        var view = new DataView(buffer), report = [], count = 0;
        function u32(p) { return view.getUint32(p); }
        function four(p) {
            var s = ''; for (var j = 0; j < 4; j++) s += String.fromCharCode(view.getUint8(p + j));
            return /^[a-zA-Z0-9 ._-]{4}$/.test(s) ? s : '????';
        }
        function walk(start, end, depth, track) {
            if (depth > 8) return;
            for (var p = start; p + 8 <= end && count++ < 3000;) {
                var size = u32(p), type = four(p + 4), head = 8;
                if (size === 1) { if (p + 16 > end) return; size = u32(p + 8) * 4294967296 + u32(p + 12); head = 16; }
                if (!size) size = end - p;
                if (size < head || size > end - p) return;
                var q = p + head, stop = p + size;
                if (type === 'trak' || type === 'traf') {
                    var info = {}; walk(q, stop, depth + 1, info);
                    var parts = [];
                    ['id','handler','codec','scale','tfdt','samples'].forEach(function (k) { if (info[k] !== undefined) parts.push(k + '=' + info[k]); });
                    if (parts.length) report.push(parts.join(' '));
                } else if (/^(moov|mdia|minf|stbl|moof)$/.test(type)) walk(q, stop, depth + 1, track);
                else if (track) {
                    var v = q < stop ? view.getUint8(q) : 0;
                    if (type === 'tkhd' && q + (v === 1 ? 24 : 16) <= stop) track.id = u32(q + (v === 1 ? 20 : 12));
                    if (type === 'mdhd' && q + (v === 1 ? 24 : 16) <= stop) track.scale = u32(q + (v === 1 ? 20 : 12));
                    if (type === 'hdlr' && q + 12 <= stop) track.handler = four(q + 8);
                    if (type === 'stsd' && q + 16 <= stop && u32(q + 4) > 0) track.codec = four(q + 12);
                    if (type === 'tfhd' && q + 8 <= stop) track.id = u32(q + 4);
                    if (type === 'tfdt' && q + (v === 1 ? 12 : 8) <= stop) {
                        var ticks = v === 1 ? u32(q + 4) * 4294967296 + u32(q + 8) : u32(q + 4);
                        track.tfdt = ticks <= 9007199254740991 ? ticks : 'слишком велико';
                    }
                    if (type === 'trun' && q + 8 <= stop) track.samples = (track.samples || 0) + u32(q + 4);
                }
                p = stop;
            }
        }
        try { walk(0, buffer.byteLength, 0, null); }
        catch (e) { report.push('неполные/неразобранные MP4-данные'); }
        mediaDetails.push(label + ': ' + (report.slice(0, 4).join('; ') || 'дорожки/метки не найдены в полученных данных'));
        if (mediaDetails.length > 2) mediaDetails.shift();
    }
    function backendText() {
        try {
            var v = Lampa.PlayerVideo && Lampa.PlayerVideo.video && Lampa.PlayerVideo.video();
            if (!v) return 'Плеер: объект ещё недоступен';
            var tag = String(v.tagName || 'обёртка').toLowerCase();
            var kind = tag === 'video' ? (String(v.currentSrc || v.src || '').indexOf('blob:') === 0 ? 'HTML5/MSE' : 'HTML5') : tag === 'object' && v.type === 'application/avplayer' ? 'AVPlay' : tag;
            var text = 'Плеер: ' + kind + ' | ready=' + v.readyState + ' network=' + v.networkState + '\n';
            text += 't=' + (typeof v.currentTime === 'number' ? v.currentTime.toFixed(1) : '?') + ' seeking=' + v.seeking + ' muted=' + v.muted + ' volume=' + v.volume;
            if (v.audioTracks) text += ' audioTracks=' + v.audioTracks.length;
            if (v.error) text += ' error=' + cleanError(v.error.code);
            return text;
        } catch (e) { return 'Плеер: состояние недоступно'; }
    }

    var probeQueue = [], probeSeen = {}, probeRequested = {}, probeLines = [], probeXhr = null, probeCount = 0, segmentQueued = false, initQueued = false;
    function queueProbe(url, kind, range) {
        if (kind !== 'M3U8' && kind !== 'Сегмент/медиа' && kind !== 'Init-сегмент') return;
        if (probeSeen[url] || probeQueue.length >= 3) return;
        if (kind === 'Init-сегмент') {
            if (initQueued) return;
            initQueued = true;
        } else if (kind === 'Сегмент/медиа') {
            if (segmentQueued) return;
            segmentQueued = true;
        } else if (probeQueue.some(function (item) { return item.kind === 'M3U8'; })) return;
        probeSeen[url] = true;
        probeQueue.push({url: url, kind: kind, range: range});
    }
    function probeNote(text) {
        probeLines.push(elapsed() + ' с: ' + text);
        if (probeLines.length > 6) probeLines.shift();
    }
    function cancelProbe() {
        if (probeXhr) { var xhr = probeXhr; probeXhr = null; xhr.abort(); }
    }
    function runProbe() {
        if (!enabled() || !state.active || state.completed) { cancelProbe(); return; }
        if (Date.now() - state.startedAt < 10000 || probeXhr || probeCount >= 4 || !probeQueue.length) return;
        var item = probeQueue.shift(), gen = generation, at = Date.now(), done = false;
        var xhr = new XMLHttpRequest(); probeXhr = xhr; probeCount++;
        probeRequested[item.url] = true;
        // Bypass the passive XHR observer: probes must remain clearly separate.
        xhr.__skazProbe = true;
        function finish(reason, inspect) {
            if (done) return;
            done = true;
            if (probeXhr === xhr) probeXhr = null;
            if (gen !== generation || !state.active || state.completed) return;
            var status = xhr.status || 0;
            probeNote(item.kind + ': ' + reason + ', ' + (status ? 'HTTP ' + status : 'статус скрыт: сеть/CORS/TLS') + ', ' + ((Date.now() - at) / 1000).toFixed(2) + ' с');
            if (inspect && status >= 200 && status < 300 && item.kind !== 'M3U8') {
                inspectMP4(xhr.response, item.kind);
                if (item.kind === 'Сегмент/медиа' && xhr.response) probeNote('Сегмент: средняя скорость ' + (xhr.response.byteLength * 8 / Math.max(1, Date.now() - at) / 1000).toFixed(2) + ' Мбит/с');
            }
            if (inspect && status >= 200 && status < 300 && item.kind === 'M3U8') {
                inspectManifest(xhr, {kind: 'M3U8'}, xhr.responseURL || item.url);
            }
        }
        try {
            xhr.open('GET', item.url, true);
            xhr.timeout = 15000;
            if (item.kind !== 'M3U8') { xhr.responseType = 'arraybuffer'; if (item.kind === 'Init-сегмент' || item.range) xhr.setRequestHeader('Range', item.range || 'bytes=0-65535'); }
            xhr.onprogress = function (event) {
                var limit = item.kind === 'M3U8' ? 1048576 : item.kind === 'Init-сегмент' ? 65536 : 8388608;
                if (event.loaded >= limit) {
                    finish(item.kind === 'M3U8' ? 'плейлист больше лимита' : 'достигнут лимит байтов; тест остановлен', false);
                    xhr.abort();
                }
            };
            xhr.onload = function () { finish(item.kind === 'M3U8' ? 'ответ получен' : 'получено ' + ((xhr.response && xhr.response.byteLength) || 0) + ' байт (только проверка загрузки)', true); };
            xhr.onerror = function () { finish('ошибка запроса', false); };
            xhr.ontimeout = function () { finish('тайм-аут 15 с', false); };
            xhr.onabort = function () { done = true; };
            probeNote('Проверяю ' + item.kind + '…');
            xhr.send();
        } catch (e) { finish('запрос недоступен', false); cancelProbe(); }
    }
    function inspectManifest(xhr, info, base) {
        if (!enabled()) return;
        var text;
        try {
            if (xhr.responseType && xhr.responseType !== 'text') {
                if (info.kind === 'M3U8') { manifests.push('M3U8: тело недоступно (бинарный ответ)'); if (manifests.length > 2) manifests.shift(); }
                return;
            }
            text = xhr.responseText;
        } catch (e) {
            if (info.kind === 'M3U8') { manifests.push('M3U8: чтение тела недоступно'); if (manifests.length > 2) manifests.shift(); }
            return;
        }
        if (typeof text !== 'string') return;
        var valid = /^\s*#EXTM3U(?:\s|$)/.test(text);
        if (!valid && info.kind !== 'M3U8') return;
        if (!valid) {
            manifests.push('M3U8: нет заголовка #EXTM3U; ' + (/^\s*</.test(text) ? 'HTML/XML' : /^\s*[\[{]/.test(text) ? 'JSON' : 'другой ответ') + ', символов ' + text.length);
        } else if (text.length > 1048576) {
            manifests.push('M3U8: более 1 МБ; разбор пропущен');
        } else {
            var rows = text.split(/\r?\n/), variants = 0, segments = 0, keys = 0, maps = 0, hosts = [], encrypted = false, codecs = [];
            function link(uri, kind, probe, range) {
                try {
                    var url;
                    if (window.URL) url = new URL(uri, base).href;
                    else {
                        var a = document.createElement('a'); a.href = base;
                        url = /^https?:\/\//i.test(uri) ? uri : /^\/\//.test(uri) ? a.protocol + uri :
                            uri.charAt(0) === '/' ? a.protocol + '//' + a.host + uri : base.split('?')[0].replace(/[^/]*$/, '') + uri;
                    }
                    var target = document.createElement('a'); target.href = url;
                    if (!/^https?:$/.test(target.protocol)) return;
                    if (hosts.indexOf(target.hostname) < 0) hosts.push(target.hostname);
                    if (Object.keys(linked).length < 2000) linked[url] = kind;
                    if (probe) queueProbe(url, kind, range);
                } catch (ignore) {}
            }
            var nextVariant = false;
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i].replace(/^\s+|\s+$/g, '');
                if (!row) continue;
                if (row.indexOf('#EXT-X-STREAM-INF:') === 0) {
                    variants++; nextVariant = true;
                    var codec = row.match(/(?:[:,])CODECS="([^"]+)"/);
                    if (codec && /^[a-zA-Z0-9., _-]{1,160}$/.test(codec[1]) && codecs.length < 3 && codecs.indexOf(codec[1]) < 0) codecs.push(codec[1]);
                }
                if (row.indexOf('#EXTINF:') === 0) segments++;
                if (/^#EXT-X-(SESSION-)?KEY:/.test(row) && !/METHOD=NONE(?:,|$)/.test(row)) { keys++; encrypted = true; }
                if (row.indexOf('#EXT-X-MAP:') === 0) maps++;
                var match = row.match(/(?:[:,])URI="([^"]+)"/);
                if (match) {
                    var isMap = row.indexOf('#EXT-X-MAP:') === 0;
                    var byteRange = row.match(/BYTERANGE="(\d+)(?:@(\d+))?"/);
                    var range = null, canProbe = isMap;
                    if (isMap && byteRange) {
                        if (byteRange[2] === undefined) { canProbe = false; probeNote('Init: не проверен — неявное смещение BYTERANGE'); }
                        else {
                            var offset = Number(byteRange[2]), length = Number(byteRange[1]);
                            canProbe = length > 0 && offset >= 0 && offset + length <= 9007199254740991;
                            range = 'bytes=' + offset + '-' + (offset + Math.min(length, 65536) - 1);
                        }
                    }
                    link(match[1], /KEY:/.test(row) ? 'Ключ' : isMap ? 'Init-сегмент' : 'M3U8', canProbe, range);
                }
                if (row.charAt(0) !== '#') { link(row, nextVariant ? 'M3U8' : 'Сегмент/медиа', true); nextVariant = false; }
            }
            manifests.push('M3U8: ' + (variants ? 'master, вариантов ' + variants : 'media, сегментов ' + segments) +
                ', шифрование ' + (encrypted ? 'да (' + keys + ')' : 'не указано') + ', init ' + maps +
                (variants ? '\nCODECS: ' + (codecs.join('; ') || 'не указаны') : '') +
                '\nСсылки → ' + (hosts.slice(0, 3).join(', ') || 'не найдены'));
        }
        while (manifests.length > 2) manifests.shift();
    }
    function identify(url) {
        try {
            var a = document.createElement('a'); a.href = String(url || '');
            var path = a.pathname || '';
            var kind = /\.m3u8$/i.test(path) ? 'M3U8' : /\.mpd$/i.test(path) ? 'MPD' :
                /\.(ts|m4s|aac|mp4|m4a)$/i.test(path) ? 'Сегмент/медиа' : '';
            kind = linked[a.href] || kind;
            if (!kind && a.hostname !== state.host) return null;
            return {label: (kind || 'Запрос') + ' ' + a.hostname, kind: kind || 'Запрос'};
        } catch (e) { return null; }
    }
    function resource(entry) {
        if (probeRequested[entry.name]) return;
        if (!state.active || !enabled() || entry.startTime < resourceStart) return;
        var info = identify(entry.name);
        if (!info) return;
        var key = entry.name + ':' + entry.startTime;
        if (seen[key]) return;
        seen[key] = true;
        var detail = info.label + ': ' + (entry.duration / 1000).toFixed(2) + ' с всего';
        if (entry.responseStart > 0 && entry.requestStart > 0) {
            detail += ', ответ ' + ((entry.responseStart - entry.requestStart) / 1000).toFixed(2) + ' с';
        } else detail += ', TTFB недоступен';
        if (entry.responseStatus) detail += ', HTTP ' + entry.responseStatus;
        if (!first[info.kind]) first[info.kind] = elapsed() + ' с';
        note(detail);
    }
    function pollNetwork() {
        if (!state.active || !enabled()) return;
        if (!observer && window.performance && performance.getEntriesByType) {
            var entries = performance.getEntriesByType('resource');
            for (var i = 0; i < entries.length; i++) resource(entries[i]);
        }
    }
    function networkText() {
        pollNetwork();
        var pending = [];
        for (var i = 0; i < requests.length; i++) {
            if (!requests[i].done) pending.push(requests[i].label + ' ' + ((Date.now() - requests[i].at) / 1000).toFixed(0) + ' с');
        }
        var text = pending.length ? 'Ожидание XHR: ' + pending.slice(-2).join('; ') : '';
        if (first.M3U8) text += '\nПервый M3U8 завершён: ' + first.M3U8;
        if (first['Сегмент/медиа']) text += '\nПервый сегмент/медиа завершён: ' + first['Сегмент/медиа'];
        if (!lines.length && !pending.length) text += '\nСетевых событий не видно: запросы могут идти внутри MSX/ТВ.';
        text += manifests.length ? '\n' + manifests.join('\n') : '\nТело M3U8 пока не прочитано.';
        text += '\n' + backendText() + (mediaDetails.length ? '\nMP4: ' + mediaDetails.join('\n') : '');
        text += probeLines.length ? '\nТЕСТ JS (отдельно от плеера):\n' + probeLines.join('\n') : '';
        return text + (lines.length ? '\n' + lines.join('\n') : '');
    }
    function installNetwork() {
        try {
            if (window.PerformanceObserver) {
                observer = new PerformanceObserver(function (list) {
                    var entries = list.getEntries();
                    for (var i = 0; i < entries.length; i++) resource(entries[i]);
                });
                observer.observe({entryTypes: ['resource']});
            }
        } catch (e) { observer = null; }
        // Observe existing XHRs only. No probes, changed headers or request retries.
        if (!window.XMLHttpRequest) return;
        var proto = XMLHttpRequest.prototype, open = proto.open, send = proto.send;
        proto.open = function (method, url) {
            var result = open.apply(this, arguments);
            this.__skazNetUrl = typeof url === 'string' ? url : '';
            return result;
        };
        proto.send = function () {
            var xhr = this;
            if (xhr.__skazProbe) return send.apply(xhr, arguments);
            var info = state.active && enabled() && identify(xhr.__skazNetUrl);
            if (!info || !xhr.addEventListener) return send.apply(xhr, arguments);
            var gen = generation, record = {label: info.label, at: Date.now(), done: false};
            requests.push(record);
            if (requests.length > 60) requests.shift();
            function finish(e) {
                if (record.done) return;
                record.done = true;
                ['load', 'error', 'timeout', 'abort'].forEach(function (name) { xhr.removeEventListener(name, finish); });
                if (gen !== generation || !state.active) return;
                if (e.type === 'load') {
                    try { inspectManifest(xhr, info, xhr.responseURL || xhr.__skazNetUrl); } catch (ignore) {}
                }
                var status = 0;
                try { status = xhr.status; } catch (ignore) {}
                note(record.label + ': ' + e.type + ', ' + (status ? 'HTTP ' + status : 'HTTP недоступен') + ', ' + ((Date.now() - record.at) / 1000).toFixed(2) + ' с');
            }
            ['load', 'error', 'timeout', 'abort'].forEach(function (name) { xhr.addEventListener(name, finish); });
            try { return send.apply(xhr, arguments); }
            catch (error) { finish({type: 'исключение send'}); throw error; }
        };
    }

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
        box.textContent = 'ПОТОК · DEBUG 0.20 · ' + seconds + ' с\n' +
            'Сервер: ' + state.host + ' | Формат: ' + state.format + '\n' +
            'Этап: ' + state.stage + '\n' +
            (window.skazHlsFallback && window.skazHlsFallback.status ? window.skazHlsFallback.status + '\n' : '') +
            (window.skazHlsMode && window.skazHlsMode.status ? window.skazHlsMode.status + '\n' : '') +
            (window.skazDirectHls && window.skazDirectHls.status ? window.skazDirectHls.status + '\n' : '') +
            (state.error ? 'Ошибка: ' + state.error : (seconds >= 30 ? 'Долгое ожидание. Причина пока не определена.' : 'Ожидаю начало воспроизведения…')) + '\n' + networkText();
    }
    function stop() {
        state.active = false;
        cancelProbe();
        clearInterval(timer); timer = null;
        removeBox();
    }
    var stableSince = 0, lastAdvanceAt = 0;
    function loadingVisible() {
        return !!document.querySelector('.player .video--load, .player.player--loading');
    }
    function tick() {
        runProbe();
        if (state.active && loadingVisible()) {
            stableSince = 0; state.advances = 0;
            if (state.completed) {
                state.completed = false;
                stage('Повторная буферизация');
            }
        }
        render();
    }
    function complete() {
        if (!state.active || state.completed || loadingVisible()) return;
        if (!stableSince || Date.now() - stableSince < 5000 || state.advances < 4) return;
        if (state.error) {
            note('Воспроизведение восстановлено; ошибка сохранена в журнале');
            state.error = '';
        }
        note('Воспроизведение стабильно не менее 5 с');
        state.lastReport = {seconds: elapsed(), host: state.host, events: lines.slice(0), first: first, manifests: manifests.slice(0), errors: (state.errorHistory || []).slice(0)};
        state.completed = true;
        cancelProbe();
        removeBox();
        // Keep monitoring buffering until the player is closed.
    }
    function begin(data) {
        stop();
        mediaDetails = [];
        probeQueue = []; probeSeen = {}; probeRequested = {}; probeLines = []; probeCount = 0; segmentQueued = false; initQueued = false;
        generation++; lines = []; requests = []; seen = {}; first = {}; manifests = []; linked = {};
        resourceStart = window.performance && performance.now ? performance.now() : 0;
        state.active = true; state.completed = false; state.startedAt = Date.now();
        state.stage = 'Ссылка передана плееру'; state.error = ''; state.errorHistory = [];
        state.lastTime = null; state.advances = 0; stableSince = 0; lastAdvanceAt = 0;
        source(data);
        render(); timer = setInterval(tick, 500);
    }
    function stage(text) {
        if (!state.active) return;
        state.stage = text;
        note(text);
        render();
    }
    function start() {
        if (state.started || !window.Lampa || !Lampa.Player) return;
        state.started = true;
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: 'skaz_player_group', type: 'title'},
            field: {name: 'Плеер'}
        });
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: preference, type: 'trigger', default: true},
            field: {name: 'Диагностика загрузки потока', description: 'Показывать при запуске видео и скрывать после начала воспроизведения. При ошибке окно остаётся до выхода из плеера.'},
            onChange: function () { setTimeout(render, 0); }
        });
        installNetwork();
        Lampa.Player.listener.follow('start', begin);
        Lampa.Player.listener.follow('destroy', stop);
        Lampa.Player.listener.follow('external', stop);
        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
            var video = Lampa.PlayerVideo.listener;
            video.follow('progress', function (e) {
                if (state.active && e && e.down != null) state.stage = 'Буферизация: ' + cleanError(e.down);
            });
            video.follow('loadeddata', function () { stage('Данные видео получены'); });
            video.follow('canplay', function () { stage('Плеер готов; ожидаю воспроизведение'); });
            video.follow('error', function (e) {
                if (!state.active) return;
                state.completed = false; stableSince = 0;
                state.error = cleanError(e && (e.error || e.message));
                state.errorHistory = state.errorHistory || [];
                state.errorHistory.push({seconds: elapsed(), message: state.error, fatal: !!(e && e.fatal)});
                if (state.errorHistory.length > 10) state.errorHistory.shift();
                note('Ошибка: ' + state.error);
                stage(e && e.fatal ? 'Ошибка запуска' : 'Ошибка; ожидаю повторную попытку');
            });
            // A play command or canplay does not prove that video has started.
            // Require sustained forward progress without the Lampa loading indicator.
            video.follow('timeupdate', function (e) {
                if (!state.active || !e || typeof e.current !== 'number' || !isFinite(e.current)) return;
                if (state.lastTime !== null) {
                    var delta = e.current - state.lastTime;
                    if (delta > 0 && delta < 3 && !loadingVisible()) {
                        if (!stableSince || Date.now() - lastAdvanceAt > 3000) { stableSince = Date.now(); state.advances = 0; }
                        lastAdvanceAt = Date.now(); state.advances++;
                    } else if (delta !== 0 || loadingVisible()) { state.advances = 0; stableSince = 0; }
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
            if (root && root.contains(e.target)) stage('Сигнал playing; проверяю стабильное воспроизведение');
        }, true);
    }
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();


/* Opt-out experiment: flatten a single-variant VK master before player loading. */
(function () {
    'use strict';
    if (window.skazDirectHls) return;
    var api = {status: '', version: '0.20'};
    window.skazDirectHls = api;
    var pending = null, serial = 0, preference = 'skaz_direct_vk_hls';
    function cancel() {
        serial++;
        if (pending) { var xhr = pending; pending = null; xhr.abort(); }
    }
    function child(text, base) {
        if (!/^\s*#EXTM3U(?:\s|$)/.test(text) || text.length > 1048576) return null;
        // Preserve external audio/subtitles, session keys and variable substitution.
        if (/#EXT-X-(MEDIA:|SESSION-KEY:|DEFINE:)/.test(text)) return null;
        var lines = text.split(/\r?\n/), urls = [], want = false, count = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\s+|\s+$/g, '');
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) { count++; want = true; }
            else if (line && line.charAt(0) !== '#') {
                if (want) urls.push(line);
                want = false;
            }
        }
        if (count !== 1 || urls.length !== 1 || want) return null;
        try {
            var result = new URL(urls[0], base);
            if (result.protocol !== 'https:' && result.protocol !== 'http:') return null;
            if (result.href === base) return null;
            return result.href;
        } catch (e) { return null; }
    }
    function start() {
        if (api.started || !Lampa.PlayerVideo || typeof Lampa.PlayerVideo.url !== 'function') return;
        api.started = true;
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: preference, type: 'trigger', default: false},
            field: {name: 'VK: прямой запуск HLS', description: 'Эксперимент: запуск единственного варианта напрямую. Выключите для сравнения с обычным запуском.'}
        });
        var original = Lampa.PlayerVideo.url;
        Lampa.PlayerVideo.url = function (src) {
            cancel(); api.status = '';
            var value = Lampa.Storage.get(preference, false), url;
            try { url = new URL(src); } catch (e) {}
            if (!(value === true || value === 'true' || value === 1 || value === '1') || !url ||
                !/(^|\.)vkvideo\.cloud$/i.test(url.hostname) || !/\.m3u8$/i.test(url.pathname)) return original.apply(this, arguments);
            var self = this, args = Array.prototype.slice.call(arguments), id = serial, finished = false;
            var xhr = new XMLHttpRequest(); pending = xhr; xhr.__skazProbe = true;
            api.status = 'VK: проверяю основной плейлист';
            function finish(replacement) {
                if (finished || id !== serial) return;
                finished = true; pending = null;
                if (replacement) { args[0] = replacement; api.status = 'VK: прямой вложенный M3U8'; }
                else api.status = 'VK: обычный запуск (подмена не применена)';
                original.apply(self, args);
            }
            try {
                xhr.open('GET', src, true); xhr.timeout = 5000;
                xhr.onload = function () {
                    var replacement = null;
                    try { if (xhr.status >= 200 && xhr.status < 300) replacement = child(xhr.responseText, xhr.responseURL || src); } catch (e) {}
                    finish(replacement);
                };
                xhr.onerror = xhr.ontimeout = function () { finish(null); };
                xhr.onprogress = function (e) { if (e.loaded > 1048576) { xhr.abort(); finish(null); } };
                xhr.send();
            } catch (e) { xhr.abort(); finish(null); }
        };
        Lampa.Player.listener.follow('destroy', cancel);
        Lampa.Player.listener.follow('external', cancel);
        Lampa.Player.listener.follow('start', function () { cancel(); api.status = ''; });
    }
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();

/* Select Lampa's built-in HLS.js backend only for VK streams. */
(function () {
    'use strict';
    if (window.skazHlsMode) return;
    var api = {status: '', version: '0.20'}, selected = null, oldValue, hadValue = false;
    window.skazHlsMode = api;
    function restore() {
        if (selected && selected.hls_type === 'hlsjs') {
            if (hadValue) selected.hls_type = oldValue;
            else delete selected.hls_type;
        }
        selected = null;
    }
    function start() {
        if (api.started) return;
        api.started = true;
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: 'skaz_vk_hlsjs', type: 'trigger', default: true},
            field: {name: 'VK: использовать HLS.js', description: 'Пробовать штатный HLS.js вместо нативного HLS. Применяется при следующем запуске видео.'}
        });
        Lampa.Player.listener.follow('start', function (data) {
            restore(); api.status = '';
            var value = Lampa.Storage.get('skaz_vk_hlsjs', true), url;
            if (!(value === true || value === 'true' || value === 1 || value === '1')) return;
            try { url = new URL(data.url); } catch (e) { return; }
            if (!/(^|\.)vkvideo\.cloud$/i.test(url.hostname) || !/\.m3u8$/i.test(url.pathname)) return;
            try {
                if (!window.Hls || !Hls.isSupported()) { api.status = 'VK HLS.js: недоступен; обычный запуск'; return; }
                selected = data; hadValue = Object.prototype.hasOwnProperty.call(data, 'hls_type'); oldValue = data.hls_type;
                data.hls_type = 'hlsjs';
                api.status = 'VK: запрошен HLS.js ' + String(Hls.version || '');
            } catch (e) { restore(); api.status = 'VK HLS.js: проверка не удалась'; }
        });
        Lampa.Player.listener.follow('destroy', restore);
        Lampa.Player.listener.follow('external', restore);
    }
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();

/* One automatic HLS.js retry after 15 seconds without playback progress. */
(function () {
    'use strict';
    if (window.skazHlsFallback) return;
    var api = {version: '0.20', status: ''};
    window.skazHlsFallback = api;
    var timer = null, current = null, last = null, advances = 0, token = 0;
    function enabled() {
        var value = Lampa.Storage.get('skaz_auto_hlsjs', true);
        return value === true || value === 'true' || value === 1 || value === '1';
    }
    function cancel() { token++; clearTimeout(timer); timer = null; current = null; }
    function media() {
        try { return Lampa.PlayerVideo.video(); } catch (e) { return null; }
    }
    function alreadyMse(data) {
        var v = media();
        return data.hls_type === 'hlsjs' || !!(v && String(v.currentSrc || v.src || '').indexOf('blob:') === 0);
    }
    function begin(data) {
        cancel(); api.status = ''; last = null; advances = 0;
        if (data && data.__skazHlsRetried) { api.status = 'Авто: повтор через HLS.js выполнен'; return; }
        if (!enabled()) { api.status = 'Авто: выключено в настройках'; return; }
        if (!data || typeof data.url !== 'string') { api.status = 'Авто: нет строкового URL потока'; return; }
        var path;
        try { var link = document.createElement('a'); link.href = data.url; path = link.pathname; } catch (e) {}
        if (!/\.m3u8$/i.test(path || '')) { api.status = 'Авто: URL не распознан как M3U8'; return; }
        current = data;
        api.status = 'Авто: ожидаю старт, повтор через 15 с';
        var id = token;
        timer = setTimeout(function () {
            timer = null;
            if (id !== token || !current || !enabled()) return;
            // Do not restart another source, an external player or an existing MSE session.
            var active = Lampa.Player.playdata && Lampa.Player.playdata();
            if (active && active !== data && active.url !== data.url) { api.status = 'Авто: отменено — источник изменился'; cancel(); return; }
            if (alreadyMse(data)) { api.status = 'Авто: HLS.js/MSE уже используется'; cancel(); return; }
            if (!window.Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) { api.status = 'Авто: HLS.js не поддерживается'; cancel(); return; }
            var copy = {};
            Object.keys(data).forEach(function (key) { copy[key] = data[key]; });
            copy.hls_type = 'hlsjs'; copy.__skazHlsRetried = true;
            cancel();
            api.status = 'Авто: 15 с без воспроизведения → HLS.js';
            Lampa.Noty.show('Видео не запустилось за 15 с. Пробую HLS.js');
            // Dispose of the old media backend before Lampa starts its replacement.
            if (Lampa.PlayerVideo && Lampa.PlayerVideo.destroy) Lampa.PlayerVideo.destroy(true);
            if (data.iptv_player && typeof Lampa.Player.iptv === 'function') Lampa.Player.iptv(copy);
            else Lampa.Player.play(copy);
        }, 15000);
    }
    function progress(e) {
        if (!current || !e || typeof e.current !== 'number' || !isFinite(e.current)) return;
        var v = media();
        var loading = document.querySelector('.player .video--load, .player.player--loading');
        if (last !== null) {
            var delta = e.current - last;
            if (delta > 0 && delta < 3 && !loading && !(v && (v.seeking || v.paused))) advances++;
            else if (delta !== 0 || loading) advances = 0;
        }
        last = e.current;
        if (advances >= 2) { api.status = 'Авто: воспроизведение началось, повтор отменён'; cancel(); }
    }
    function start() {
        if (api.started) return;
        api.started = true;
        Lampa.SettingsApi.addParam({
            component: 'skaz_remote_control',
            param: {name: 'skaz_auto_hlsjs', type: 'trigger', default: true},
            field: {name: 'HLS.js после 15 секунд ожидания', description: 'Одна повторная попытка для M3U8 любого источника, если воспроизведение не началось. Не переключает уже работающий поток.'},
            onChange: function () { setTimeout(function () { if (!enabled()) cancel(); }, 0); }
        });
        Lampa.Player.listener.follow('start', begin);
        Lampa.Player.listener.follow('create', function () { if (current) api.status = 'Авто: отменено — новый запуск'; cancel(); });
        Lampa.Player.listener.follow('destroy', cancel);
        Lampa.Player.listener.follow('external', cancel);
        if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
            Lampa.PlayerVideo.listener.follow('timeupdate', progress);
            // Startup backends emit pause before any frame. This is not a user cancellation.
            // A real pause after playback is already covered by progress cancellation.
        }
    }
    if (window.Lampa && window.appready) start();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') start(); });
})();
