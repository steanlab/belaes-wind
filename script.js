/*
 * Куда дует ветер от БелАЭС? Учебная симуляция.
 * Модель: облако идет по прямой в сторону, куда дует ветер, с постоянной скоростью
 * и расширяется конусом. Ветер берется один раз при запуске (Open-Meteo, 10 м)
 * либо задается вручную. Подробности и ограничения: README.md
 */
(function () {
    'use strict';

    const I18N = (typeof module !== 'undefined' && module.exports) ? require('./i18n.js') : window.AstravyetsI18n;

    // ===== Настройки =====
    const APP_VERSION = '2.0.0';
    const NPP_COORDS = [54.773, 26.096];
    const WIND_API_URL = 'https://api.open-meteo.com/v1/forecast';
    const WIND_REFRESH_MS = 5 * 60 * 1000;      // Open-Meteo обновляет текущие значения примерно раз в 15 минут
    const WIND_FETCH_TIMEOUT_MS = 10 * 1000;
    const SIMULATION_SPEED_MULTIPLIER = 3600;   // при скорости x1: 1 секунда реального времени = 1 час модельного
    const SPEEDS = [0.5, 1, 2, 4];
    const DEFAULT_SPEED_INDEX = 1;
    const UPDATE_INTERVAL_MS = 100;
    const FOLLOW_EVERY_TICKS = 10;              // как часто проверять, не вышло ли облако за край карты
    const MAX_SIMULATION_HOURS = 48;            // после этого симуляция останавливается
    const PLUME_HALF_ANGLE_DEG = 15;            // полуугол конуса облака (условный)
    const AXIS_UNCERTAINTY_DEG = 15;            // сдвиг оси облака для «коридора неопределенности» (условный)
    const PLUME_SEGMENTS = 50;
    const OPACITY_START = 0.5;                  // условная прозрачность: плотность облака с расстоянием падает
    const OPACITY_END = 0.12;
    const CUSTOM_SPEED_MIN = 0.5;
    const CUSTOM_SPEED_MAX = 25;
    const EARTH_RADIUS_M = 6371000;
    const LANG_STORAGE_KEY = 'belaes-wind-lang';
    const LANG_CODES = I18N.LANGS.map((l) => l.code);

    const CITIES = [
        { id: 'vilnius', coords: [54.687, 25.279], names: { ru: 'Вильнюс', be: 'Вільнюс', en: 'Vilnius', pl: 'Wilno' } },
        { id: 'minsk', coords: [53.904, 27.561], names: { ru: 'Минск', be: 'Мінск', en: 'Minsk', pl: 'Mińsk' } },
        { id: 'chisinau', coords: [47.026, 28.858], names: { ru: 'Кишинев', be: 'Кішынёў', en: 'Chișinău', pl: 'Kiszyniów' } },
        { id: 'swinoujscie', coords: [53.914, 14.249], names: { ru: 'Свиноуйсьце', be: 'Свіноуйсьце', en: 'Świnoujście', pl: 'Świnoujście' } },
        { id: 'sofia', coords: [42.698, 23.322], names: { ru: 'София', be: 'Сафія', en: 'Sofia', pl: 'Sofia' } },
        { id: 'krakow', coords: [50.064, 19.945], names: { ru: 'Краков', be: 'Кракаў', en: 'Kraków', pl: 'Kraków' } },
        { id: 'kharkiv', coords: [49.922, 36.321], names: { ru: 'Харьков', be: 'Харкаў', en: 'Kharkiv', pl: 'Charków' } },
        { id: 'warsaw', coords: [52.229, 21.012], names: { ru: 'Варшава', be: 'Варшава', en: 'Warsaw', pl: 'Warszawa' } },
        { id: 'wroclaw', coords: [51.107, 17.038], names: { ru: 'Вроцлав', be: 'Вроцлаў', en: 'Wrocław', pl: 'Wrocław' } },
        { id: 'bialystok', coords: [53.132, 23.169], names: { ru: 'Белосток', be: 'Беласток', en: 'Białystok', pl: 'Białystok' } },
        { id: 'liepaja', coords: [56.511, 21.013], names: { ru: 'Лиепая', be: 'Ліепая', en: 'Liepāja', pl: 'Lipawa' } },
        { id: 'palanga', coords: [55.918, 21.069], names: { ru: 'Паланга', be: 'Паланга', en: 'Palanga', pl: 'Połąga' } },
        { id: 'ventspils', coords: [57.319, 21.564], names: { ru: 'Вентспилс', be: 'Вентспілс', en: 'Ventspils', pl: 'Windawa' } },
        { id: 'tallinn', coords: [59.437, 24.754], names: { ru: 'Таллин', be: 'Талін', en: 'Tallinn', pl: 'Tallin' } },
        { id: 'riga', coords: [56.949, 24.105], names: { ru: 'Рига', be: 'Рыга', en: 'Riga', pl: 'Ryga' } },
        { id: 'kaunas', coords: [54.898, 23.903], names: { ru: 'Каунас', be: 'Каўнас', en: 'Kaunas', pl: 'Kowno' } },
        { id: 'asveya', coords: [56.015, 28.115], names: { ru: 'Освея', be: 'Асвея', en: 'Asveya', pl: 'Asweja' } },
        { id: 'kyiv', coords: [50.45, 30.523], names: { ru: 'Киев', be: 'Кіеў', en: 'Kyiv', pl: 'Kijów' } },
        { id: 'navahrudak', coords: [53.596, 25.827], names: { ru: 'Новогрудок', be: 'Навагрудак', en: 'Navahrudak', pl: 'Nowogródek' } },
        { id: 'zhodzina', coords: [54.093, 28.34], names: { ru: 'Жодино', be: 'Жодзіна', en: 'Zhodzina', pl: 'Żodzino' } },
        { id: 'hrodna', coords: [53.669, 23.826], names: { ru: 'Гродно', be: 'Горадня', en: 'Hrodna', pl: 'Grodno' } },
        { id: 'pinsk', coords: [52.115, 26.103], names: { ru: 'Пинск', be: 'Пінск', en: 'Pinsk', pl: 'Pińsk' } },
        { id: 'saint-petersburg', coords: [59.934, 30.335], names: { ru: 'Санкт-Петербург', be: 'Санкт-Пецярбург', en: 'Saint Petersburg', pl: 'Petersburg' } },
        { id: 'vitebsk', coords: [55.19, 30.205], names: { ru: 'Витебск', be: 'Віцебск', en: 'Vitebsk', pl: 'Witebsk' } },
        { id: 'eisenach', coords: [50.978, 10.318], names: { ru: 'Эйзенах', be: 'Айзенах', en: 'Eisenach', pl: 'Eisenach' } },
        { id: 'tatariv', coords: [48.349, 24.577], names: { ru: 'Татаров', be: 'Татараў', en: 'Tatariv', pl: 'Tatarów' } },
        { id: 'elblag', coords: [54.156, 19.402], names: { ru: 'Эльблонг', be: 'Эльблонг', en: 'Elbląg', pl: 'Elbląg' } },
        { id: 'homel', coords: [52.424, 31.014], names: { ru: 'Гомель', be: 'Гомель', en: 'Homel', pl: 'Homel' } },
        { id: 'vyborg', coords: [60.709, 28.747], names: { ru: 'Выборг', be: 'Выбарг', en: 'Vyborg', pl: 'Wyborg' } }
    ];

    // ===== Геометрия, разбор данных, форматирование (чистые функции, без DOM и Leaflet) =====

    function normalizeAngle(deg) {
        return ((deg % 360) + 360) % 360;
    }

    // Метеорологическое направление ветра это направление, ОТКУДА он дует.
    // Облако движется в противоположную сторону.
    function windToBearing(windFromDeg) {
        return normalizeAngle(windFromDeg + 180);
    }

    // Индекс из 8 сторон света: 0 север, 1 северо-восток, 2 восток и так далее.
    function compassIndex(deg) {
        return Math.round(normalizeAngle(deg) / 45) % 8;
    }

    // Новый накопленный угол стрелки, чтобы она поворачивалась по короткой дуге, а не на 340 градусов.
    function shortestAngleTarget(current, target) {
        const delta = ((normalizeAngle(target) - normalizeAngle(current) + 540) % 360) - 180;
        return current + delta;
    }

    function destinationPoint(point, bearingDeg, distanceM) {
        const lat1 = point[0] * Math.PI / 180;
        const lng1 = point[1] * Math.PI / 180;
        const bearing = bearingDeg * Math.PI / 180;
        const ang = distanceM / EARTH_RADIUS_M;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing));
        const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
        return [lat2 * 180 / Math.PI, ((lng2 * 180 / Math.PI + 540) % 360) - 180];
    }

    function distanceBetween(a, b) {
        const lat1 = a[0] * Math.PI / 180;
        const lat2 = b[0] * Math.PI / 180;
        const dLat = lat2 - lat1;
        const dLng = (b[1] - a[1]) * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    // Конус от источника: ось длиной distanceM, ширина растет линейно (полуугол halfAngleDeg).
    function createPlumePolygon(origin, bearingDeg, distanceM, halfAngleDeg, segments) {
        const spread = distanceM * Math.tan(halfAngleDeg * Math.PI / 180);
        const step = distanceM / segments;
        const axis = [origin];
        for (let i = 0; i < segments; i++) {
            axis.push(destinationPoint(axis[i], bearingDeg, step));
        }
        const left = [];
        const right = [];
        for (let i = 1; i < axis.length; i++) {
            const offset = i / segments * spread;
            left.push(destinationPoint(axis[i], bearingDeg - 90, offset));
            right.push(destinationPoint(axis[i], bearingDeg + 90, offset));
        }
        return [origin, ...left, ...right.reverse()];
    }

    // Алгоритм луча. point и вершины в формате [широта, долгота].
    function pointInPolygon(point, polygon) {
        const lat = point[0];
        const lng = point[1];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const latI = polygon[i][0], lngI = polygon[i][1];
            const latJ = polygon[j][0], lngJ = polygon[j][1];
            const crosses = (latI > lat) !== (latJ > lat) &&
                lng < (lngJ - lngI) * (lat - latI) / (latJ - latI) + lngI;
            if (crosses) inside = !inside;
        }
        return inside;
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

    // Параметры ссылки: lang, wd (откуда дует, градусы), ws (скорость, м/с), run=1 (сразу запустить).
    function parseShareParams(search) {
        const p = new URLSearchParams(search || '');
        const out = { lang: null, custom: null, run: false };
        const lang = p.get('lang');
        if (lang && LANG_CODES.includes(lang)) out.lang = lang;
        const wdRaw = p.get('wd');
        const wsRaw = p.get('ws');
        if (wdRaw !== null && wsRaw !== null && wdRaw.trim() !== '' && wsRaw.trim() !== '') {
            const wd = Number(wdRaw);
            const ws = Number(wsRaw);
            if (Number.isFinite(wd) && Number.isFinite(ws) && wd >= 0 && wd <= 360 && ws >= CUSTOM_SPEED_MIN && ws <= CUSTOM_SPEED_MAX) {
                out.custom = { deg: normalizeAngle(Math.round(wd)), speed: Math.round(ws * 10) / 10 };
                out.run = p.get('run') === '1';
            }
        }
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
            url.searchParams.set('run', '1');
        }
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

        function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
        function storageSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* хранилище недоступно */ } }

        const shareParams = parseShareParams(window.location.search);
        const state = {
            lang: pickLanguage({ urlLang: shareParams.lang, stored: storageGet(LANG_STORAGE_KEY), navLangs: navigator.languages || (navigator.language ? [navigator.language] : []) }),
            phase: 'loading',            // loading | ready | error | simulating | finished
            busy: false,
            mode: shareParams.custom ? 'custom' : 'current',
            custom: shareParams.custom || { deg: 270, speed: 5 },
            windData: null,
            notice: null,                // { key, params } временные сообщения
            sim: null,
            arrived: {},                 // id города -> секунды до прибытия
            lastPolys: null,
            pointerAngle: 0,
            simStale: false,             // true, если после остановки пользователь уже меняет ветер
            installEvent: null
        };

        const t = (key, params) => I18N.t(state.lang, key, params);
        const cityName = (c) => c.names[state.lang] || c.names.ru;
        const dirTo = (deg) => I18N.t(state.lang, 'dirTo')[compassIndex(windToBearing(deg))];
        const dirFrom = (deg) => I18N.t(state.lang, 'dirFrom')[compassIndex(deg)];

        let map = null;
        let simulationInterval = null;
        let toastTimer = null;
        const cityMarkers = {};
        const plumeLayers = { center: null, left: null, right: null };

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
                stamp.textContent = t('windTimeAt', { time: shown.toLocaleTimeString(state.lang === 'be' ? 'be-BY' : state.lang, { hour: '2-digit', minute: '2-digit' }) });
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

        // Возвращает true, если свежие данные получены. strict: при сбое всегда переходить в состояние error.
        async function refreshWind(strict) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), WIND_FETCH_TIMEOUT_MS);
            try {
                const response = await fetch(buildWindUrl(), { signal: controller.signal });
                if (!response.ok) throw new Error(`API ${response.status}`);
                state.windData = parseWindResponse(await response.json());
                if (state.phase === 'loading' || state.phase === 'error') state.phase = 'ready';
                renderAll();
                return true;
            } catch (error) {
                console.error('Wind fetch error:', error.message);
                const running = state.phase === 'simulating' || state.phase === 'finished';
                if (strict || !running) {
                    state.windData = null;
                    state.phase = 'error';
                    renderAll();
                }
                return false;
            } finally {
                clearTimeout(timer);
            }
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
            renderClock();
            renderSummary();
            renderCityList();
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

        function checkCityArrival(centerPolygon) {
            const wind = state.sim.wind;
            CITIES.forEach((city) => {
                if (Object.prototype.hasOwnProperty.call(state.arrived, city.id)) return;
                if (!pointInPolygon(city.coords, centerPolygon)) return;
                const seconds = distanceBetween(NPP_COORDS, city.coords) / wind.speed;
                state.arrived[city.id] = seconds;
                const marker = cityMarkers[city.id];
                if (marker) marker.setStyle(cityStyle(true));
                const time = formatArrival(seconds, state.lang);
                announce(t('announce', { city: cityName(city), time }));
                renderSummary();
                renderCityList();
                refreshMarkerTexts();
            });
        }

        function drawPlume() {
            const sim = state.sim;
            const distanceM = sim.wind.speed * sim.elapsed;
            const hours = sim.elapsed / 3600;
            const center = createPlumePolygon(NPP_COORDS, sim.bearing, distanceM, PLUME_HALF_ANGLE_DEG, PLUME_SEGMENTS);
            const left = createPlumePolygon(NPP_COORDS, sim.bearing - AXIS_UNCERTAINTY_DEG, distanceM, PLUME_HALF_ANGLE_DEG, PLUME_SEGMENTS);
            const right = createPlumePolygon(NPP_COORDS, sim.bearing + AXIS_UNCERTAINTY_DEG, distanceM, PLUME_HALF_ANGLE_DEG, PLUME_SEGMENTS);
            const opacity = plumeOpacity(hours);
            updatePlumeLayer('center', center, { color: 'red', fillColor: '#f03', fillOpacity: opacity, weight: 1.5 });
            updatePlumeLayer('left', left, { color: '#f03', fillColor: '#f03', fillOpacity: opacity * 0.3, weight: 0 });
            updatePlumeLayer('right', right, { color: '#f03', fillColor: '#f03', fillOpacity: opacity * 0.3, weight: 0 });
            state.lastPolys = { center, left, right, opacity };
            return state.lastPolys;
        }

        function finishSimulation() {
            if (simulationInterval) clearInterval(simulationInterval);
            simulationInterval = null;
            state.phase = 'finished';
            state.notice = { key: 'statusFinished', params: { h: MAX_SIMULATION_HOURS } };
            renderAll();
            if (state.lastPolys) followPlume([state.lastPolys.center, state.lastPolys.left, state.lastPolys.right], true);
        }

        function tick() {
            const sim = state.sim;
            if (!sim || sim.paused) return;
            const maxSeconds = MAX_SIMULATION_HOURS * 3600;
            sim.elapsed = Math.min(maxSeconds, sim.elapsed + (UPDATE_INTERVAL_MS / 1000) * SIMULATION_SPEED_MULTIPLIER * SPEEDS[sim.speedIndex]);
            sim.ticks += 1;
            const polys = drawPlume();
            checkCityArrival(polys.center);
            renderClock();
            if (sim.ticks % FOLLOW_EVERY_TICKS === 0) followPlume([polys.center, polys.left, polys.right], false);
            if (sim.elapsed >= maxSeconds) finishSimulation();
        }

        async function startSimulation() {
            if (state.phase === 'simulating' || state.busy) return;
            let wind;
            if (state.mode === 'custom') {
                wind = { speed: state.custom.speed, fromDeg: state.custom.deg, custom: true, time: null };
            } else {
                state.busy = true;
                state.notice = null;
                renderButton();
                const success = await refreshWind(true);
                state.busy = false;
                if (!success) { renderAll(); return; }
                wind = state.windData;
            }
            state.notice = null;
            if (wind.speed <= 0) {
                state.phase = 'ready';
                state.notice = { key: 'statusCalm' };
                renderAll();
                return;
            }
            if (simulationInterval) clearInterval(simulationInterval);
            state.simStale = false;
            state.sim = { wind: { ...wind }, bearing: windToBearing(wind.fromDeg), elapsed: 0, ticks: 0, paused: false, speedIndex: DEFAULT_SPEED_INDEX };
            resetSimulationVisuals();
            state.phase = 'simulating';
            renderAll();
            simulationInterval = setInterval(tick, UPDATE_INTERVAL_MS);
        }

        function onMainButton() {
            if (state.phase === 'error' && state.mode === 'current') {
                state.phase = 'loading';
                renderAll();
                refreshWind(false);
            } else {
                startSimulation();
            }
        }

        // --- Поделиться и картинка ---

        function currentShareUrl() {
            const customWind = state.sim && state.sim.wind.custom ? { deg: state.sim.wind.fromDeg, speed: state.sim.wind.speed }
                : (state.mode === 'custom' ? state.custom : null);
            return buildShareUrl(window.location.href, { lang: state.lang, custom: customWind });
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
                    await navigator.share({ title: t('pageTitle'), text: t('shareText'), url });
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
                    { points: polys.left, fill: `rgba(255,0,51,${(polys.opacity * 0.3).toFixed(3)})` },
                    { points: polys.right, fill: `rgba(255,0,51,${(polys.opacity * 0.3).toFixed(3)})` },
                    { points: polys.center, fill: `rgba(255,0,51,${polys.opacity.toFixed(3)})`, stroke: '#ff5252' }
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
            document.querySelectorAll('input[name="windMode"]').forEach((r) => r.addEventListener('change', (e) => {
                if (!e.target.checked) return;
                state.mode = e.target.value;
                state.notice = null;
                if (state.phase === 'finished') state.simStale = true;
                if (state.mode === 'custom' && state.phase !== 'simulating' && state.phase !== 'finished') state.phase = 'ready';
                if (state.mode === 'current' && state.phase === 'ready' && !state.windData) state.phase = 'error';
                renderAll();
            }));
            $('customDeg').addEventListener('input', (e) => { if (state.phase === 'finished') state.simStale = true; state.custom.deg = normalizeAngle(Math.round(Number(e.target.value))); renderCustomControls(); renderWind(); });
            $('customSpeed').addEventListener('input', (e) => {
                if (state.phase === 'finished') state.simStale = true;
                const v = Math.min(CUSTOM_SPEED_MAX, Math.max(CUSTOM_SPEED_MIN, Number(e.target.value)));
                state.custom.speed = Math.round(v * 10) / 10;
                renderCustomControls();
                renderWind();
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
            window.addEventListener('online', () => { if (state.phase === 'error' && state.mode === 'current') { state.phase = 'loading'; renderAll(); refreshWind(false); } });
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

        // --- Запуск ---

        applyStaticTexts();
        initMap();
        setupEvents();
        closePanel();
        if (state.mode === 'custom') state.phase = 'ready';
        renderInstall();
        renderAll();
        refreshWind(false);
        setInterval(() => refreshWind(false), WIND_REFRESH_MS);
        registerServiceWorker();
        if (shareParams.run && shareParams.custom) startSimulation();
    }

    // ===== Запуск и экспорт для тестов =====

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            normalizeAngle, windToBearing, compassIndex, shortestAngleTarget, destinationPoint, distanceBetween,
            createPlumePolygon, pointInPolygon, plumeOpacity, boundsOf, boundsContain, shrinkBounds,
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
