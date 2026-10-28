// Конфиги и прицелы игроков CS2. Здесь нет выдуманных записей: добавляйте только проверенные данные
// (из публичных демо, стримов, официальных источников игрока) и указывайте источник.
//
// Формат записи:
// {
//   nickname: 's1mple',            // как в базе игроков — по нему конфиг показывается в профиле игрока
//   player_id: 123,                // необязательно: id игрока на сайте (/player/123), надёжнее никнейма
//   team: 'NAVI',                  // необязательно, для подписи на карточке и фильтра
//   team_id: 45,                   // необязательно: id команды на сайте (/team/45)
//   download_url: 'https://…',     // необязательно: ссылка на скачивание конфига у источника
//   updated: '2026-10-01',         // дата проверки
//   source: 'https://…',           // откуда взяты настройки
//   crosshair: 'CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx', // код прицела из игры
//   mouse: { dpi: 400, sens: 1.1, hz: 1000, zoom_sens: 1 },
//   video: { resolution: '1280x960', aspect: '4:3', scaling: 'Растянутое', hz: 360 },
//   viewmodel: 'viewmodel_fov 68; viewmodel_offset_x 2.5; viewmodel_offset_y 0; viewmodel_offset_z -1.5',
//   gear: { mouse: '…', monitor: '…', keyboard: '…', headset: '…' },
//   launch: '-novid -freq 360',
//   cfg: 'полный текст autoexec.cfg (необязательно)',
// }
export const PLAYER_CONFIGS = [];
