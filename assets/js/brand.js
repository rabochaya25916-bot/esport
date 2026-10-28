// Название и короткие тексты бренда — в одном месте. Чтобы переименовать сайт, достаточно поменять значения здесь
// (и <title>/описание в index.html — их видят поисковики до запуска скриптов).
export const BRAND = {
  name: 'CyberLeague',
  mark: 'CL',                       // буквы в квадратном знаке шапки
  parts: ['Cyber', 'League'],       // вторая часть выделяется акцентным цветом
  tagline: 'матчи, турниры, игроки и конфиги CS2',
};

// Подставляет название во все элементы с data-brand="name|mark|tagline|logo" (шапка, подвал, служебные тексты).
export function applyBrand(root = document) {
  root.querySelectorAll('[data-brand]').forEach((el) => {
    const k = el.dataset.brand;
    if (k === 'logo') el.innerHTML = `${BRAND.parts[0]}<b>${BRAND.parts[1]}</b>`;
    else if (BRAND[k] != null) el.textContent = BRAND[k];
  });
  root.querySelectorAll('[data-brand-label]').forEach((el) => el.setAttribute('aria-label', `${BRAND.name} — ${el.dataset.brandLabel}`));
}
