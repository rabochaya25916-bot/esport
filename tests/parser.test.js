// Тесты используют синтетический HTML-фикстур в памяти и отдельную БД ':memory:' —
// тестовые данные никогда не попадают в рабочую базу data/esports.db.
const test = require('node:test');
const assert = require('node:assert');
const bo3 = require('../src/parser/bo3');
const { openDb } = require('../src/database/db');
const { runSync } = require('../src/services/sync');

const html = `<html><script>window.__NUXT__=(function(a){return {data:{list:{data:[{id:1,slug:"x-vs-y",status:"current",start_date:"2026-01-01T10:00:00Z",bo_type:3,tier:"s",
team1_id:10,team2_id:20,team1_score:1,team2_score:0,games:[{number:1,status:"finished",map_name:"de_nuke"}],
team1:{id:10,slug:"x",name:"X",image_url:"https://files.bo3.gg/x.png"},team2:{id:20,slug:"y",name:"Y",image_url:null},
tournament:{id:5,slug:"t",name:"Cup",tier:"s",prize:1000}}]},
news:{results:[{id:7,slug:"n",title:"News",published_at:"2026-01-01",news_category_id:1,title_image_url:null,
tags:[{players:[{id:3,slug:"p",nickname:"Pro",discipline_id:a,is_coach:false,team_id:10,country:{code:"FR",name:"France"}}]}],
author:{id:9,nickname:"Author"}}]}}}})(1)</script></html>`;

test('robots: /api/ запрещён, страницы матчей разрешены', () => {
  const r = bo3.parseRobots('User-agent: *\nDisallow: /api/\nDisallow: */matches/*/*/*\nUser-agent: Bad\nDisallow: /');
  assert.equal(bo3.robotsAllows(r, '/api/v1/matches'), false);
  assert.equal(bo3.robotsAllows(r, '/matches/current'), true);
  assert.equal(bo3.robotsAllows(r, '/dota2/matches/finished'), true);
});

test('статусы источника сопоставляются', () => {
  assert.equal(bo3.mapStatus('current'), 'live');
  assert.equal(bo3.mapStatus('upcoming'), 'upcoming');
  assert.equal(bo3.mapStatus('finished'), 'finished');
});

test('извлечение матчей, команд, игроков, статей; авторы не считаются игроками', () => {
  const d = bo3.extractFromHtml(html, 'cs2', 'https://bo3.gg');
  assert.equal(d.matches.length, 1);
  assert.equal(d.matches[0].status, 'live');
  assert.deepEqual(d.matches[0].teams, [{ team_source_id: 10, score: 1 }, { team_source_id: 20, score: 0 }]);
  assert.equal(d.teams.find((t) => t.source_id === 20).image_url, null); // логотип не выдумывается
  assert.deepEqual(d.players.map((p) => p.nickname), ['Pro']);
  assert.equal(d.articles.length, 1);
});

test('повторная синхронизация не создаёт дубликатов', async () => {
  const db = openDb(':memory:');
  const fetcher = async (u) => (u.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /api/' : html);
  const r1 = await runSync(db, { fetcher, delayMs: 0, detailLimit: 0, profiles: false, base: 'https://bo3.gg' });
  await runSync(db, { fetcher, delayMs: 0, detailLimit: 0, profiles: false, base: 'https://bo3.gg' });
  assert.equal(r1.status, 'success');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM matches WHERE game_code='cs2'").get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sync_runs').get().c, 2);
});

test('ошибки страниц пишутся в журнал, статус partial', async () => {
  const db = openDb(':memory:');
  const fetcher = async (u) => { if (u.endsWith('robots.txt')) return ''; if (u.includes('/lol/')) throw new Error('HTTP 500'); return html; };
  const r = await runSync(db, { fetcher, delayMs: 0, detailLimit: 0, profiles: false, base: 'https://bo3.gg' });
  assert.equal(r.status, 'partial');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sync_errors').get().c, 3);
});
