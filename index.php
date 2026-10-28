<?php
// CyberLeague на PHP-хостинге: каждая страница получает свой настоящий адрес (/player/12, /team/5, /match/7 …)
// и уже в HTML — свои title, description, canonical, Open Graph, robots, H1 и Schema.org.
// Так ссылки правильно видят поисковики и превью в мессенджерах (они не выполняют JavaScript).
// Главная страница сайта — по-прежнему index.html: этот файл читает его и только подставляет метатеги.
// Тексты повторяют assets/js/seo-templates.js (их же браузер ставит при переходах внутри сайта).
// Данные — та же база, что загружает браузер (<meta name="data-url"> в index.html); копия хранится в data/cache
// и обновляется не чаще раза в 20 минут. Если на хостинге нет SQLite, сайт работает, а у страниц сущностей
// остаются общие метатеги раздела.

declare(strict_types=1);
const CACHE_TTL = 1200;

$ROOT = __DIR__;
$tpl = @file_get_contents($ROOT . '/index.html');
if ($tpl === false) { http_response_code(500); exit('index.html не найден'); }

// ---------- адрес страницы ----------
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/') . '/';
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$rel = strpos($uri, $base) === 0 ? substr($uri, strlen($base)) : ltrim($uri, '/');
$rel = preg_replace('~(^|/)index\.(html|php)$~', '', rawurldecode($rel));
$path = '/' . trim($rel, '/');
if ($path === '/crosshair') { header('Location: ' . rtrim($base, '/') . '/crosshairs', true, 301); exit; }

function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function metaContent($html, $name) { return preg_match('~<meta name="' . preg_quote($name, '~') . '" content="([^"]*)"~', $html, $m) ? html_entity_decode($m[1]) : ''; }

$siteUrl = rtrim(trim(metaContent($tpl, 'site-url')), '/');
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
$origin = $siteUrl ?: (($https ? 'https://' : 'http://') . preg_replace('~[^A-Za-z0-9.:\-]~', '', $_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim($base, '/'));

$brandJs = @file_get_contents($ROOT . '/assets/js/brand.js') ?: '';
$SITE = preg_match("~name:\s*'([^']+)'~", $brandJs, $m) ? $m[1] : 'CyberLeague';
$TAGLINE = preg_match("~tagline:\s*'([^']+)'~", $brandJs, $m) ? $m[1] : '';
$GN = ['cs2' => 'CS2', 'dota2' => 'Dota 2', 'lol' => 'League of Legends'];

// Разделы: тексты берутся прямо из assets/js/seo-templates.js (STATIC_PAGES), чтобы не расходились
$STATIC = [];
$tjs = @file_get_contents($ROOT . '/assets/js/seo-templates.js') ?: '';
if (preg_match_all("~'(/[a-z]+)': \['([^']*)', '([^']*)'\]~u", $tjs, $mm, PREG_SET_ORDER)) foreach ($mm as $x) $STATIC[$x[1]] = [$x[2], $x[3]];
$HOME_DESC = preg_match("~'/': \[null, '([^']*)'\]~u", $tjs, $m) ? $m[1] : metaContent($tpl, 'description');

// ---------- текстовые помощники (как в seo-templates.js) ----------
function clean($s) { return trim(preg_replace('~\s+~u', ' ', (string)$s)); }
function cut($s, $n = 160) {
  $t = clean($s); if (mb_strlen($t) <= $n) return $t;
  return preg_replace('~[\s,;:]+\S*$~u', '', mb_substr($t, 0, $n - 1)) . '…';
}
function valid($s) { $c = clean($s); return $c !== '' && !preg_match('~^(tbd|null|undefined|-+)$~i', $c); }
function listRu(array $a) { $n = count($a); return $n < 2 ? implode('', $a) : implode(', ', array_slice($a, 0, -1)) . ' и ' . $a[$n - 1]; }
function ts($d) { return $d ? strtotime((string)$d) : false; }
function ruDay($d) {
  $t = ts($d); if (!$t) return '';
  $mon = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return gmdate('j', $t) . ' ' . $mon[(int)gmdate('n', $t) - 1] . ' ' . gmdate('Y', $t);
}
function shortDay($d) { $t = ts($d); return $t ? gmdate('d.m.Y', $t) : ''; }
function isStale($d) { $t = ts($d); return !$t || time() - $t > 45 * 86400; }
function crumbsLd($crumbs, $origin) {
  if (!$crumbs) return null;
  $items = []; $i = 0;
  foreach (array_merge([['Главная', '/']], $crumbs) as $c) { $it = ['@type' => 'ListItem', 'position' => ++$i, 'name' => $c[0]]; if ($c[1]) $it['item'] = $origin . $c[1]; $items[] = $it; }
  return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $items];
}

// ---------- база ----------
function dbCachePath($root) { return $root . '/data/cache/esports.db'; }
function refreshDb($url, $file) {
  $dir = dirname($file); if (!is_dir($dir)) @mkdir($dir, 0755, true);
  $lock = @fopen($file . '.lock', 'c'); if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;
  $tmp = $file . '.tmp';
  $ctx = stream_context_create(['http' => ['timeout' => 25, 'header' => "User-Agent: CyberLeague-SEO\r\n"]]);
  $in = @fopen($url . (strpos($url, '?') === false ? '?' : '&') . 't=' . time(), 'rb', false, $ctx);
  if ($in) {
    $out = @fopen($tmp, 'wb');
    if ($out) { stream_copy_to_stream($in, $out); fclose($out); }
    fclose($in);
    if (is_file($tmp) && filesize($tmp) > 1024 && file_get_contents($tmp, false, null, 0, 15) === 'SQLite format 3') @rename($tmp, $file); else @unlink($tmp);
  }
  flock($lock, LOCK_UN); fclose($lock);
}
function openDb($root, $tpl) {
  if (!class_exists('PDO') || !in_array('sqlite', PDO::getAvailableDrivers(), true)) return null;
  $url = metaContent($tpl, 'data-url'); $file = dbCachePath($root);
  if ($url && !is_file($file)) refreshDb($url, $file);
  if (!is_file($file)) return null;
  if ($url && time() - filemtime($file) > CACHE_TTL) $GLOBALS['REFRESH_AFTER'] = [$url, $file];
  try { $db = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); return $db; }
  catch (Throwable $e) { return null; }
}
function one($db, $sql, array $a = []) { try { $st = $db->prepare($sql); $st->execute($a); $r = $st->fetch(); return $r ?: null; } catch (Throwable $e) { return null; } }

// ---------- шаблоны страниц ----------
function tPlayer($site, $f, $origin) {
  global $GN; $g = $GN[$f['game']] ?? 'CS2';
  $bio = $f['real_name'] && ($f['birthday'] || $f['country']);
  $parts = array_values(array_filter(['статистика', $bio ? 'биография' : null]));
  $title = $f['nickname'] . ($f['disambig'] ? " ({$f['disambig']})" : '') . ' — ' . listRu($parts) . " $g | $site";
  $who = implode(', ', array_filter([$f['real_name'], $f['role'], $f['country']]));
  $d = [
    $bio ? "Биография {$f['nickname']}" . ($who ? " ($who)" : '') : $f['nickname'] . ($who ? " ($who)" : '') . " — игрок $g",
    $f['team'] ? "текущая команда {$f['team']}" : 'без текущей команды в нашей базе',
    $f['matches_count'] ? "статистика по {$f['matches_count']} матчам" : 'статистика',
  ];
  $desc = cut($d[0] . ': ' . implode(', ', array_slice($d, 1)) . '.');
  $thin = !$f['team'] && !$f['matches_count'];
  $crumbs = array_merge([['Игроки', '/players']], $f['team'] && $f['team_id'] ? [[$f['team'], '/team/' . $f['team_id']]] : [], [[$f['nickname'], $f['path']]]);
  $person = ['@context' => 'https://schema.org', '@type' => 'Person', 'name' => $f['real_name'] ?: $f['nickname'], 'alternateName' => $f['nickname'], 'url' => $origin . $f['path']];
  if ($f['team']) $person['memberOf'] = ['@type' => 'SportsTeam', 'name' => $f['team']];
  return ['title' => $title, 'description' => $desc, 'h1' => $f['nickname'], 'robots' => valid($f['nickname']) && !$thin ? 'index, follow' : 'noindex, follow', 'crumbs' => $crumbs, 'jsonld' => [$person, crumbsLd($crumbs, $origin)], 'image' => $f['image'], 'type' => 'profile'];
}
function tTeam($site, $f, $origin) {
  global $GN; $g = $GN[$f['game']] ?? 'CS2';
  $title = $f['name'] . ($f['disambig'] ? " ({$f['disambig']})" : '') . ' — ' . ($f['roster_count'] ? 'состав, ' : '') . "статистика, турниры и игроки | $site";
  $roster = $f['roster_count'] ? (isStale($f['roster_synced_at']) ? "Состав {$f['name']}" . ($f['roster_synced_at'] ? ' по данным на ' . ruDay($f['roster_synced_at']) : '') : "Актуальный состав {$f['name']}") : $f['name'] . ($f['country'] ? " ({$f['country']})" : '');
  $desc = cut("$roster, статистика коллектива" . ($f['rank'] ? ", #{$f['rank']} в рейтинге" : '') . ", результаты матчей и выступления в турнирах $g. Профили игроков.");
  $crumbs = [['Команды', '/teams'], [$f['name'], $f['path']]];
  return ['title' => $title, 'description' => $desc, 'h1' => $f['name'], 'robots' => valid($f['name']) && ($f['roster_count'] || $f['matches_count']) ? 'index, follow' : 'noindex, follow', 'crumbs' => $crumbs,
    'jsonld' => [['@context' => 'https://schema.org', '@type' => 'SportsTeam', 'name' => $f['name'], 'sport' => $g, 'url' => $origin . $f['path']], crumbsLd($crumbs, $origin)], 'image' => $f['image']];
}
function tMatch($site, $f, $origin) {
  global $GN; $g = $GN[$f['game']] ?? 'CS2';
  $a = valid($f['t1']) ? $f['t1'] : 'TBD'; $b = valid($f['t2']) ? $f['t2'] : 'TBD';
  $when = ruDay($f['start_date']); $short = shortDay($f['start_date']);
  $what = $f['status'] === 'upcoming' ? 'расписание и составы' : 'счёт и статистика';
  $title = "$a — $b" . ($short ? " ($short)" : '') . ": $what матча $g | $site";
  $score = $f['s1'] !== null && $f['s2'] !== null ? "{$f['s1']}:{$f['s2']}" : null;
  $state = $f['status'] === 'finished' ? ($score ? "Матч завершён со счётом $score" : 'Матч завершён') : ($f['status'] === 'live' ? 'Матч идёт' . ($score ? ", счёт $score" : '') : 'Матч начнётся' . ($when ? " $when" : ''));
  $desc = cut("$a — $b" . ($f['tournament'] ? ", {$f['tournament']}" : '') . ($f['status'] === 'finished' && $when ? ", $when" : '') . ". $state." . ($f['maps_count'] ? " Карты ({$f['maps_count']}), составы и статистика игроков." : ' Составы и статистика игроков.'));
  $crumbs = array_merge([['Матчи', '/matches']], $f['tournament'] && $f['tournament_id'] ? [[$f['tournament'], '/tournament/' . $f['tournament_id']]] : [], [["$a — $b", $f['path']]]);
  return ['title' => $title, 'description' => $desc, 'h1' => "$a — $b", 'robots' => $a !== 'TBD' && $b !== 'TBD' ? 'index, follow' : 'noindex, follow', 'crumbs' => $crumbs, 'jsonld' => [crumbsLd($crumbs, $origin)]];
}
function tTournament($site, $f, $origin) {
  global $GN; $g = $GN[$f['game']] ?? 'CS2';
  $dates = $f['start_date'] ? ruDay($f['start_date']) . ($f['end_date'] ? ' – ' . ruDay($f['end_date']) : '') : '';
  $desc = cut("Матчи турнира {$f['name']}, участвующие команды" . ($f['teams_count'] ? " ({$f['teams_count']})" : '') . ", расписание, результаты и статистика $g." . ($dates ? " Даты: $dates." : '') . ($f['prize'] ? ' Призовой фонд $' . number_format((float)$f['prize'], 0, '.', ',') . '.' : ''));
  $crumbs = [['Турниры', '/tournaments'], [$f['name'], $f['path']]];
  return ['title' => "{$f['name']} — расписание, результаты матчей и команды | $site", 'description' => $desc, 'h1' => $f['name'], 'robots' => valid($f['name']) ? 'index, follow' : 'noindex, follow', 'crumbs' => $crumbs, 'jsonld' => [crumbsLd($crumbs, $origin)], 'image' => $f['image']];
}

// ---------- метаданные для адреса ----------
// Возвращает массив метаданных; null — объекта нет (404); false — данные недоступны (общие метатеги, без 404).
function metaFor($path) {
  global $SITE, $TAGLINE, $STATIC, $HOME_DESC, $origin, $ROOT, $tpl;
  if ($path === '/') return ['title' => "$SITE — $TAGLINE", 'description' => $HOME_DESC, 'h1' => $SITE, 'robots' => 'index, follow', 'crumbs' => [], 'jsonld' => [['@context' => 'https://schema.org', '@type' => 'WebSite', 'name' => $SITE, 'url' => $origin . '/']]];
  if (isset($STATIC[$path])) { [$t, $d] = $STATIC[$path]; $short = explode(' — ', $t)[0]; return ['title' => "$t | $SITE", 'description' => $d, 'h1' => $short, 'robots' => 'index, follow', 'crumbs' => [[$short, $path]], 'jsonld' => [crumbsLd([[$short, $path]], $origin)]]; }
  if (preg_match('~^/(search|settings|admin)(/|$)~', $path)) return ['title' => "Служебная страница | $SITE", 'description' => 'Служебная страница.', 'robots' => 'noindex, follow', 'crumbs' => []];
  if (preg_match('~^/articles/[^/]+$~', $path)) return false; // статьи: метатеги ставит сам сайт
  if (preg_match('~^/(config|crosshair)/([^/]+)$~', $path, $m)) {
    $nick = $m[2]; $isX = $m[1] === 'crosshair';
    return ['title' => ($isX ? "Прицел $nick в CS2 — код и настройки" : "Конфиг $nick в CS2 — настройки игрока") . " | $SITE", 'description' => ($isX ? "Прицел $nick в CS2: код прицела, параметры и консольные команды." : "Настройки $nick в CS2: доступные параметры мыши, видео и прицела."), 'h1' => ($isX ? 'Прицел ' : 'Конфиг ') . $nick, 'robots' => 'index, follow', 'crumbs' => [[$isX ? 'Прицелы' : 'Конфиги', $isX ? '/crosshairs' : '/configs'], [$nick, $path]]];
  }
  if (!preg_match('~^/(player|team|match|tournament)/(\d+)$~', $path, $m)) return null;
  $db = openDb($ROOT, $tpl); if (!$db) return false;
  [$kind, $id] = [$m[1], (int)$m[2]];
  if ($kind === 'player') {
    $p = one($db, 'SELECT p.*, t.id AS team_id, t.name AS team_name FROM players p LEFT JOIN teams t ON t.game_code=p.game_code AND t.source_id=p.team_source_id WHERE p.id=?', [$id]); if (!$p) return null;
    $real = clean(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
    $mc = one($db, 'SELECT COUNT(DISTINCT match_id) c FROM match_player_stats WHERE player_source_id=? AND scope_game_id=0', [$p['source_id']]);
    $dup = one($db, 'SELECT COUNT(*) c FROM players WHERE game_code=? AND lower(nickname)=lower(?)', [$p['game_code'], $p['nickname']]);
    return tPlayer($SITE, ['nickname' => $p['nickname'], 'real_name' => $real ?: null, 'team' => $p['team_name'], 'team_id' => $p['team_id'], 'game' => $p['game_code'], 'country' => $p['country_name'] ?? null,
      'role' => !empty($p['is_coach']) ? 'тренер' : null, 'birthday' => $p['birthday'] ?? null, 'matches_count' => $mc ? (int)$mc['c'] : 0, 'image' => $p['image_url'] ?? null, 'path' => "/player/$id",
      'disambig' => $dup && $dup['c'] > 1 ? ($p['team_name'] ?: ($real ?: null)) : null], $origin);
  }
  if ($kind === 'team') {
    $t = one($db, 'SELECT * FROM teams WHERE id=?', [$id]); if (!$t) return null;
    $rc = one($db, 'SELECT COUNT(*) c FROM players WHERE game_code=? AND team_source_id=?', [$t['game_code'], $t['source_id']]);
    $mc = one($db, 'SELECT COUNT(*) c FROM match_teams mt JOIN matches m ON m.id=mt.match_id WHERE m.game_code=? AND mt.team_source_id=?', [$t['game_code'], $t['source_id']]);
    $dup = one($db, 'SELECT COUNT(*) c FROM teams WHERE game_code=? AND lower(name)=lower(?)', [$t['game_code'], $t['name']]);
    return tTeam($SITE, ['name' => $t['name'], 'game' => $t['game_code'], 'country' => $t['country_name'] ?? null, 'rank' => $t['rank'] ?? null, 'roster_count' => $rc ? (int)$rc['c'] : 0,
      'roster_synced_at' => ($t['profile_synced_at'] ?? null) ?: ($t['updated_at'] ?? null), 'matches_count' => $mc ? (int)$mc['c'] : 0, 'image' => $t['image_url'] ?? null, 'path' => "/team/$id",
      'disambig' => $dup && $dup['c'] > 1 ? ($t['country_name'] ?? null) : null], $origin);
  }
  if ($kind === 'match') {
    $x = one($db, 'SELECT m.id, m.game_code, m.status, m.start_date, t.id AS tid, t.name AS tour, a.name AS t1, b.name AS t2, mt1.score AS s1, mt2.score AS s2,
        (SELECT COUNT(*) FROM match_games g WHERE g.match_id=m.id) AS maps FROM matches m
      LEFT JOIN tournaments t ON t.game_code=m.game_code AND t.source_id=m.tournament_source_id
      LEFT JOIN match_teams mt1 ON mt1.match_id=m.id AND mt1.position=1 LEFT JOIN match_teams mt2 ON mt2.match_id=m.id AND mt2.position=2
      LEFT JOIN teams a ON a.game_code=m.game_code AND a.source_id=mt1.team_source_id LEFT JOIN teams b ON b.game_code=m.game_code AND b.source_id=mt2.team_source_id WHERE m.id=?', [$id]);
    if (!$x) return null;
    $up = $x['status'] === 'upcoming';
    return tMatch($SITE, ['t1' => $x['t1'], 't2' => $x['t2'], 's1' => $up ? null : $x['s1'], 's2' => $up ? null : $x['s2'], 'status' => $x['status'], 'start_date' => $x['start_date'], 'tournament' => $x['tour'], 'tournament_id' => $x['tid'],
      'game' => $x['game_code'], 'maps_count' => (int)$x['maps'], 'path' => "/match/$id"], $origin);
  }
  $t = one($db, 'SELECT * FROM tournaments WHERE id=?', [$id]); if (!$t) return null;
  $tc = one($db, 'SELECT COUNT(*) c FROM tournament_teams WHERE game_code=? AND tournament_source_id=?', [$t['game_code'], $t['source_id']]);
  return tTournament($SITE, ['name' => $t['name'], 'game' => $t['game_code'], 'start_date' => $t['start_date'] ?? null, 'end_date' => $t['end_date'] ?? null, 'prize' => $t['prize'] ?? null, 'teams_count' => $tc ? (int)$tc['c'] : 0, 'image' => $t['image_url'] ?? null, 'path' => "/tournament/$id"], $origin);
}

$mt = metaFor($path);
$status = 200;
if ($mt === null) { $status = 404; $mt = ['title' => "Страница не найдена | $SITE", 'description' => 'Такой страницы нет или объект ещё не загружен из источника.', 'robots' => 'noindex, follow', 'crumbs' => []]; }
$generic = $mt === false;  // данные недоступны: метатеги index.html, но адрес и canonical свои

// ---------- сборка HTML ----------
$head = ['<base href="' . h($base) . '">', '<meta name="router" content="history">'];
$html = $tpl;
// Замена без обработки $1/\\1 в тексте (в описаниях бывают суммы вроде $3,000)
function rep($re, $val, $html) { return preg_replace_callback($re, fn() => $val, $html, 1); }
if (!$generic) {
  $html = rep('~<title>[^<]*</title>~', '<title>' . h($mt['title']) . '</title>', $html);
  $html = rep('~<meta name="description" content="[^"]*">~', '<meta name="description" content="' . h($mt['description']) . '">', $html);
  $html = rep('~<meta property="og:title" content="[^"]*">~', '<meta property="og:title" content="' . h($mt['title']) . '">', $html);
  $html = rep('~<meta property="og:description" content="[^"]*">~', '<meta property="og:description" content="' . h($mt['description']) . '">', $html);
  if (!empty($mt['type'])) $html = rep('~<meta property="og:type" content="[^"]*">~', '<meta property="og:type" content="' . h($mt['type']) . '">', $html);
  $head[] = '<meta name="robots" content="' . h($mt['robots']) . '">';
  if (!empty($mt['image']) && preg_match('~^https?://~', $mt['image'])) $head[] = '<meta property="og:image" content="' . h($mt['image']) . '">';
  foreach (array_filter($mt['jsonld'] ?? []) as $j) $head[] = '<script type="application/ld+json" data-ld="1">' . str_replace('<', '\u003c', json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) . '</script>';
}
if ($generic || strpos($mt['robots'], 'noindex') === false) {
  $head[] = '<link rel="canonical" href="' . h($origin . ($path === '/' ? '/' : $path)) . '">';
  $head[] = '<meta property="og:url" content="' . h($origin . ($path === '/' ? '/' : $path)) . '">';
}
// Ссылки шапки и подвала (/matches) — с папкой сайта, чтобы они работали и без JavaScript; data-route — логический адрес для роутера
$html = preg_replace_callback('~href="/([a-z]*)"~', fn($m) => 'href="' . h($base . $m[1]) . '" data-route="/' . $m[1] . '"', $html);
// Якорь «К содержимому» — на текущей странице (из-за <base> иначе вёл бы на главную)
$html = str_replace('href="#app"', 'href="' . h($uri) . '#app"', $html);
$html = str_replace('<!--SEO-->', implode("\n  ", $head), $html);
// Адрес сайта для canonical в браузере — тот же, что здесь
if (!$siteUrl) $html = str_replace('<meta name="router"', '<meta name="site-url" content="' . h($origin) . '">' . "\n  " . '<meta name="router"', $html);
if (!$generic && !empty($mt['h1'])) {
  $crumbs = '';
  if (!empty($mt['crumbs'])) { $crumbs = '<nav class="crumbs" aria-label="Навигация"><a href="' . h($base) . '">Главная</a>'; foreach ($mt['crumbs'] as $c) $crumbs .= '<a href="' . h(rtrim($base, '/') . $c[1]) . '" data-route="' . h($c[1]) . '">' . h($c[0]) . '</a>'; $crumbs .= '</nav>'; }
  $html = str_replace('<!--SSR-->', '<div class="page ssr">' . $crumbs . '<h1>' . h($mt['h1']) . '</h1><p class="lead">' . h($mt['description']) . '</p></div>', $html);
}

http_response_code($status);
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: public, max-age=0, must-revalidate');
echo $html;

// Обновление копии базы — после отправки страницы, чтобы посетитель не ждал
if (!empty($GLOBALS['REFRESH_AFTER'])) {
  if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  ignore_user_abort(true); @set_time_limit(120);
  refreshDb($GLOBALS['REFRESH_AFTER'][0], $GLOBALS['REFRESH_AFTER'][1]);
}
