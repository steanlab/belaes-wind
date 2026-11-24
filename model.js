/*
 * Модель переноса: поле ветра на сетке, траектория по часам, устойчивость атмосферы, полоса облака.
 * Здесь нет DOM и Leaflet. Файл работает в браузере и в Node (тесты, сбор данных в GitHub Actions).
 *
 * Что это за модель. Кинематическая траектория одной частицы: каждые 5 минут частица сдвигается
 * по ветру в ее текущей точке и в текущий час (метод Хойна). Ширина облака растет вдоль пути
 * со скоростью, которая зависит от класса устойчивости атмосферы (упрощенно по Пэскуиллу).
 * Это не расчет рассеяния и не оценка концентраций. Подробности и ограничения: README.md
 */
(function (root) {
    'use strict';

    const EARTH_RADIUS_M = 6371000;
    const NPP_COORDS = [54.773, 26.096];
    const API_URL = 'https://api.open-meteo.com/v1/forecast';

    // Сетка запроса: широта 44..68 с шагом 3, долгота 6..54 с шагом 3 (153 точки). За границей поле берется по краю.
    const GRID = { latMin: 44, latMax: 68, latStep: 3, lonMin: 6, lonMax: 54, lonStep: 3 };
    const PAST_HOURS = 24;
    const FORECAST_HOURS = 49;
    const CHUNK_SIZE = 40;                    // точек в одном запросе
    const PATH_STEP_S = 300;                  // шаг траектории, секунд
    const MAX_HORIZON_HOURS = 48;
    const AXIS_UNCERTAINTY_DEG = 15;          // запас на ошибку направления ветра, условный
    const DEFAULT_CLOUD_PCT = 50;
    // Полуугол облака по классу устойчивости. Взято из таблицы σθ Пэскуилла (25, 20, 15, 10, 5, 2.5 градуса),
    // для наглядности нижняя граница 5 градусов. Это ориентир, а не расчет.
    const HALF_ANGLE_BY_CLASS = { A: 25, B: 20, C: 15, D: 10, E: 5, F: 5 };
    const DATA_URL = 'https://raw.githubusercontent.com/steanlab/belaes-wind/data/wind-grid.json';
    const DATA_MAX_AGE_MS = 3 * 3600 * 1000;
    const RAD = Math.PI / 180;

    // ===== Геометрия =====

    function normalizeAngle(deg) {
        return ((deg % 360) + 360) % 360;
    }

    // Метеорологическое направление ветра это направление, ОТКУДА он дует. Облако идет в противоположную сторону.
    function windToBearing(windFromDeg) {
        return normalizeAngle(windFromDeg + 180);
    }

    function destinationPoint(point, bearingDeg, distanceM) {
        const lat1 = point[0] * RAD;
        const lng1 = point[1] * RAD;
        const bearing = bearingDeg * RAD;
        const ang = distanceM / EARTH_RADIUS_M;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing));
        const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
        return [lat2 / RAD, ((lng2 / RAD + 540) % 360) - 180];
    }

    function distanceBetween(a, b) {
        const lat1 = a[0] * RAD;
        const lat2 = b[0] * RAD;
        const dLat = lat2 - lat1;
        const dLng = (b[1] - a[1]) * RAD;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function initialBearing(a, b) {
        const lat1 = a[0] * RAD;
        const lat2 = b[0] * RAD;
        const dLng = (b[1] - a[1]) * RAD;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        return normalizeAngle(Math.atan2(y, x) / RAD);
    }

    // Из компонент ветра (u на восток, v на север, м/с) в скорость и направление, ОТКУДА дует.
    function windFromComponents(u, v) {
        const speed = Math.hypot(u, v);
        return { speed, fromDeg: speed < 1e-9 ? 0 : normalizeAngle(Math.atan2(-u, -v) / RAD) };
    }

    function componentsFromWind(speed, fromDeg) {
        return { u: -speed * Math.sin(fromDeg * RAD), v: -speed * Math.cos(fromDeg * RAD) };
    }

    // ===== Солнце и устойчивость атмосферы =====

    // Высота Солнца над горизонтом, градусы (формулы NOAA).
    function solarElevationDeg(lat, lon, tMs) {
        const d = new Date(tMs);
        const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
        const dayOfYear = Math.floor((tMs - startOfYear) / 86400000) + 1;
        const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
        const g = 2 * Math.PI / 365 * (dayOfYear - 1 + (hours - 12) / 24);
        const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
        const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
        const trueSolarMin = ((hours * 60 + eqTime + 4 * lon) % 1440 + 1440) % 1440;
        const hourAngle = (trueSolarMin / 4 - 180) * RAD;
        const sinElev = Math.sin(lat * RAD) * Math.sin(decl) + Math.cos(lat * RAD) * Math.cos(decl) * Math.cos(hourAngle);
        return Math.asin(Math.max(-1, Math.min(1, sinElev))) / RAD;
    }

    // Класс устойчивости по Пэскуиллу (A очень неустойчивая ... D нейтральная ... F устойчивая).
    // Вход: скорость ветра на 10 м (м/с), высота Солнца (градусы), облачность (проценты).
    // Если в таблице стоит двойной класс (A-B, B-C, C-D), берется более устойчивый.
    function stabilityClass(speedMs, sunElevDeg, cloudPct) {
        const band = speedMs < 2 ? 0 : speedMs < 3 ? 1 : speedMs < 5 ? 2 : speedMs < 6 ? 3 : 4;
        const cloud = Number.isFinite(cloudPct) ? cloudPct : DEFAULT_CLOUD_PCT;
        if (sunElevDeg > 0) {
            let level = sunElevDeg > 60 ? 3 : sunElevDeg > 35 ? 2 : 1;      // 3 сильная, 2 умеренная, 1 слабая радиация
            if (cloud >= 87.5) level -= 1;                                   // сплошная облачность ослабляет нагрев
            if (level <= 0) return 'D';
            const table = {
                3: ['A', 'B', 'B', 'C', 'C'],
                2: ['B', 'B', 'C', 'D', 'D'],
                1: ['B', 'C', 'C', 'D', 'D']
            };
            return table[level][band];
        }
        if (cloud >= 50) return ['E', 'E', 'D', 'D', 'D'][band];
        return ['F', 'F', 'E', 'D', 'D'][band];
    }

    // Три группы для текста интерфейса: unstable, neutral, stable.
    function stabilityGroup(cls) {
        if (cls === 'A' || cls === 'B') return 'unstable';
        if (cls === 'C' || cls === 'D') return 'neutral';
        return 'stable';
    }

    // ===== Поле ветра =====

    function floorToHourMs(ms) {
        return Math.floor(ms / 3600000) * 3600000;
    }

    function gridPoints() {
        const lats = [];
        const lons = [];
        for (let lat = GRID.latMin; lat <= GRID.latMax + 1e-9; lat += GRID.latStep) lats.push(lat);
        for (let lon = GRID.lonMin; lon <= GRID.lonMax + 1e-9; lon += GRID.lonStep) lons.push(lon);
        const points = [];
        lats.forEach((lat) => lons.forEach((lon) => points.push([lat, lon])));
        return { lats, lons, points };
    }

    function buildGridUrls() {
        const { points } = gridPoints();
        const urls = [];
        for (let i = 0; i < points.length; i += CHUNK_SIZE) {
            const chunk = points.slice(i, i + CHUNK_SIZE);
            const params = new URLSearchParams({
                latitude: chunk.map((p) => p[0]).join(','),
                longitude: chunk.map((p) => p[1]).join(','),
                hourly: 'wind_speed_10m,wind_direction_10m,cloud_cover',
                wind_speed_unit: 'ms',
                timezone: 'GMT',
                past_hours: String(PAST_HOURS),
                forecast_hours: String(FORECAST_HOURS)
            });
            urls.push(`${API_URL}?${params.toString()}`);
        }
        return urls;
    }

    // Заполняет пропуски (null) ближайшими по времени значениями. Если значений нет совсем, ошибка.
    function fillGaps(series, what) {
        const out = series.slice();
        let last = null;
        for (let i = 0; i < out.length; i++) {
            if (typeof out[i] === 'number' && Number.isFinite(out[i])) last = out[i]; else if (last !== null) out[i] = last;
        }
        let next = null;
        for (let i = out.length - 1; i >= 0; i--) {
            if (typeof out[i] === 'number' && Number.isFinite(out[i])) next = out[i]; else if (next !== null) out[i] = next;
        }
        if (out.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new Error('Нет данных: ' + what);
        return out;
    }

    // responses: массив объектов по одной точке, в том же порядке, что gridPoints().points.
    function gridFromOpenMeteo(responses, nowMs) {
        const { lats, lons, points } = gridPoints();
        if (!Array.isArray(responses) || responses.length !== points.length) throw new Error('Неверное число точек в ответе');
        let times = null;
        const u = [];
        const v = [];
        const cloud = [];
        responses.forEach((r, idx) => {
            const h = r && r.hourly;
            if (!h || !Array.isArray(h.time)) throw new Error('В ответе нет hourly');
            if (times === null) times = h.time; else if (times.length !== h.time.length || times[0] !== h.time[0]) throw new Error('Время в точках не совпадает');
            const speed = fillGaps(h.wind_speed_10m || [], 'скорость ветра');
            const dir = fillGaps(h.wind_direction_10m || [], 'направление ветра');
            const cl = fillGaps(h.cloud_cover || [], 'облачность');
            if (speed.length !== times.length || dir.length !== times.length || cl.length !== times.length) throw new Error('Длина рядов не совпадает');
            const pu = [];
            const pv = [];
            for (let i = 0; i < times.length; i++) {
                const c = componentsFromWind(Math.max(0, speed[i]), dir[i]);
                pu.push(Math.round(c.u * 10));
                pv.push(Math.round(c.v * 10));
            }
            u.push(pu);
            v.push(pv);
            cloud.push(cl.map((x) => Math.round(Math.min(100, Math.max(0, x)))));
            if (idx === 0 && times.length < 2) throw new Error('Слишком короткий ряд');
        });
        const startMs = Date.parse(times[0] + 'Z');
        if (!Number.isFinite(startMs)) throw new Error('Неверное время начала ряда');
        for (let i = 1; i < times.length; i++) {
            if (Date.parse(times[i] + 'Z') - startMs !== i * 3600000) throw new Error('Ряд времени не почасовой');
        }
        return {
            version: 1,
            source: 'Open-Meteo.com (CC BY 4.0)',
            generated: new Date(nowMs === undefined ? Date.now() : nowMs).toISOString(),
            start: new Date(startMs).toISOString(),
            hours: times.length,
            lats, lons, u, v, cloud
        };
    }

    // Проверяет объект, пришедший из файла или от API-слоя, и возвращает его с числовыми полями времени.
    function validateGrid(obj) {
        if (!obj || obj.version !== 1 || !Array.isArray(obj.lats) || !Array.isArray(obj.lons)) throw new Error('Неверный формат данных');
        const n = obj.lats.length * obj.lons.length;
        const hours = obj.hours;
        if (!Number.isInteger(hours) || hours < 24 || n < 4) throw new Error('Неверный размер данных');
        ['u', 'v', 'cloud'].forEach((k) => {
            if (!Array.isArray(obj[k]) || obj[k].length !== n) throw new Error('Неверное число точек: ' + k);
            for (let i = 0; i < n; i++) {
                if (!Array.isArray(obj[k][i]) || obj[k][i].length !== hours) throw new Error('Неверная длина ряда: ' + k);
            }
        });
        const startMs = Date.parse(obj.start);
        const generatedMs = Date.parse(obj.generated);
        if (!Number.isFinite(startMs) || !Number.isFinite(generatedMs)) throw new Error('Неверное время в данных');
        return Object.assign({}, obj, { startMs, generatedMs });
    }

    function clamp(x, lo, hi) {
        return Math.min(hi, Math.max(lo, x));
    }

    // Поле ветра по сетке: билинейно по пространству, линейно по времени. За границей берется ближайшее значение.
    function makeGridField(grid) {
        const g = grid.startMs === undefined ? validateGrid(grid) : grid;
        const nLat = g.lats.length;
        const nLon = g.lons.length;
        const latStep = (g.lats[nLat - 1] - g.lats[0]) / (nLat - 1);
        const lonStep = (g.lons[nLon - 1] - g.lons[0]) / (nLon - 1);
        const endMs = g.startMs + (g.hours - 1) * 3600000;
        function sample(lat, lon, tMs) {
            const ft = clamp((tMs - g.startMs) / 3600000, 0, g.hours - 1);
            const t0 = Math.floor(ft);
            const t1 = Math.min(t0 + 1, g.hours - 1);
            const wt = ft - t0;
            const fy = clamp((lat - g.lats[0]) / latStep, 0, nLat - 1);
            const fx = clamp((lon - g.lons[0]) / lonStep, 0, nLon - 1);
            const y0 = Math.floor(fy);
            const x0 = Math.floor(fx);
            const y1 = Math.min(y0 + 1, nLat - 1);
            const x1 = Math.min(x0 + 1, nLon - 1);
            const wy = fy - y0;
            const wx = fx - x0;
            const idx = [y0 * nLon + x0, y0 * nLon + x1, y1 * nLon + x0, y1 * nLon + x1];
            const wgt = [(1 - wy) * (1 - wx), (1 - wy) * wx, wy * (1 - wx), wy * wx];
            const out = { u: 0, v: 0, cloud: 0 };
            for (let k = 0; k < 4; k++) {
                const a = (1 - wt);
                out.u += wgt[k] * (g.u[idx[k]][t0] * a + g.u[idx[k]][t1] * wt);
                out.v += wgt[k] * (g.v[idx[k]][t0] * a + g.v[idx[k]][t1] * wt);
                out.cloud += wgt[k] * (g.cloud[idx[k]][t0] * a + g.cloud[idx[k]][t1] * wt);
            }
            out.u /= 10;
            out.v /= 10;
            return out;
        }
        return { kind: 'grid', startMs: g.startMs, endMs, generatedMs: g.generatedMs, sample };
    }

    // Одинаковый ветер везде и всегда (режим «свой ветер» и запасной режим без сетки).
    function makeUniformField(speed, fromDeg, cloudPct) {
        const c = componentsFromWind(speed, fromDeg);
        const cloud = Number.isFinite(cloudPct) ? cloudPct : DEFAULT_CLOUD_PCT;
        return { kind: 'uniform', startMs: -Infinity, endMs: Infinity, generatedMs: null, sample: () => ({ u: c.u, v: c.v, cloud }) };
    }

    function windAt(field, lat, lon, tMs) {
        const s = field.sample(lat, lon, tMs);
        const w = windFromComponents(s.u, s.v);
        return { speed: w.speed, fromDeg: w.fromDeg, cloud: s.cloud };
    }

    // ===== Траектория и полоса облака =====

    function advance(pos, u, v, dtSec) {
        const dist = Math.hypot(u, v) * dtSec;
        if (dist < 1e-6) return pos;
        return destinationPoint(pos, normalizeAngle(Math.atan2(u, v) / RAD), dist);
    }

    // Путь частицы от источника. Каждая точка: p (широта, долгота), t (секунды от аварии), speed (м/с),
    // cls (класс устойчивости на отрезке), alpha (полуугол, градусы), wCore и wOuter (полуширина полосы, метры).
    function tracePath(field, origin, startMs, horizonSec, stepSec) {
        const step = stepSec || PATH_STEP_S;
        const n = Math.max(1, Math.floor(horizonSec / step));
        const path = [{ p: origin, t: 0, speed: 0, cls: null, alpha: 0, wCore: 0, wOuter: 0 }];
        let pos = origin;
        let wCore = 0;
        let wOuter = 0;
        for (let k = 0; k < n; k++) {
            const t0 = startMs + k * step * 1000;
            const s1 = field.sample(pos[0], pos[1], t0);
            const p1 = advance(pos, s1.u, s1.v, step);
            const s2 = field.sample(p1[0], p1[1], t0 + step * 1000);
            const u = (s1.u + s2.u) / 2;
            const v = (s1.v + s2.v) / 2;
            const next = advance(pos, u, v, step);
            const ds = distanceBetween(pos, next);
            const speed = Math.hypot(u, v);
            const mid = [(pos[0] + next[0]) / 2, (pos[1] + next[1]) / 2];
            const elev = solarElevationDeg(mid[0], mid[1], t0 + step * 500);
            const cls = stabilityClass(speed, elev, (s1.cloud + s2.cloud) / 2);
            const alpha = HALF_ANGLE_BY_CLASS[cls];
            wCore += ds * Math.tan(alpha * RAD);
            wOuter += ds * Math.tan((alpha + AXIS_UNCERTAINTY_DEG) * RAD);
            path.push({ p: next, t: (k + 1) * step, speed, cls, alpha, wCore, wOuter });
            pos = next;
        }
        path[0].cls = path[1].cls;
        path[0].alpha = path[1].alpha;
        path[0].speed = path[1].speed;
        return path;
    }

    function pathLengthM(path) {
        let total = 0;
        for (let i = 1; i < path.length; i++) total += distanceBetween(path[i - 1].p, path[i].p);
        return total;
    }

    // Точка пути в момент sec (линейная интерполяция между узлами). cls берется у ближайшего правого узла.
    function pointAtElapsed(path, sec) {
        const step = path[1] ? path[1].t - path[0].t : PATH_STEP_S;
        const f = clamp(sec / step, 0, path.length - 1);
        const i = Math.min(Math.floor(f), path.length - 2 < 0 ? 0 : path.length - 2);
        const a = path[i];
        const b = path[Math.min(i + 1, path.length - 1)];
        const w = a === b ? 0 : clamp(f - i, 0, 1);
        return {
            p: [a.p[0] + (b.p[0] - a.p[0]) * w, a.p[1] + (b.p[1] - a.p[1]) * w],
            wCore: a.wCore + (b.wCore - a.wCore) * w,
            wOuter: a.wOuter + (b.wOuter - a.wOuter) * w,
            cls: b.cls || a.cls,
            alpha: b.alpha || a.alpha,
            speed: b.speed || a.speed,
            index: i
        };
    }

    // Многоугольники для рисования: ядро (core) и с запасом на ошибку направления (outer) к моменту sec.
    function plumePolygons(path, sec) {
        const step = path[1] ? path[1].t - path[0].t : PATH_STEP_S;
        const last = Math.min(path.length - 1, Math.floor(clamp(sec, 0, (path.length - 1) * step) / step));
        const nodes = path.slice(0, last + 1).map((n) => ({ p: n.p, wCore: n.wCore, wOuter: n.wOuter }));
        const tail = pointAtElapsed(path, sec);
        if (last < path.length - 1 && sec > last * step) nodes.push({ p: tail.p, wCore: tail.wCore, wOuter: tail.wOuter });
        if (nodes.length < 2) {
            const o = nodes[0].p;
            return { core: [o, o, o], outer: [o, o, o] };
        }
        const heading = (i) => {
            const a = nodes[Math.max(0, i - 1)].p;
            const b = nodes[Math.min(nodes.length - 1, i + 1)].p;
            return initialBearing(a, b);
        };
        const build = (key) => {
            const left = [];
            const right = [];
            nodes.forEach((n, i) => {
                const h = heading(i);
                left.push(destinationPoint(n.p, h - 90, n[key]));
                right.push(destinationPoint(n.p, h + 90, n[key]));
            });
            return left.concat(right.reverse());
        };
        return { core: build('wCore'), outer: build('wOuter') };
    }

    // Первый момент (секунды от аварии), когда полоса накрывает точку. null, если не накрывает за весь путь.
    // kind: 'core' или 'outer'. Полоса состоит из трапеций по отрезкам пути: точка накрыта, если ее проекция
    // попадает на отрезок, а расстояние до оси не больше полуширины в этом месте. Голова облака плоская,
    // как у конуса. Мелкие щели на внешней стороне изгибов (порядка шага пути) не учитываются.
    function firstCoverage(path, point, kind) {
        const key = kind === 'outer' ? 'wOuter' : 'wCore';
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i + 1];
            const cosLat = Math.cos(a.p[0] * RAD);
            const mPerDeg = EARTH_RADIUS_M * RAD;
            const bx = (b.p[1] - a.p[1]) * cosLat * mPerDeg;
            const by = (b.p[0] - a.p[0]) * mPerDeg;
            const len2 = bx * bx + by * by;
            if (len2 < 1e-6) continue;
            const px = (point[1] - a.p[1]) * cosLat * mPerDeg;
            const py = (point[0] - a.p[0]) * mPerDeg;
            const lam = (px * bx + py * by) / len2;
            if (lam < 0 || lam > 1) continue;
            const dx = px - bx * lam;
            const dy = py - by * lam;
            const width = a[key] + (b[key] - a[key]) * lam;
            if (Math.hypot(dx, dy) <= width) return a.t + (b.t - a.t) * lam;
        }
        return null;
    }

    // Сценарий: траектория и время прибытия для набора точек. startMs это момент аварии (мс).
    function buildScenario(field, startMs, targets) {
        const available = field.endMs === Infinity ? MAX_HORIZON_HOURS * 3600 : Math.floor((field.endMs - startMs) / 1000);
        const horizonSec = Math.max(PATH_STEP_S * 12, Math.min(MAX_HORIZON_HOURS * 3600, available));
        const path = tracePath(field, NPP_COORDS, startMs, horizonSec, PATH_STEP_S);
        const arrivals = {};
        (targets || []).forEach((t) => {
            const sec = firstCoverage(path, t.coords, 'core');
            if (sec !== null) arrivals[t.id] = sec;
        });
        return { field, startMs, horizonSec, path, arrivals, lengthM: pathLengthM(path) };
    }

    // Ответ на вопрос «где я»: накрывает ли ядро, только запас или нет. Времена в секундах от аварии.
    function locationResult(scenario, point) {
        const core = firstCoverage(scenario.path, point, 'core');
        const outer = core === null ? firstCoverage(scenario.path, point, 'outer') : null;
        return {
            status: core !== null ? 'core' : (outer !== null ? 'outer' : 'none'),
            seconds: core !== null ? core : outer,
            distanceM: distanceBetween(NPP_COORDS, point)
        };
    }

    // ===== Загрузка данных (fetchFn: fetch) =====

    function withTimeout(fetchFn, url, ms) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
        return fetchFn(url, controller ? { signal: controller.signal } : undefined)
            .then((res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .finally(() => { if (timer) clearTimeout(timer); });
    }

    // Готовый файл с сетки (ветка data репозитория, обновляется раз в час). Устаревший файл отвергается.
    async function fetchStaticGrid(fetchFn, nowMs, url, timeoutMs) {
        const json = await withTimeout(fetchFn, url || DATA_URL, timeoutMs || 6000);
        const grid = validateGrid(json);
        const now = nowMs === undefined ? Date.now() : nowMs;
        if (now - grid.generatedMs > DATA_MAX_AGE_MS) throw new Error('Файл данных устарел');
        if (grid.startMs + (grid.hours - 1) * 3600000 < now + 24 * 3600000) throw new Error('Файл данных слишком короткий');
        return grid;
    }

    // Запрос к Open-Meteo напрямую, блоками по CHUNK_SIZE точек.
    async function fetchDirectGrid(fetchFn, nowMs, timeoutMs) {
        const urls = buildGridUrls();
        const parts = await Promise.all(urls.map((u) => withTimeout(fetchFn, u, timeoutMs || 15000)));
        const flat = [];
        parts.forEach((p) => (Array.isArray(p) ? p : [p]).forEach((r) => flat.push(r)));
        return validateGrid(gridFromOpenMeteo(flat, nowMs));
    }

    const api = {
        EARTH_RADIUS_M, NPP_COORDS, GRID, PAST_HOURS, FORECAST_HOURS, CHUNK_SIZE, PATH_STEP_S, MAX_HORIZON_HOURS,
        AXIS_UNCERTAINTY_DEG, HALF_ANGLE_BY_CLASS, DATA_URL, DATA_MAX_AGE_MS, API_URL,
        normalizeAngle, windToBearing, destinationPoint, distanceBetween, initialBearing,
        windFromComponents, componentsFromWind, solarElevationDeg, stabilityClass, stabilityGroup,
        floorToHourMs, gridPoints, buildGridUrls, gridFromOpenMeteo, validateGrid, makeGridField, makeUniformField, windAt,
        tracePath, pathLengthM, pointAtElapsed, plumePolygons, firstCoverage, buildScenario, locationResult,
        fetchStaticGrid, fetchDirectGrid
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BelaesModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
