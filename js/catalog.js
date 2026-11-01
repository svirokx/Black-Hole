const cards = [...document.querySelectorAll('.bh-card')];
const sections = [...document.querySelectorAll('.catalog-class')];
const filters = [...document.querySelectorAll('.filter-btn[data-filter]')];
const query = document.getElementById('catalog-search');
const sort = document.getElementById('catalog-sort');
const favoritesButton = document.getElementById('favorites-filter');
const compareToggle = document.getElementById('compare-toggle');
const compareCount = document.getElementById('compare-count');
const comparePanel = document.getElementById('compare-panel');
const favorites = new Set(JSON.parse(localStorage.getItem('blackhole-favorites') || '[]'));
const compared = new Set();
let activeCategory = 'all';
let favoritesOnly = false;

function cardName(card) { return card.querySelector('h3')?.innerText.trim() || 'Unknown'; }
function applyFilters() {
  const text = query.value.trim().toLocaleLowerCase();
  cards.forEach(card => {
    const matches = card.innerText.toLocaleLowerCase().includes(text)
      && (activeCategory === 'all' || card.dataset.category === activeCategory)
      && (!favoritesOnly || favorites.has(cardName(card)));
    card.hidden = !matches;
  });
  sections.forEach(section => {
    section.hidden = !cards.some(card => !card.hidden && section.contains(card));
  });
}
function setCategory(category) {
  activeCategory = category;
  filters.forEach(button => button.classList.toggle('active', button.dataset.filter === category));
  applyFilters();
}
filters.forEach(button => button.addEventListener('click', () => setCategory(button.dataset.filter)));
query.addEventListener('input', applyFilters);
favoritesButton.addEventListener('click', () => {
  favoritesOnly = !favoritesOnly;
  favoritesButton.setAttribute('aria-pressed', String(favoritesOnly));
  favoritesButton.classList.toggle('active', favoritesOnly);
  applyFilters();
});
sort.addEventListener('change', () => {
  const grids = [...document.querySelectorAll('.catalog-grid')];
  grids.forEach(grid => {
    const ordered = [...grid.querySelectorAll('.bh-card')];
    if (sort.value === 'name') ordered.sort((a,b) => cardName(a).localeCompare(cardName(b)));
    if (sort.value === 'mass') ordered.sort((a,b) => massValue(b) - massValue(a));
    if (sort.value === 'default') return;
    ordered.forEach(card => grid.append(card));
  });
});
function massValue(card) {
  const text = card.querySelector('.bh-stats')?.innerText || '';
  const match = text.match(/Mass:\s*([~≈]?\s*[\d.]+)\s*[×x]?\s*10?\s*([⁰¹²³⁴⁵⁶⁷⁸⁹\d]*)\s*M/i);
  if (!match) return 0;
  const base = Number(match[1].replace(/[~≈\s]/g,''));
  const powerText = match[2].replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(digit));
  return base * Math.pow(10, Number(powerText) || 0);
}
function renderCompare() {
  compareCount.textContent = compared.size;
  const selected = cards.filter(card => compared.has(card));
  comparePanel.hidden = !compareToggle.classList.contains('active') || selected.length === 0;
  if (!selected.length) { comparePanel.replaceChildren(); return; }
  const rows = [['Object', card => cardName(card)], ['Properties', card => card.querySelector('.bh-stats')?.innerText.replaceAll('\n',' · ') || '—']];
  comparePanel.innerHTML = `<h2>Сравнение объектов <button class="card-action" id="compare-close" type="button">Закрыть</button></h2><table class="compare-table"><thead><tr><th>Параметр</th>${selected.map(card => `<th>${escapeHtml(cardName(card))}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(([label, value]) => `<tr><th>${label}</th>${selected.map(card => `<td>${escapeHtml(value(card))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  comparePanel.querySelector('#compare-close').addEventListener('click', () => { compareToggle.classList.remove('active'); renderCompare(); });
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
compareToggle.addEventListener('click', () => { compareToggle.classList.toggle('active'); renderCompare(); });
cards.forEach(card => {
  const body = card.querySelector('.bh-card-body');
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const name = cardName(card);
  const favorite = document.createElement('button');
  favorite.className = 'card-action'; favorite.type = 'button';
  favorite.textContent = favorites.has(name) ? '★ В избранном' : '☆ В избранное';
  favorite.setAttribute('aria-pressed', String(favorites.has(name)));
  if (favorites.has(name)) card.classList.add('is-favorite');
  favorite.addEventListener('click', () => {
    if (favorites.has(name)) favorites.delete(name); else favorites.add(name);
    localStorage.setItem('blackhole-favorites', JSON.stringify([...favorites]));
    const active = favorites.has(name);
    favorite.textContent = active ? '★ В избранном' : '☆ В избранное';
    favorite.setAttribute('aria-pressed', String(active));
    card.classList.toggle('is-favorite', active); applyFilters();
  });
  const compareLabel = document.createElement('label'); compareLabel.className = 'card-action';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'compare-check'; checkbox.setAttribute('aria-label', `Добавить ${name} к сравнению`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked && compared.size >= 3) { checkbox.checked = false; return; }
    if (checkbox.checked) compared.add(card); else compared.delete(card);
    renderCompare();
  });
  compareLabel.append(checkbox, ' Сравнить'); actions.append(favorite, compareLabel); body.append(actions);
});
const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), {threshold:.05, rootMargin:'0px 0px -30px 0px'});
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
