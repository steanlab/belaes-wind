/*
 * Куда дует ветер от БелАЭС? Учебная симуляция.
 * Интерфейс и данные. Сама модель (поле ветра, траектория по часам, устойчивость, полоса облака)
 * находится в model.js. Подробности и ограничения: README.md
 */
(function () {
    'use strict';

    const IN_NODE = typeof module !== 'undefined' && module.exports;
    const I18N = IN_NODE ? require('./i18n.js') : window.AstravyetsI18n;
    const M = IN_NODE ? require('./model.js') : window.BelaesModel;
    const { normalizeAngle, windToBearing, destinationPoint, distanceBetween, NPP_COORDS } = M;

    // ===== Настройки =====
    const APP_VERSION = '2.1.0';
    const WIND_API_URL = 'https://api.open-meteo.com/v1/forecast';
    const WIND_FETCH_TIMEOUT_MS = 10 * 1000;
    const FIELD_REFRESH_MS = { static: 15 * 60 * 1000, direct: 60 * 60 * 1000, single: 5 * 60 * 1000 };   // как часто обновлять поле ветра
    const FIELD_RETRY_MS = 2 * 60 * 1000;       // повтор после сбоя
    const AGO_OPTIONS = [0, 1, 2, 3, 6, 12, 18, 24];   // «авария была N часов назад»
    const MAX_AGO_HOURS = 24;
    const SIMULATION_SPEED_MULTIPLIER = 3600;   // при скорости x1: 1 секунда реального времени = 1 час модельного
    const SPEEDS = [0.5, 1, 2, 4];
    const DEFAULT_SPEED_INDEX = 1;
    const UPDATE_INTERVAL_MS = 100;
    const FOLLOW_EVERY_TICKS = 10;              // как часто проверять, не вышло ли облако за край карты
    const MAX_SIMULATION_HOURS = 48;            // после этого симуляция останавливается
    const OPACITY_START = 0.5;                  // условная прозрачность: плотность облака с расстоянием падает
    const OPACITY_END = 0.12;
    const CUSTOM_SPEED_MIN = 0.5;
    const CUSTOM_SPEED_MAX = 25;
    const LANG_STORAGE_KEY = 'belaes-wind-lang';
    const LANG_CODES = I18N.LANGS.map((l) => l.code);

    const CITIES = [
        { id: 'vilnius', coords: [54.687, 25.279], names: { ru: 'Вильнюс', be: 'Вільнюс', en: 'Vilnius', pl: 'Wilno', lt: 'Vilnius' } },
        { id: 'minsk', coords: [53.904, 27.561], names: { ru: 'Минск', be: 'Мінск', en: 'Minsk', pl: 'Mińsk', lt: 'Minskas' } },
        { id: 'chisinau', coords: [47.026, 28.858], names: { ru: 'Кишинев', be: 'Кішынёў', en: 'Chișinău', pl: 'Kiszyniów', lt: 'Kišiniovas' } },
        { id: 'swinoujscie', coords: [53.914, 14.249], names: { ru: 'Свиноуйсьце', be: 'Свіноуйсьце', en: 'Świnoujście', pl: 'Świnoujście', lt: 'Svinoustė' } },
        { id: 'sofia', coords: [42.698, 23.322], names: { ru: 'София', be: 'Сафія', en: 'Sofia', pl: 'Sofia', lt: 'Sofija' } },
        { id: 'krakow', coords: [50.064, 19.945], names: { ru: 'Краков', be: 'Кракаў', en: 'Kraków', pl: 'Kraków', lt: 'Krokuva' } },
        { id: 'kharkiv', coords: [49.922, 36.321], names: { ru: 'Харьков', be: 'Харкаў', en: 'Kharkiv', pl: 'Charków', lt: 'Charkivas' } },
        { id: 'warsaw', coords: [52.229, 21.012], names: { ru: 'Варшава', be: 'Варшава', en: 'Warsaw', pl: 'Warszawa', lt: 'Varšuva' } },
        { id: 'wroclaw', coords: [51.107, 17.038], names: { ru: 'Вроцлав', be: 'Вроцлаў', en: 'Wrocław', pl: 'Wrocław', lt: 'Vroclavas' } },
        { id: 'bialystok', coords: [53.132, 23.169], names: { ru: 'Белосток', be: 'Беласток', en: 'Białystok', pl: 'Białystok', lt: 'Balstogė' } },
        { id: 'liepaja', coords: [56.511, 21.013], names: { ru: 'Лиепая', be: 'Ліепая', en: 'Liepāja', pl: 'Lipawa', lt: 'Liepoja' } },
        { id: 'palanga', coords: [55.918, 21.069], names: { ru: 'Паланга', be: 'Паланга', en: 'Palanga', pl: 'Połąga', lt: 'Palanga' } },
        { id: 'ventspils', coords: [57.319, 21.564], names: { ru: 'Вентспилс', be: 'Вентспілс', en: 'Ventspils', pl: 'Windawa', lt: 'Ventspilis' } },
        { id: 'tallinn', coords: [59.437, 24.754], names: { ru: 'Таллин', be: 'Талін', en: 'Tallinn', pl: 'Tallin', lt: 'Talinas' } },
        { id: 'riga', coords: [56.949, 24.105], names: { ru: 'Рига', be: 'Рыга', en: 'Riga', pl: 'Ryga', lt: 'Ryga' } },
        { id: 'kaunas', coords: [54.898, 23.903], names: { ru: 'Каунас', be: 'Каўнас', en: 'Kaunas', pl: 'Kowno', lt: 'Kaunas' } },
        { id: 'asveya', coords: [56.015, 28.115], names: { ru: 'Освея', be: 'Асвея', en: 'Asveya', pl: 'Asweja', lt: 'Asvėja' } },
        { id: 'kyiv', coords: [50.45, 30.523], names: { ru: 'Киев', be: 'Кіеў', en: 'Kyiv', pl: 'Kijów', lt: 'Kijevas' } },
        { id: 'navahrudak', coords: [53.596, 25.827], names: { ru: 'Новогрудок', be: 'Навагрудак', en: 'Navahrudak', pl: 'Nowogródek', lt: 'Naugardukas' } },
        { id: 'zhodzina', coords: [54.093, 28.34], names: { ru: 'Жодино', be: 'Жодзіна', en: 'Zhodzina', pl: 'Żodzino', lt: 'Žodinas' } },
        { id: 'hrodna', coords: [53.669, 23.826], names: { ru: 'Гродно', be: 'Горадня', en: 'Hrodna', pl: 'Grodno', lt: 'Gardinas' } },
        { id: 'pinsk', coords: [52.115, 26.103], names: { ru: 'Пинск', be: 'Пінск', en: 'Pinsk', pl: 'Pińsk', lt: 'Pinskas' } },
        { id: 'saint-petersburg', coords: [59.934, 30.335], names: { ru: 'Санкт-Петербург', be: 'Санкт-Пецярбург', en: 'Saint Petersburg', pl: 'Petersburg', lt: 'Sankt Peterburgas' } },
        { id: 'vitebsk', coords: [55.19, 30.205], names: { ru: 'Витебск', be: 'Віцебск', en: 'Vitebsk', pl: 'Witebsk', lt: 'Vitebskas' } },
        { id: 'eisenach', coords: [50.978, 10.318], names: { ru: 'Эйзенах', be: 'Айзенах', en: 'Eisenach', pl: 'Eisenach', lt: 'Eizenachas' } },
        { id: 'tatariv', coords: [48.349, 24.577], names: { ru: 'Татаров', be: 'Татараў', en: 'Tatariv', pl: 'Tatarów', lt: 'Tatariv' } },
        { id: 'elblag', coords: [54.156, 19.402], names: { ru: 'Эльблонг', be: 'Эльблонг', en: 'Elbląg', pl: 'Elbląg', lt: 'Elblągas' } },
        { id: 'homel', coords: [52.424, 31.014], names: { ru: 'Гомель', be: 'Гомель', en: 'Homel', pl: 'Homel', lt: 'Gomelis' } },
        { id: 'vyborg', coords: [60.709, 28.747], names: { ru: 'Выборг', be: 'Выбарг', en: 'Vyborg', pl: 'Wyborg', lt: 'Viborgas' } }
    ];

    // ===== Геометрия, разбор данных, форматирование (чистые функции, без DOM и Leaflet) =====

    // Индекс из 8 сторон света: 0 север, 1 северо-восток, 2 восток и так далее.
    function compassIndex(deg) {
        return Math.round(normalizeAngle(deg) / 45) % 8;
    }

    // Новый накопленный угол стрелки, чтобы она поворачивалась по короткой дуге, а не на 340 градусов.
    function shortestAngleTarget(current, target) {
        const delta = ((normalizeAngle(target) - normalizeAngle(current) + 540) % 360) - 180;
        return current + delta;
    }

    function plumeOpacity(elapsedHours) {
        const k = Math.min(1, Math.max(0, elapsedHours / MAX_SIMULATION_HOURS));
        return OPACITY_START + (OPACITY_END - OPACITY_START) * k;
    }

    // Границы набора точек [широта, долгота].
    function boundsOf(points) {
        let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
        for (const p of points) {
            if (p[0] < south) south = p[0];
            if (p[0] > north) north = p[0];
            if (p[1] < west) west = p[1];
            if (p[1] > east) east = p[1];
        }
        return { south, west, north, east };
    }

    function boundsContain(outer, inner) {
        return inner.south >= outer.south && inner.north <= outer.north && inner.west >= outer.west && inner.east <= outer.east;
    }

    // Сжимает границы на доли высоты и ширины (нужно, чтобы учесть панели поверх карты).
    function shrinkBounds(b, fr) {
        const h = b.north - b.south;
        const w = b.east - b.west;
        return {
            north: b.north - h * (fr.top || 0),
            south: b.south + h * (fr.bottom || 0),
            west: b.west + w * (fr.left || 0),
            east: b.east - w * (fr.right || 0)
        };
    }

    function formatHM(seconds, lang) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return I18N.t(lang, 'timeHM', { h, m });
    }

    function formatArrival(seconds, lang) {
        return '~ ' + formatHM(seconds, lang || 'ru');
    }

    function formatClock(seconds, lang) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return I18N.t(lang || 'ru', 'clockFmt', { h, m });
    }

    // Ответ Open-Meteo: current.wind_speed_10m (м/с) и current.wind_direction_10m (откуда дует, градусы).
    function parseWindResponse(json) {
        const current = json && json.current;
        if (!current) throw new Error('В ответе нет блока current');
        const speed = current.wind_speed_10m;
        const fromDeg = current.wind_direction_10m;
        if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) throw new Error('Нет скорости ветра');
        if (typeof fromDeg !== 'number' || !Number.isFinite(fromDeg)) throw new Error('Нет направления ветра');
        const time = current.time ? new Date(current.time + 'Z') : null;   // время приходит в GMT
        return { speed, fromDeg: normalizeAngle(fromDeg), time: time && !isNaN(time) ? time : null };
    }

    function buildWindUrl() {
        const params = new URLSearchParams({
            latitude: String(NPP_COORDS[0]),
            longitude: String(NPP_COORDS[1]),
            current: 'wind_speed_10m,wind_direction_10m',
            wind_speed_unit: 'ms',
            timezone: 'GMT'
        });
        return `${WIND_API_URL}?${params.toString()}`;
    }

    // Параметры ссылки: lang, wd (откуда дует, градусы) и ws (скорость, м/с) для своего ветра,
    // at (момент аварии, UTC, например 2026-11-24T14:07Z), city (id города для блока «Где я»),
    // run=1 (сразу запустить). Момент at принимается, если он не в будущем и не старше суток.
    function parseShareParams(search, nowMs) {
        const p = new URLSearchParams(search || '');
        const now = nowMs === undefined ? Date.now() : nowMs;
        const out = { lang: null, custom: null, run: p.get('run') === '1', atMs: null, atInvalid: false, city: null };
        const lang = p.get('lang');
        if (lang && LANG_CODES.includes(lang)) out.lang = lang;
        const wdRaw = p.get('wd');
        const wsRaw = p.get('ws');
        if (wdRaw !== null && wsRaw !== null && wdRaw.trim() !== '' && wsRaw.trim() !== '') {
            const wd = Number(wdRaw);
            const ws = Number(wsRaw);
            if (Number.isFinite(wd) && Number.isFinite(ws) && wd >= 0 && wd <= 360 && ws >= CUSTOM_SPEED_MIN && ws <= CUSTOM_SPEED_MAX) {
                out.custom = { deg: normalizeAngle(Math.round(wd)), speed: Math.round(ws * 10) / 10 };
            }
        }
        const atRaw = p.get('at');
        if (atRaw && !out.custom) {
            const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(atRaw) ? Date.parse(atRaw) : NaN;
            if (Number.isFinite(at) && at <= now + 60000 && now - at <= (MAX_AGO_HOURS * 3600 + 60) * 1000) out.atMs = Math.min(at, now);
            else out.atInvalid = true;
        }
        const city = p.get('city');
        if (city && CITIES.some((c) => c.id === city)) out.city = city;
        return out;
    }

    function buildShareUrl(base, opts) {
        const url = new URL(base);
        url.search = '';
        url.hash = '';
        url.searchParams.set('lang', opts.lang);
        if (opts.custom) {
            url.searchParams.set('wd', String(opts.custom.deg));
            url.searchParams.set('ws', String(opts.custom.speed));
        } else if (opts.atMs) {
            url.searchParams.set('at', new Date(opts.atMs).toISOString().slice(0, 16) + 'Z');
        }
        if (opts.city) url.searchParams.set('city', opts.city);
        if (opts.run) url.searchParams.set('run', '1');
        return url.toString();
    }

    function pickLanguage(opts) {
        if (opts.urlLang && LANG_CODES.includes(opts.urlLang)) return opts.urlLang;
        if (opts.stored && LANG_CODES.includes(opts.stored)) return opts.stored;
        const list = opts.navLangs || [];
        for (const tag of list) {
            const base = String(tag).toLowerCase().split('-')[0];
            if (LANG_CODES.includes(base)) return base;
        }
        return list.length ? 'en' : 'ru';
    }

    // Строки списка городов: сначала накрытые (по времени прибытия), потом остальные (по расстоянию).
    function sortCityRows(cities, arrived) {
        const rows = cities.map((c) => ({
            id: c.id,
            coords: c.coords,
            names: c.names,
            distanceM: distanceBetween(NPP_COORDS, c.coords),
            arrivalSeconds: Object.prototype.hasOwnProperty.call(arrived, c.id) ? arrived[c.id] : null
        }));
        rows.sort((a, b) => {
            if (a.arrivalSeconds !== null && b.arrivalSeconds !== null) return a.arrivalSeconds - b.arrivalSeconds;
            if (a.arrivalSeconds !== null) return -1;
            if (b.arrivalSeconds !== null) return 1;
            return a.distanceM - b.distanceM;
        });
        return rows;
    }

    // Рисует итоговую картинку на 2D-контексте (без карты-подложки: не нужны тайлы и CORS).
    // d: { title, subtitle, windLine, clockLine, footer, nppLabel, npp:[lat,lng],
    //      polygons:[{points, fill, stroke}], cities:[{name, coords, label|null}] }
    function drawResultImage(ctx, w, h, d) {
        const bg = ctx.createLinearGradient ? ctx.createLinearGradient(0, 0, 0, h) : '#0b1d3a';
        if (bg && bg.addColorStop) { bg.addColorStop(0, '#0b1d3a'); bg.addColorStop(1, '#17325f'); }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(d.title, 40, 28);
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#ffc107';
        ctx.fillText(d.subtitle, 40, 78);
        ctx.fillStyle = '#e6e6e6';
        ctx.font = '22px sans-serif';
        ctx.fillText(d.windLine, 40, 112);
        ctx.textAlign = 'right';
        ctx.fillText(d.clockLine, w - 40, 112);
        ctx.textAlign = 'left';

        const area = { x: 40, y: 152, w: w - 80, h: h - 152 - 56 };
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(area.x, area.y, area.w, area.h);

        const pts = [d.npp];
        d.polygons.forEach((p) => p.points.forEach((q) => pts.push(q)));
        d.cities.forEach((c) => { if (c.label) pts.push(c.coords); });
        const b = boundsOf(pts);
        const midLat = (b.north + b.south) / 2;
        const lonScale = Math.cos(midLat * Math.PI / 180);
        const spanX = Math.max(1e-6, (b.east - b.west) * lonScale);
        const spanY = Math.max(1e-6, b.north - b.south);
        const scale = Math.min((area.w * 0.86) / spanX, (area.h * 0.86) / spanY);
        const offX = area.x + (area.w - spanX * scale) / 2;
        const offY = area.y + (area.h - spanY * scale) / 2;
        const project = (p) => [offX + (p[1] - b.west) * lonScale * scale, offY + (b.north - p[0]) * scale];

        d.polygons.forEach((poly) => {
            ctx.beginPath();
            poly.points.forEach((p, i) => {
                const q = project(p);
                if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
            });
            ctx.closePath();
            ctx.fillStyle = poly.fill;
            ctx.fill();
            if (poly.stroke) { ctx.strokeStyle = poly.stroke; ctx.lineWidth = 2; ctx.stroke(); }
        });

        ctx.font = '18px sans-serif';
        const placed = [];
        d.cities.forEach((c) => {
            const q = project(c.coords);
            const hit = !!c.label;
            ctx.beginPath();
            ctx.arc(q[0], q[1], hit ? 5 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = hit ? '#ff9800' : 'rgba(255,255,255,0.45)';
            ctx.fill();
            if (!hit) return;
            const text = c.label;
            const width = ctx.measureText ? ctx.measureText(text).width : text.length * 9;
            const rect = { x: q[0] + 8, y: q[1] - 10, w: width, h: 20 };
            const overlaps = placed.some((r) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y);
            if (overlaps) return;
            placed.push(rect);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(text, rect.x, rect.y);
        });

        const n = project(d.npp);
        ctx.beginPath();
        ctx.arc(n[0], n[1], 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#c82333';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(d.nppLabel, n[0] + 14, n[1] - 10);

        ctx.fillStyle = '#b8c4d9';
        ctx.font = '18px sans-serif';
        ctx.fillText(d.footer, 40, h - 36);
    }

    // ===== Приложение =====

    function initApp() {
        const $ = (id) => document.getElementById(id);
        const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
        const isMobile = () => mq('(max-width: 768px)');
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

        function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
        function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* хранилище недоступно */ } }

        const shareParams = parseShareParams(window.location.search);
        const state = {
            lang: pickLanguage({ urlLang: shareParams.lang, stored: storageGet(LANG_STORAGE_KEY), navLangs: navigator.languages || (navigator.language ? [navigator.language] : []) }),
            phase: 'loading',            // loading | ready | error | simulating | finished
            busy: false,
            mode: shareParams.custom ? 'custom' : 'current',
            custom: shareParams.custom || { deg: 270, speed: 5 },
            field: null,                 // поле ветра (сетка или одинаковый ветер)
            fieldInfo: null,             // { source: static | direct | single, ts, generatedMs }
            windData: null,              // ветер у площадки АЭС в момент аварии (для розы ветров)
            agoHours: 0,                 // авария была столько часов назад (выбор в списке)
            accidentAtMs: shareParams.atMs, // точный момент аварии из ссылки, иначе null
            preview: null,               // сценарий для блока «Где я» до запуска симуляции
            where: shareParams.city ? { kind: 'city', id: shareParams.city } : null,
            whereStatus: null,           // ключ временного сообщения: whereLocating, whereDenied, whereNoGeo
            notice: null,                // { key, params } временные сообщения
            sim: null,
            arrived: {},                 // id города -> секунды после аварии
            lastPolys: null,
            pointerAngle: 0,
            simStale: false,             // true, если после остановки пользователь уже меняет ветер или время аварии
            installEvent: null
        };

        const t = (key, params) => I18N.t(state.lang, key, params);
        const cityName = (c) => c.names[state.lang] || c.names.ru;
        const dirTo = (deg) => I18N.t(state.lang, 'dirTo')[compassIndex(windToBearing(deg))];
        const dirFrom = (deg) => I18N.t(state.lang, 'dirFrom')[compassIndex(deg)];
        const locale = () => (state.lang === 'be' ? 'be-BY' : state.lang);

        let map = null;
        let simulationInterval = null;
        let toastTimer = null;
        let loadingPromise = null;
        let youMarker = null;
        const cityMarkers = {};
        const plumeLayers = { center: null, outer: null };

        // --- Язык ---

        function applyStaticTexts() {
            document.documentElement.lang = state.lang;
            document.title = t('pageTitle');
            const desc = document.querySelector('meta[name="description"]');
            if (desc) desc.setAttribute('content', t('pageDesc'));
            document.querySelectorAll('[data-i18n]').forEach((el) => {
                const key = el.getAttribute('data-i18n');
                if (key.endsWith('Html')) el.innerHTML = t(key); else el.textContent = t(key);
            });
            document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))));
            document.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.getAttribute('data-i18n-title'))));
            const note = $('linksNote');
            if (note) note.hidden = !t('linksNote');
            const select = $('langSelect');
            if (select) select.value = state.lang;
            const version = $('appVersion');
            if (version) version.textContent = t('version', { v: APP_VERSION });
        }

        function setLanguage(lang) {
            if (!LANG_CODES.includes(lang)) return;
            state.lang = lang;
            storageSet(LANG_STORAGE_KEY, lang);
            applyStaticTexts();
            renderCitySelect();
            renderAll();
        }

        // --- Карта ---

        function initMap() {
            map = L.map('map', { zoomControl: false }).setView(NPP_COORDS, isMobile() ? 5 : 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
            L.control.zoom({ position: 'topleft' }).addTo(map);
            L.marker(NPP_COORDS, { icon: L.divIcon({ className: 'npp-icon', html: '☢️' }) }).addTo(map).bindPopup(t('npp'));

            CITIES.forEach((city) => {
                const marker = L.circleMarker(city.coords, cityStyle(false)).addTo(map);
                marker.bindPopup(cityName(city));
                marker.bindTooltip(cityName(city), { permanent: false, direction: 'top' });
                cityMarkers[city.id] = marker;
            });
        }

        function cityStyle(hit) {
            return hit
                ? { radius: 7, color: '#b71c1c', weight: 2, fillColor: '#ff9800', fillOpacity: 1 }
                : { radius: 4, color: '#0056b3', weight: 2, fillColor: '#ffffff', fillOpacity: 1 };
        }

        function refreshMarkerTexts() {
            CITIES.forEach((city) => {
                const marker = cityMarkers[city.id];
                if (!marker) return;
                const name = cityName(city);
                const hit = Object.prototype.hasOwnProperty.call(state.arrived, city.id);
                const text = hit ? `${name}: ${formatArrival(state.arrived[city.id], state.lang)}` : name;
                marker.setPopupContent(text);
                marker.setTooltipContent(text);
            });
            if (youMarker) youMarker.setTooltipContent(t('youAreHere'));
        }

        function setYouMarker(coords) {
            if (!map) return;
            if (youMarker) { map.removeLayer(youMarker); youMarker = null; }
            if (!coords) return;
            youMarker = L.circleMarker(coords, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1976d2', fillOpacity: 1 }).addTo(map);
            youMarker.bindTooltip(t('youAreHere'), { permanent: false, direction: 'top' });
        }

        function updatePlumeLayer(key, points, style) {
            if (!plumeLayers[key]) {
                plumeLayers[key] = L.polygon(points, style).addTo(map);
            } else {
                plumeLayers[key].setLatLngs(points);
                plumeLayers[key].setStyle(style);
            }
        }

        function resetSimulationVisuals() {
            Object.keys(plumeLayers).forEach((key) => {
                if (plumeLayers[key]) map.removeLayer(plumeLayers[key]);
                plumeLayers[key] = null;
            });
            CITIES.forEach((city) => {
                const marker = cityMarkers[city.id];
                if (marker) marker.setStyle(cityStyle(false));
            });
            state.arrived = {};
            state.lastPolys = null;
            refreshMarkerTexts();
            map.setView(NPP_COORDS, isMobile() ? 5 : 6);
        }

        // Отодвигает карту, если облако подошло к краю видимой области (только отдаляет, не приближает).
        function followPlume(polys, force) {
            const pts = [NPP_COORDS];
            polys.forEach((p) => p.forEach((q) => pts.push(q)));
            const need = boundsOf(pts);
            const view = map.getBounds();
            const viewB = { south: view.getSouth(), north: view.getNorth(), west: view.getWest(), east: view.getEast() };
            const dock = $('dock');
            const panel = $('infoPanel');
            const padBottom = (dock ? dock.offsetHeight : 120) + 20;
            const mapHeight = map.getSize ? map.getSize().y : window.innerHeight;
            const bottomFraction = Math.min(0.8, Math.max(0.3, padBottom / Math.max(mapHeight, 1)));
            const usable = shrinkBounds(viewB, { top: 0.12, right: isMobile() ? 0.05 : 0.3, bottom: bottomFraction, left: 0.05 });
            if (!force && boundsContain(usable, need)) return;
            const padRight = isMobile() || !panel ? 20 : panel.offsetWidth + 40;
            map.fitBounds([[need.south, need.west], [need.north, need.east]], {
                paddingTopLeft: [20, 70],
                paddingBottomRight: [padRight, padBottom],
                maxZoom: 7
            });
        }

        // --- Момент аварии, поле ветра, сценарий ---

        // Выбор времени аварии доступен только для прогноза по сетке. Для своего ветра и запасного режима авария всегда «сейчас».
        function accidentUsable() {
            return state.mode === 'current' && !(state.fieldInfo && state.fieldInfo.source === 'single');
        }

        function accidentStartMs() {
            if (!accidentUsable()) return Date.now();
            if (state.accidentAtMs) return Math.max(Date.now() - MAX_AGO_HOURS * 3600000, state.accidentAtMs);
            return Date.now() - state.agoHours * 3600000;
        }

        function agoDisplay() {
            return state.accidentAtMs ? clamp((Date.now() - state.accidentAtMs) / 3600000, 0, MAX_AGO_HOURS) : state.agoHours;
        }

        function wallClock(ms) {
            const d = new Date(ms);
            const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
            if (d.toDateString() === new Date().toDateString()) return time;
            return `${d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })} ${time}`;
        }

        function currentField() {
            if (state.mode === 'custom') return M.makeUniformField(state.custom.speed, state.custom.deg);
            return state.field;
        }

        function makeScenario(startMs) {
            const field = currentField();
            return field ? M.buildScenario(field, startMs, CITIES) : null;
        }

        function rebuildPreview() {
            state.preview = makeScenario(accidentStartMs());
            renderWhere();
        }

        function deriveWindData() {
            if (!state.field || !state.fieldInfo) { state.windData = null; return; }
            const w = M.windAt(state.field, NPP_COORDS[0], NPP_COORDS[1], accidentStartMs());
            state.windData = { speed: w.speed, fromDeg: w.fromDeg, time: state.fieldInfo.generatedMs ? new Date(state.fieldInfo.generatedMs) : null };
        }

        // Возвращает true, если данные обновлены. strict: при сбое без прежних данных всегда переходить в состояние error.
        function loadField(strict) {
            if (loadingPromise) return loadingPromise;
            loadingPromise = (async () => {
                try {
                    let grid = null;
                    let source = null;
                    try { grid = await M.fetchStaticGrid(window.fetch.bind(window), Date.now()); source = 'static'; } catch (e) { console.warn('Static data:', e.message); }
                    if (!grid) {
                        try { grid = await M.fetchDirectGrid(window.fetch.bind(window), Date.now()); source = 'direct'; } catch (e) { console.warn('Direct grid:', e.message); }
                    }
                    if (grid) {
                        state.field = M.makeGridField(grid);
                        state.fieldInfo = { source, ts: Date.now(), generatedMs: grid.generatedMs };
                    } else {
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), WIND_FETCH_TIMEOUT_MS);
                        try {
                            const response = await fetch(buildWindUrl(), { signal: controller.signal });
                            if (!response.ok) throw new Error(`API ${response.status}`);
                            const w = parseWindResponse(await response.json());
                            state.field = M.makeUniformField(w.speed, w.fromDeg);
                            state.fieldInfo = { source: 'single', ts: Date.now(), generatedMs: (w.time || new Date()).getTime() };
                        } finally {
                            clearTimeout(timer);
                        }
                    }
                    deriveWindData();
                    if (state.phase === 'loading' || state.phase === 'error') state.phase = 'ready';
                    rebuildPreview();
                    renderAll();
                    return true;
                } catch (error) {
                    console.error('Wind fetch error:', error.message);
                    if (state.field && !strict) return false;
                    if (!state.field) {
                        state.windData = null;
                        state.phase = 'error';
                        renderAll();
                    }
                    return false;
                } finally {
                    loadingPromise = null;
                }
            })();
            return loadingPromise;
        }

        // --- Ветер ---

        function effectiveWind() {
            if (state.sim && !state.simStale) return state.sim.wind;
            if (state.mode === 'custom') return { speed: state.custom.speed, fromDeg: state.custom.deg, custom: true };
            return state.windData;
        }

        function renderWind() {
            const pointer = $('wind-pointer');
            const value = $('windSpeedValue');
            const unit = $('windSpeedUnit');
            const stamp = $('update-time');
            const dirText = $('windDirText');
            if (!pointer || !value || !stamp) return;
            if (unit) unit.textContent = t('speedUnit');
            const wind = effectiveWind();
            if (!wind) {
                value.textContent = t('windError');
                if (unit) unit.hidden = true;
                stamp.textContent = t('windNoData');
                if (dirText) dirText.textContent = '';
                return;
            }
            if (unit) unit.hidden = false;
            // Стрелка показывает, КУДА дует ветер. Угол накапливается, чтобы стрелка не прокручивалась по длинной дуге.
            state.pointerAngle = shortestAngleTarget(state.pointerAngle, windToBearing(wind.fromDeg));
            pointer.style.transform = `rotate(${state.pointerAngle}deg)`;
            value.textContent = wind.speed.toFixed(1);
            if (dirText) dirText.textContent = t('windBlows', { dir: dirTo(wind.fromDeg) });
            if (wind.custom) {
                stamp.textContent = t('modeCustom');
            } else {
                const shown = wind.time || new Date();
                stamp.textContent = t('windTimeAt', { time: shown.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) });
            }
        }

        function renderCustomControls() {
            const deg = $('customDeg');
            const speed = $('customSpeed');
            if (deg) deg.value = String(state.custom.deg);
            if (speed) speed.value = String(state.custom.speed);
            const degOut = $('customDegValue');
            if (degOut) degOut.textContent = t('customFromValue', { deg: state.custom.deg, dir: dirFrom(state.custom.deg) });
            const speedOut = $('customSpeedValue');
            if (speedOut) speedOut.textContent = `${state.custom.speed.toFixed(1)} ${t('speedUnit')}`;
            const result = $('customResult');
            if (result) result.textContent = t('customResult', { dir: dirTo(state.custom.deg) });
            const radios = document.querySelectorAll('input[name="windMode"]');
            radios.forEach((r) => { r.checked = r.value === state.mode; });
            const customBox = $('customBox');
            if (customBox) customBox.hidden = state.mode !== 'custom';
            const running = state.phase === 'simulating';
            ['customDeg', 'customSpeed'].forEach((id) => { const el = $(id); if (el) el.disabled = running; });
            radios.forEach((r) => { r.disabled = running; });
        }

        // --- Время аварии ---

        function renderAgo() {
            const row = $('agoRow');
            const select = $('agoSelect');
            if (!row || !select) return;
            const running = state.phase === 'simulating';
            row.hidden = !accidentUsable() || state.phase === 'loading' || state.phase === 'error';
            const current = agoDisplay();
            const values = AGO_OPTIONS.slice();
            const near = values.find((h) => Math.abs(h - current) < 0.05);
            const selected = near === undefined ? Math.round(current * 10) / 10 : near;
            if (near === undefined) { values.push(selected); values.sort((a, b) => a - b); }
            select.textContent = '';
            values.forEach((h) => {
                const option = document.createElement('option');
                option.value = String(h);
                option.textContent = h === 0 ? t('agoNow') : t('agoN', { n: h });
                select.appendChild(option);
            });
            select.value = String(selected);
            select.disabled = running || state.busy;
        }

        function renderAccident() {
            const el = $('accidentLine');
            if (!el) return;
            const sim = state.sim;
            const show = sim && (state.phase === 'simulating' || state.phase === 'finished') && sim.elapsed0 > 600;
            el.hidden = !show;
            if (show) el.textContent = t('accidentAt', { time: wallClock(sim.scenario.startMs) });
        }

        function renderStability() {
            const el = $('stabilityLine');
            if (!el) return;
            const sim = state.sim;
            const show = sim && (state.phase === 'simulating' || state.phase === 'finished');
            el.hidden = !show;
            if (!show) return;
            const point = M.pointAtElapsed(sim.scenario.path, sim.elapsed);
            const key = { unstable: 'stabUnstable', neutral: 'stabNeutral', stable: 'stabStable' }[M.stabilityGroup(point.cls)];
            el.textContent = t(key, { cls: point.cls });
        }

        // --- Блок «Где я» ---

        function whereTarget() {
            if (!state.where) return null;
            if (state.where.kind === 'geo') return { coords: state.where.coords };
            const city = CITIES.find((c) => c.id === state.where.id);
            return city ? { coords: city.coords } : null;
        }

        function activeScenario() {
            return state.sim && !state.simStale ? state.sim.scenario : state.preview;
        }

        function whereMessage() {
            const target = whereTarget();
            const scenario = activeScenario();
            if (!target || !scenario) return '';
            const r = M.locationResult(scenario, target.coords);
            const km = Math.round(r.distanceM / 1000);
            if (r.status === 'none') return t('whereNone', { km, h: Math.round(scenario.horizonSec / 3600) });
            const arrivalMs = scenario.startMs + r.seconds * 1000;
            const past = arrivalMs <= Date.now();
            const key = 'where' + (r.status === 'core' ? 'Core' : 'Outer') + (past ? 'Past' : '');
            return t(key, { time: formatArrival(r.seconds, state.lang), clock: wallClock(arrivalMs), km });
        }

        function renderWhere() {
            const out = $('whereResult');
            if (!out) return;
            out.textContent = state.whereStatus ? t(state.whereStatus) : whereMessage();
            const select = $('citySelect');
            if (select) select.value = state.where && state.where.kind === 'city' ? state.where.id : '';
        }

        function renderCitySelect() {
            const select = $('citySelect');
            if (!select) return;
            select.textContent = '';
            const none = document.createElement('option');
            none.value = '';
            none.textContent = t('whereCityNone');
            select.appendChild(none);
            CITIES.slice().sort((a, b) => cityName(a).localeCompare(cityName(b), locale())).forEach((city) => {
                const option = document.createElement('option');
                option.value = city.id;
                option.textContent = cityName(city);
                select.appendChild(option);
            });
            select.value = state.where && state.where.kind === 'city' ? state.where.id : '';
        }

        function locate() {
            if (!navigator.geolocation) { state.whereStatus = 'whereNoGeo'; renderWhere(); return; }
            state.whereStatus = 'whereLocating';
            renderWhere();
            navigator.geolocation.getCurrentPosition((pos) => {
                state.whereStatus = null;
                state.where = { kind: 'geo', coords: [pos.coords.latitude, pos.coords.longitude] };
                setYouMarker(state.where.coords);
                renderWhere();
            }, () => {
                state.whereStatus = 'whereDenied';
                renderWhere();
            }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
        }

        // --- Отрисовка интерфейса ---

        function renderButton() {
            const btn = $('simulateBtn');
            if (!btn) return;
            const custom = state.mode === 'custom';
            if (state.phase === 'simulating') { btn.hidden = true; return; }
            btn.hidden = false;
            if (state.busy) { btn.textContent = t('btnFetching'); btn.disabled = true; return; }
            if (state.phase === 'finished') { btn.textContent = t('btnRestart'); btn.disabled = false; return; }
            if (custom) { btn.textContent = t('btnStart'); btn.disabled = false; return; }
            if (state.phase === 'loading') { btn.textContent = t('btnLoading'); btn.disabled = true; return; }
            if (state.phase === 'error') { btn.textContent = t('btnRetry'); btn.disabled = false; return; }
            btn.textContent = t('btnStart');
            btn.disabled = false;
        }

        function renderStatus() {
            const el = $('statusMessage');
            if (!el) return;
            let text = '';
            if (state.notice) text = t(state.notice.key, state.notice.params);
            else if (state.phase === 'error' && state.mode === 'current') text = t(navigator.onLine === false ? 'statusOffline' : 'statusError');
            else if (state.mode === 'current' && state.fieldInfo && state.fieldInfo.source === 'single' && state.phase !== 'simulating') text = t('statusSimple');
            el.textContent = text;
            el.hidden = !text;
        }

        function renderClock() {
            const el = $('clock');
            if (el) el.textContent = formatClock(state.sim ? state.sim.elapsed : 0, state.lang);
            const speedBtn = $('speedBtn');
            if (speedBtn && state.sim) {
                speedBtn.textContent = t('speedBtn', { n: SPEEDS[state.sim.speedIndex] });
                speedBtn.setAttribute('aria-label', `${t('speedLabel')}: ${t('speedBtn', { n: SPEEDS[state.sim.speedIndex] })}`);
            }
            const pauseBtn = $('pauseBtn');
            if (pauseBtn && state.sim) pauseBtn.textContent = (state.sim.paused ? '▶︎ ' : '⏸ ') + t(state.sim.paused ? 'resume' : 'pause');
        }

        function renderSummary() {
            const box = $('summaryText');
            if (!box) return;
            const ids = Object.keys(state.arrived).sort((a, b) => state.arrived[b] - state.arrived[a]);
            box.textContent = '';
            const title = document.createElement('strong');
            title.textContent = ids.length ? t('summaryTitle', { n: ids.length }) : t('summaryNone');
            box.appendChild(title);
            ids.slice(0, 3).forEach((id) => {
                const city = CITIES.find((c) => c.id === id);
                const chip = document.createElement('span');
                chip.className = 'chip';
                chip.textContent = `${cityName(city)}: ${formatArrival(state.arrived[id], state.lang)}`;
                box.appendChild(chip);
            });
        }

        function renderCityList() {
            const list = $('cityList');
            if (!list) return;
            list.textContent = '';
            sortCityRows(CITIES, state.arrived).forEach((row) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'city-row' + (row.arrivalSeconds !== null ? ' hit' : '');
                btn.setAttribute('data-id', row.id);
                const name = document.createElement('span');
                name.className = 'city-name';
                name.textContent = row.names[state.lang] || row.names.ru;
                const meta = document.createElement('span');
                meta.className = 'city-meta';
                const km = Math.round(row.distanceM / 1000);
                meta.textContent = row.arrivalSeconds !== null ? formatArrival(row.arrivalSeconds, state.lang) : `${t('cityPending')} · ${t('cityKm', { km })}`;
                btn.appendChild(name);
                btn.appendChild(meta);
                li.appendChild(btn);
                list.appendChild(li);
            });
        }

        function renderPhase() {
            const running = state.phase === 'simulating';
            const shown = running || state.phase === 'finished';
            const setHidden = (id, hidden) => { const el = $(id); if (el) el.hidden = hidden; };
            setHidden('mainTitle', shown);
            setHidden('clockRow', !shown);
            setHidden('summary', !shown);
            setHidden('iodine-info-footer', !shown);
            setHidden('cityListBox', !shown);
            setHidden('legendNote', !shown);
            setHidden('pauseBtn', !running);
            setHidden('speedBtn', !running);
            setHidden('saveBtn', !(shown && state.lastPolys));
            if (running && isMobile()) closePanel();
        }

        function renderAll() {
            renderPhase();
            renderButton();
            renderStatus();
            renderWind();
            renderCustomControls();
            renderAgo();
            renderClock();
            renderAccident();
            renderStability();
            renderSummary();
            renderCityList();
            renderWhere();
            refreshMarkerTexts();
        }

        // --- Панель, окно «О модели», уведомления ---

        function openPanel() {
            const panel = $('infoPanel');
            const toggle = $('panelToggleBtn');
            if (panel) panel.classList.add('visible');
            const overlay = $('infoPanelOverlay');
            if (overlay) overlay.classList.add('visible');
            if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-label', t('panelClose')); }
        }

        function closePanel() {
            const panel = $('infoPanel');
            const toggle = $('panelToggleBtn');
            if (panel) panel.classList.remove('visible');
            const overlay = $('infoPanelOverlay');
            if (overlay) overlay.classList.remove('visible');
            if (toggle) { toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', t('panelOpen')); }
        }

        function togglePanel() {
            const panel = $('infoPanel');
            if (panel && panel.classList.contains('visible')) closePanel(); else openPanel();
        }

        function showToast(text) {
            const el = $('toast');
            if (!el) return;
            el.textContent = text;
            el.hidden = false;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
        }

        function openAbout() {
            const dlg = $('aboutDialog');
            if (!dlg) return;
            if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        }

        function closeAbout() {
            const dlg = $('aboutDialog');
            if (!dlg) return;
            if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
        }

        function renderInstall() {
            const btn = $('installBtn');
            const hint = $('installHint');
            const standalone = mq('(display-mode: standalone)') || window.navigator.standalone === true;
            if (btn) btn.hidden = !state.installEvent || standalone;
            if (hint) {
                const ua = navigator.userAgent || '';
                const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
                hint.textContent = standalone ? '' : (state.installEvent ? '' : t(ios ? 'installIos' : 'installOther'));
                hint.hidden = !hint.textContent;
            }
        }

        // --- Симуляция ---

        function announce(text) {
            const el = $('announcer');
            if (el) el.textContent = text;
        }

        // Отмечает города, до которых облако дошло к текущему моменту. silent: без объявления для программ чтения с экрана.
        function syncArrivals(silent) {
            const sim = state.sim;
            let changed = false;
            CITIES.forEach((city) => {
                if (Object.prototype.hasOwnProperty.call(state.arrived, city.id)) return;
                const seconds = sim.scenario.arrivals[city.id];
                if (seconds === undefined || seconds > sim.elapsed) return;
                state.arrived[city.id] = seconds;
                changed = true;
                const marker = cityMarkers[city.id];
                if (marker) marker.setStyle(cityStyle(true));
                if (!silent) announce(t('announce', { city: cityName(city), time: formatArrival(seconds, state.lang) }));
            });
            if (changed) {
                renderSummary();
                renderCityList();
                refreshMarkerTexts();
            }
        }

        function drawPlume() {
            const sim = state.sim;
            const polys = M.plumePolygons(sim.scenario.path, sim.elapsed);
            const opacity = plumeOpacity(sim.elapsed / 3600);
            updatePlumeLayer('outer', polys.outer, { color: '#f03', fillColor: '#f03', fillOpacity: opacity * 0.3, weight: 0 });
            updatePlumeLayer('center', polys.core, { color: 'red', fillColor: '#f03', fillOpacity: opacity, weight: 1.5 });
            state.lastPolys = { core: polys.core, outer: polys.outer, opacity };
            return state.lastPolys;
        }

        function finishSimulation() {
            if (simulationInterval) clearInterval(simulationInterval);
            simulationInterval = null;
            state.phase = 'finished';
            state.notice = { key: 'statusFinished', params: { h: Math.round(state.sim.scenario.horizonSec / 3600) } };
            renderAll();
            if (state.lastPolys) followPlume([state.lastPolys.core, state.lastPolys.outer], true);
        }

        function tick() {
            const sim = state.sim;
            if (!sim || sim.paused) return;
            const maxSeconds = sim.scenario.horizonSec;
            sim.elapsed = Math.min(maxSeconds, sim.elapsed + (UPDATE_INTERVAL_MS / 1000) * SIMULATION_SPEED_MULTIPLIER * SPEEDS[sim.speedIndex]);
            sim.ticks += 1;
            const polys = drawPlume();
            syncArrivals(false);
            renderClock();
            renderStability();
            if (sim.ticks % FOLLOW_EVERY_TICKS === 0) followPlume([polys.core, polys.outer], false);
            if (sim.elapsed >= maxSeconds) finishSimulation();
        }

        async function startSimulation() {
            if (state.phase === 'simulating' || state.busy) return;
            state.notice = null;
            if (state.mode === 'current') {
                const info = state.fieldInfo;
                const stale = !state.field || !info || Date.now() - info.ts > FIELD_REFRESH_MS[info.source];
                if (stale) {
                    state.busy = true;
                    renderButton();
                    const ok = await loadField(true);
                    state.busy = false;
                    if (!ok && !state.field) { renderAll(); return; }
                    if (!ok) state.notice = { key: 'statusStale', params: { time: wallClock(state.fieldInfo.generatedMs) } };
                }
            }
            const startMs = accidentStartMs();
            const scenario = makeScenario(startMs);
            if (!scenario) { renderAll(); return; }
            if (scenario.lengthM < 1000) {
                state.phase = 'ready';
                state.notice = { key: 'statusCalm' };
                renderAll();
                return;
            }
            if (simulationInterval) clearInterval(simulationInterval);
            state.simStale = false;
            const w = M.windAt(scenario.field, NPP_COORDS[0], NPP_COORDS[1], startMs);
            const elapsed0 = clamp(Math.round((Date.now() - startMs) / 1000), 0, scenario.horizonSec - 1);
            state.sim = {
                scenario,
                wind: { speed: w.speed, fromDeg: w.fromDeg, custom: state.mode === 'custom', time: state.fieldInfo && state.fieldInfo.generatedMs ? new Date(state.fieldInfo.generatedMs) : null },
                elapsed: elapsed0,
                elapsed0,
                ticks: 0,
                paused: false,
                speedIndex: DEFAULT_SPEED_INDEX
            };
            resetSimulationVisuals();
            state.phase = 'simulating';
            syncArrivals(true);
            const polys = drawPlume();
            renderAll();
            if (elapsed0 > 0) followPlume([polys.core, polys.outer], true);
            simulationInterval = setInterval(tick, UPDATE_INTERVAL_MS);
        }

        function onMainButton() {
            if (state.phase === 'error' && state.mode === 'current') {
                state.phase = 'loading';
                renderAll();
                loadField(false);
            } else {
                startSimulation();
            }
        }

        // --- Поделиться и картинка ---

        function currentShareUrl() {
            const sim = state.sim;
            const customWind = sim && sim.wind.custom ? { deg: sim.wind.fromDeg, speed: sim.wind.speed }
                : (state.mode === 'custom' ? state.custom : null);
            let atMs = null;
            if (!customWind && accidentUsable()) {
                const start = sim && !state.simStale ? sim.scenario.startMs : accidentStartMs();
                if (Date.now() - start > 10 * 60 * 1000) atMs = start;
            }
            return buildShareUrl(window.location.href, {
                lang: state.lang,
                custom: customWind,
                atMs,
                city: state.where && state.where.kind === 'city' ? state.where.id : null,
                run: !!sim || !!customWind
            });
        }

        function buildShareText() {
            const parts = [t('shareText')];
            if (state.sim) parts.push(t('summaryTitle', { n: Object.keys(state.arrived).length }) + '.');
            if (state.where && state.where.kind === 'city') {
                const msg = whereMessage();
                if (msg) parts.push(msg);
            }
            return parts.join(' ');
        }

        async function copyText(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return;
            }
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(area);
            if (!ok) throw new Error('copy failed');
        }

        async function onShare() {
            const url = currentShareUrl();
            try {
                if (navigator.share) {
                    await navigator.share({ title: t('pageTitle'), text: buildShareText(), url });
                } else {
                    await copyText(url);
                    showToast(t('shareCopied'));
                }
            } catch (error) {
                if (error && error.name === 'AbortError') return;
                try { await copyText(url); showToast(t('shareCopied')); } catch (e) { showToast(t('shareFail')); }
            }
        }

        function buildImageData() {
            const sim = state.sim;
            const polys = state.lastPolys;
            const lang = state.lang;
            return {
                title: t('imageTitle'),
                subtitle: t('imageSub'),
                windLine: `${t('windBlows', { dir: dirFrom(sim.wind.fromDeg) })}, ${sim.wind.speed.toFixed(1)} ${t('speedUnit')}`,
                clockLine: t('imageClock', { h: Math.floor(sim.elapsed / 3600) }),
                footer: t('imageFooter'),
                nppLabel: t('npp'),
                npp: NPP_COORDS,
                polygons: [
                    { points: polys.outer, fill: `rgba(255,0,51,${(polys.opacity * 0.3).toFixed(3)})` },
                    { points: polys.core, fill: `rgba(255,0,51,${polys.opacity.toFixed(3)})`, stroke: '#ff5252' }
                ],
                cities: CITIES.map((c) => ({
                    name: c.names[lang] || c.names.ru,
                    coords: c.coords,
                    label: Object.prototype.hasOwnProperty.call(state.arrived, c.id)
                        ? `${c.names[lang] || c.names.ru} ${formatArrival(state.arrived[c.id], lang)}` : null
                }))
            };
        }

        function onSaveImage() {
            if (!state.sim || !state.lastPolys) return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 1200;
                canvas.height = 630;
                drawResultImage(canvas.getContext('2d'), canvas.width, canvas.height, buildImageData());
                canvas.toBlob((blob) => {
                    if (!blob) { showToast(t('imageFail')); return; }
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = 'belaes-wind.png';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                }, 'image/png');
            } catch (error) {
                console.error('Image error:', error.message);
                showToast(t('imageFail'));
            }
        }

        // --- События ---

        function markStaleIfFinished() {
            if (state.phase === 'finished') state.simStale = true;
        }

        function setupEvents() {
            $('simulateBtn').addEventListener('click', onMainButton);
            $('pauseBtn').addEventListener('click', () => { if (state.sim) { state.sim.paused = !state.sim.paused; renderClock(); } });
            $('speedBtn').addEventListener('click', () => { if (state.sim) { state.sim.speedIndex = (state.sim.speedIndex + 1) % SPEEDS.length; renderClock(); } });
            $('shareBtn').addEventListener('click', onShare);
            $('saveBtn').addEventListener('click', onSaveImage);
            $('aboutBtn').addEventListener('click', openAbout);
            $('aboutClose').addEventListener('click', closeAbout);
            $('aboutDialog').addEventListener('click', (e) => { if (e.target === $('aboutDialog')) closeAbout(); });
            $('panelToggleBtn').addEventListener('click', togglePanel);
            $('infoPanelOverlay').addEventListener('click', closePanel);
            $('summaryAll').addEventListener('click', () => { if (isMobile()) openPanel(); else { const box = $('cityListBox'); if (box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' }); } });
            $('langSelect').addEventListener('change', (e) => setLanguage(e.target.value));
            $('agoSelect').addEventListener('change', (e) => {
                markStaleIfFinished();
                state.agoHours = clamp(Number(e.target.value) || 0, 0, MAX_AGO_HOURS);
                state.accidentAtMs = null;
                state.notice = null;
                deriveWindData();
                rebuildPreview();
                renderAll();
            });
            $('locateBtn').addEventListener('click', locate);
            $('citySelect').addEventListener('change', (e) => {
                state.whereStatus = null;
                state.where = e.target.value ? { kind: 'city', id: e.target.value } : null;
                setYouMarker(null);
                renderWhere();
            });
            document.querySelectorAll('input[name="windMode"]').forEach((r) => r.addEventListener('change', (e) => {
                if (!e.target.checked) return;
                state.mode = e.target.value;
                state.notice = null;
                markStaleIfFinished();
                if (state.mode === 'custom' && state.phase !== 'simulating' && state.phase !== 'finished') state.phase = 'ready';
                if (state.mode === 'current' && state.phase === 'ready' && !state.field) state.phase = 'error';
                deriveWindData();
                rebuildPreview();
                renderAll();
            }));
            $('customDeg').addEventListener('input', (e) => {
                markStaleIfFinished();
                state.custom.deg = normalizeAngle(Math.round(Number(e.target.value)));
                renderCustomControls();
                renderWind();
                rebuildPreview();
            });
            $('customSpeed').addEventListener('input', (e) => {
                markStaleIfFinished();
                const v = clamp(Number(e.target.value), CUSTOM_SPEED_MIN, CUSTOM_SPEED_MAX);
                state.custom.speed = Math.round(v * 10) / 10;
                renderCustomControls();
                renderWind();
                rebuildPreview();
            });
            $('cityList').addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.city-row');
                if (!btn) return;
                const city = CITIES.find((c) => c.id === btn.getAttribute('data-id'));
                if (!city || !map) return;
                map.panTo(city.coords);
                if (isMobile()) closePanel();
                const marker = cityMarkers[city.id];
                if (marker) marker.openPopup();
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
            window.addEventListener('online', () => { if (state.phase === 'error' && state.mode === 'current') { state.phase = 'loading'; renderAll(); loadField(false); } });
            window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; renderInstall(); });
            window.addEventListener('appinstalled', () => { state.installEvent = null; renderInstall(); });
            const installBtn = $('installBtn');
            if (installBtn) installBtn.addEventListener('click', async () => {
                const ev = state.installEvent;
                if (!ev) return;
                ev.prompt();
                try { await ev.userChoice; } catch (e) { /* пользователь закрыл окно */ }
                state.installEvent = null;
                renderInstall();
            });
        }

        function registerServiceWorker() {
            if (!('serviceWorker' in navigator)) return;
            const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            if (!secure) return;
            navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW error:', e.message));
        }

        // Раз в минуту: обновляет поле ветра, когда оно устарело, и пересчитывает «сейчас» в блоке «Где я».
        function housekeeping() {
            if (state.phase === 'simulating' || state.busy) return;
            const info = state.fieldInfo;
            const wait = !info || state.phase === 'error' ? FIELD_RETRY_MS : (FIELD_REFRESH_MS[info.source] || FIELD_RETRY_MS);
            if (!info || Date.now() - info.ts >= wait) {
                loadField(false);
            } else if (state.phase === 'ready') {
                deriveWindData();
                rebuildPreview();
                renderWind();
            }
        }

        // --- Запуск ---

        applyStaticTexts();
        initMap();
        setupEvents();
        closePanel();
        if (state.mode === 'custom') state.phase = 'ready';
        renderInstall();
        renderCitySelect();
        renderAll();
        if (state.mode === 'custom') rebuildPreview();
        loadField(false);
        setInterval(housekeeping, 60 * 1000);
        registerServiceWorker();
        if (shareParams.atInvalid) showToast(t('atInvalid'));
        if (shareParams.run) startSimulation();
    }

    // ===== Запуск и экспорт для тестов =====

    if (IN_NODE) {
        module.exports = {
            normalizeAngle, windToBearing, compassIndex, shortestAngleTarget, destinationPoint, distanceBetween,
            plumeOpacity, boundsOf, boundsContain, shrinkBounds,
            formatHM, formatArrival, formatClock, parseWindResponse, buildWindUrl, parseShareParams, buildShareUrl,
            pickLanguage, sortCityRows, drawResultImage, CITIES, NPP_COORDS, SPEEDS, MAX_SIMULATION_HOURS, APP_VERSION
        };
    }
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initApp);
        } else {
            initApp();
        }
    }
})();
