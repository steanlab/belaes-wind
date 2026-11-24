/*
 * Собирает сетку ветра и облачности с Open-Meteo и пишет файл wind-grid.json.
 * Запускается раз в час из GitHub Actions (.github/workflows/update-wind.yml).
 * Использование: node tools/fetch-wind.js путь/к/wind-grid.json
 * Если данные получить не удалось, скрипт завершается с ошибкой и прежний файл в ветке data остается как был.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const M = require('../model.js');

const RETRIES = 3;

async function main() {
    const out = process.argv[2];
    if (!out) throw new Error('Укажите путь к выходному файлу');
    let lastError = null;
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
        try {
            const grid = await M.fetchDirectGrid(fetch, Date.now(), 30000);
            const json = { version: grid.version, source: grid.source, generated: grid.generated, start: grid.start, hours: grid.hours, lats: grid.lats, lons: grid.lons, u: grid.u, v: grid.v, cloud: grid.cloud };
            fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
            fs.writeFileSync(out, JSON.stringify(json));
            const kb = Math.round(fs.statSync(out).size / 1024);
            console.log(`Записано ${out}: ${grid.hours} ч, ${grid.lats.length * grid.lons.length} точек, ${kb} КБ`);
            return;
        } catch (error) {
            lastError = error;
            console.error(`Попытка ${attempt} не удалась: ${error.message}`);
            if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
    }
    throw lastError;
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
