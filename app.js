// ============================================================
// 1. ЗАГРУЗКА ДАННЫХ ИЗ JSON
// ============================================================

let allPoints = [];

async function loadData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('Не удалось загрузить данные');
    const data = await response.json();
    allPoints = data.points || [];
    console.log(`✅ Загружено ${allPoints.length} точек Wi-Fi`);
    return allPoints;
  } catch (error) {
    console.error('❌ Ошибка загрузки данных:', error);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `
        <div style="color:#ff6b6b;">❌ Ошибка загрузки данных</div>
        <div style="font-size:12px;margin-top:8px;">${error.message}</div>
      `;
    }
    return [];
  }
}

// ============================================================
// 2. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================

let map;
let markers = [];
let userMarker = null;
let userLocation = null;
let currentTypeFilter = 'all';
let currentRegionFilter = 'all';
let searchQuery = '';
let currentInfoPoint = null;
let isDark = false;
let isAnimating = false;
let mapListener = null;
let zoomCheckInterval = null;

// ============================================================
// 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getFilteredPoints() {
  let filtered = allPoints;

  if (currentTypeFilter !== 'all') {
    filtered = filtered.filter(p => p.type === currentTypeFilter);
  }

  if (currentRegionFilter !== 'all') {
    filtered = filtered.filter(p => p.region === currentRegionFilter);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.org && p.org.toLowerCase().includes(q)) ||
      p.region.toLowerCase().includes(q)
    );
  }

  return filtered;
}

function createMarkerElement(point, isNeon = false) {
  const color = point.type === 'free' ? '#66ffcd' : '#ffd54f';
  const icon = point.type === 'free' ? '📶' : '🔐';

  const el = document.createElement('div');
  el.className = 'custom-marker';
  el.style.cursor = 'pointer';
  
  const neonGlow = isNeon ? `
    box-shadow: 0 0 20px ${color}, 0 0 40px ${color}, 0 0 60px ${color};
    animation: neonPulse 2s ease-in-out infinite;
  ` : '';

  el.innerHTML = `
    <div style="position:relative;width:36px;height:36px;">
      <div class="marker-ring" style="border-color:${color};"></div>
      <div class="marker-dot" style="background:${color};${neonGlow}"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:14px;pointer-events:none;z-index:1;">${icon}</div>
    </div>
  `;
  return el;
}

function createClusterElement(count) {
  const el = document.createElement('div');
  el.className = 'cluster-marker';
  el.innerHTML = `<span class="count">${count}</span><span style="font-size:8px;opacity:0.6;margin-left:2px;">точки Wi-FI</span>`;
  return el;
}

function showNotification(text) {
  const old = document.querySelector('.toast-notification');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = text;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// ============================================================
// 4. АНИМАЦИИ
// ============================================================

function animateFlyToCenter() {
  if (!map) return;
  
  const routePoints = [
    { lat: 58.3, lon: 43.3, zoom: 7.5, duration: 0.5 },
    { lat: 58.3, lon: 43.3, zoom: 8.5, duration: 1.2 },
    { lat: 58.3, lon: 43.3, zoom: 9, duration: 0.8 }
  ];

  let step = 0;

  function nextStep() {
    if (step >= routePoints.length || !map) return;
    const point = routePoints[step];
    map.update({
      location: {
        center: [point.lon, point.lat],
        zoom: point.zoom,
        duration: point.duration
      }
    });
    step++;
    setTimeout(nextStep, (point.duration * 1000) + 150);
  }

  setTimeout(nextStep, 200);
}

// Функция полёта к конкретной точке (с эффектом "нырка")
function flyToPoint(lat, lon, zoomLevel = 17) {
  if (!map) return;
  
  map.update({
    location: {
      center: [lon, lat],
      zoom: zoomLevel - 4,
      duration: 0.6
    }
  });
  
  setTimeout(() => {
    map.update({
      location: {
        center: [lon, lat],
        zoom: zoomLevel,
        duration: 1.0
      }
    });
  }, 700);
}

// Эффект полёта по маршруту
function startFlightAnimation() {
  if (isAnimating) return;
  isAnimating = true;

  const flightPoints = [
    { lat: 58.3, lon: 43.3, label: '📍 Костромская область' },
    { lat: 58.4, lon: 42.9, label: '📍 Антропово' },
    { lat: 58.5, lon: 41.6, label: '📍 Буй' },
    { lat: 58.6, lon: 42.3, label: '📍 Галич' },
    { lat: 58.4, lon: 43.4, label: '📍 Парфеньево' },
    { lat: 58.9, lon: 43.4, label: '📍 Чухлома' },
    { lat: 58.3, lon: 43.3, label: '📍 Костромская область' }
  ];

  let index = 0;
  const { YMapMarker } = window.ymaps3;
  let flightMarker = null;

  function showFlightPoint() {
    if (index >= flightPoints.length) {
      if (flightMarker) {
        try { map.removeChild(flightMarker); } catch(e) {}
        flightMarker = null;
      }
      isAnimating = false;
      const btn = document.getElementById('flightBtn');
      if (btn) btn.textContent = '✈️ Полет по области';
      return;
    }

    const point = flightPoints[index];
    map.update({
      location: {
        center: [point.lon, point.lat],
        zoom: 10,
        duration: 1.5
      }
    });

    if (flightMarker) {
      try { map.removeChild(flightMarker); } catch(e) {}
    }

    const el = document.createElement('div');
    el.style.cssText = `
      background: rgba(76, 201, 240, 0.9);
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(76, 201, 240, 0.5);
      animation: flyIn 0.5s ease;
      white-space: nowrap;
    `;
    el.textContent = point.label;

    flightMarker = new YMapMarker(
      { coordinates: [point.lon, point.lat] },
      el
    );
    map.addChild(flightMarker);

    index++;
    setTimeout(showFlightPoint, 2500);
  }

  const btn = document.getElementById('flightBtn');
  if (btn) btn.textContent = '✈️ В полёте...';
  showFlightPoint();
}

// ============================================================
// 5. TAP TO ADD
// ============================================================

function setupTapToAdd() {
  if (!map) return;

  if (mapListener) {
    try { map.removeChild(mapListener); } catch(e) {}
    mapListener = null;
  }

  const { YMapListener } = window.ymaps3;

  mapListener = new YMapListener({
    onClick: (event) => {
      if (event && event.coordinates) {
        const coords = event.coordinates;
        if (coords && coords.length === 2) {
          addMarkerAtClick([coords[1], coords[0]]);
        }
      }
    }
  });

  map.addChild(mapListener);
  console.log('✅ Tap to Add активирован');
}

function addMarkerAtClick(coords) {
  const point = {
    id: 'custom-' + Date.now(),
    title: `📍 Метка ${Date.now().toString().slice(-4)}`,
    address: `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}`,
    lat: coords[1],
    lon: coords[0],
    region: 'Пользовательская',
    type: 'free',
    speed: '100 Мбит/с',
    org: 'Добавлено вручную',
    isCustom: true
  };

  allPoints.push(point);
  renderMarkers();
  showNotification('✅ Метка добавлена!');
  
  setTimeout(() => {
    if (map) {
      flyToPoint(point.lat, point.lon, 18);
    }
  }, 300);
}

// ============================================================
// 6. РЕНДЕРИНГ МАРКЕРОВ
// ============================================================

function renderMarkers() {
  if (!map) return;

  const filtered = getFilteredPoints();

  markers.forEach(m => {
    try { map.removeChild(m); } catch (e) {}
  });
  markers = [];

  updateStats();

  if (filtered.length === 0) {
    renderPointsList(filtered);
    return;
  }

  const { YMapMarker } = window.ymaps3;

  let currentZoom = 8;
  try {
    if (map.location && map.location.zoom !== undefined) {
      currentZoom = map.location.zoom;
    }
  } catch (e) {}

  const clusters = [];
  const clusterDistance = currentZoom > 10 ? 0.02 : currentZoom > 8 ? 0.05 : 0.1;

  filtered.forEach(point => {
    let added = false;
    for (let cluster of clusters) {
      const dist = getDistance(cluster.lat, cluster.lon, point.lat, point.lon);
      if (dist < clusterDistance) {
        cluster.points.push(point);
        cluster.lat = (cluster.lat * (cluster.points.length - 1) + point.lat) / cluster.points.length;
        cluster.lon = (cluster.lon * (cluster.points.length - 1) + point.lon) / cluster.points.length;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({ lat: point.lat, lon: point.lon, points: [point] });
    }
  });

  clusters.forEach(cluster => {
    if (cluster.points.length === 1) {
      const point = cluster.points[0];
      const isCustom = point.isCustom || false;
      const el = createMarkerElement(point, isCustom);
      const marker = new YMapMarker(
        { coordinates: [point.lon, point.lat] },
        el
      );

      el.onclick = () => {
        showInfoPanel(point);
        flyToPoint(point.lat, point.lon, 17);
      };

      map.addChild(marker);
      markers.push(marker);
    } else {
      const el = createClusterElement(cluster.points.length);
      const marker = new YMapMarker(
        { coordinates: [cluster.lon, cluster.lat] },
        el
      );

      el.onclick = () => {
        map.update({
          location: {
            center: [cluster.lon, cluster.lat],
            zoom: Math.min(currentZoom + 3, 18),
            duration: 0.6
          }
        });
      };

      map.addChild(marker);
      markers.push(marker);
    }
  });

  renderPointsList(filtered);
}

// ============================================================
// 7. СТАТИСТИКА
// ============================================================

function updateStats() {
  const filtered = getFilteredPoints();
  const total = filtered.length;
  const free = filtered.filter(p => p.type === 'free').length;
  const regionsCount = new Set(filtered.map(p => p.region)).size;
  const freePercent = total > 0 ? Math.round((free / total) * 100) : 0;

  const totalEl = document.getElementById('totalCount');
  const freeEl = document.getElementById('freeCount');
  const percentEl = document.getElementById('freePercent');
  const regionEl = document.getElementById('regionCount');

  if (totalEl) totalEl.textContent = total;
  if (freeEl) freeEl.textContent = free;
  if (percentEl) percentEl.textContent = freePercent + '%';
  if (regionEl) regionEl.textContent = regionsCount;
}

// ============================================================
// 8. СПИСОК ТОЧЕК
// ============================================================

function renderPointsList(points) {
  const container = document.getElementById('pointsList');
  if (!container) return;
  container.innerHTML = '';

  if (points.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#8892b0;padding:20px;font-size:13px;">Точки не найдены</div>';
    return;
  }

  let sorted = [...points];
  if (userLocation) {
    sorted.sort((a, b) => {
      const da = getDistance(userLocation.lat, userLocation.lon, a.lat, a.lon);
      const db = getDistance(userLocation.lat, userLocation.lon, b.lat, b.lon);
      return da - db;
    });
  }

  const display = sorted.slice(0, 15);

  display.forEach(point => {
    const card = document.createElement('div');
    card.className = 'point-card';

    const dist = userLocation ? getDistance(userLocation.lat, userLocation.lon, point.lat, point.lon) : null;
    const distText = dist !== null ? (dist < 1 ? `${Math.round(dist * 1000)} м` : `${dist.toFixed(1)} км`) : '';
    const isCustom = point.isCustom ? '⭐ ' : '';

    card.innerHTML = `
      <div>
        <div class="name">${isCustom}${point.title}</div>
        <div class="meta">
          <span>${point.region}</span>
          <span class="badge-sm ${point.type === 'free' ? 'free' : 'auth'}">${point.type === 'free' ? '🟢 Бесплатный' : '🟡 По запросу'}</span>
          ${point.org ? `<span>${point.org}</span>` : ''}
          ${point.isCustom ? `<span style="color:#4cc9f0;">✨ Пользовательская</span>` : ''}
        </div>
      </div>
      ${distText ? `<div class="distance">📍 ${distText}</div>` : ''}
    `;

    card.addEventListener('click', () => {
      if (map) {
        flyToPoint(point.lat, point.lon, 17);
      }
      showInfoPanel(point);
    });

    container.appendChild(card);
  });

  if (sorted.length > 15) {
    const more = document.createElement('div');
    more.style.cssText = 'text-align:center;color:#8892b0;padding:6px;font-size:11px;';
    more.textContent = `+ ещё ${sorted.length - 15} точек`;
    container.appendChild(more);
  }
}

// ============================================================
// 9. ИНФОРМАЦИОННАЯ ПАНЕЛЬ
// ============================================================

const infoPanel = document.getElementById('infoPanel');

function showInfoPanel(point) {
  currentInfoPoint = point;
  const titleEl = document.getElementById('infoTitle');
  const addressEl = document.getElementById('infoAddress');
  const regionEl = document.getElementById('infoRegion');
  const speedEl = document.getElementById('infoSpeed');
  const typeEl = document.getElementById('infoType');
  const orgEl = document.getElementById('infoOrg');
  const badge = document.getElementById('infoBadge');

  if (titleEl) titleEl.textContent = point.isCustom ? '⭐ ' + point.title : point.title;
  if (addressEl) addressEl.textContent = point.address;
  if (regionEl) regionEl.textContent = point.region;
  if (speedEl) speedEl.textContent = point.speed;
  if (typeEl) typeEl.textContent = point.type === 'free' ? 'Бесплатный' : 'По запросу';
  if (orgEl) orgEl.textContent = point.org || '—';

  if (badge) {
    const type = point.type === 'free' ? 'free' : 'paid';
    const label = point.type === 'free' ? '🟢 Бесплатный доступ' : '🟡 Доступ по запросу';
    badge.innerHTML = `<span class="badge ${type}">${label}</span>`;

    if (point.auth) {
      badge.innerHTML += `<span style="display:block;font-size:11px;color:#8892b0;margin-top:4px;">${point.auth}${point.login ? ' · ' + point.login : ''}</span>`;
    }

    if (point.isCustom) {
      badge.innerHTML += `<span style="display:block;font-size:11px;color:#4cc9f0;margin-top:4px;">✨ Добавлено вручную</span>`;
    }
  }

  if (infoPanel) infoPanel.classList.add('visible');
}

document.getElementById('closeInfo')?.addEventListener('click', () => {
  if (infoPanel) infoPanel.classList.remove('visible');
});

document.getElementById('routeBtn')?.addEventListener('click', () => {
  if (!currentInfoPoint) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const url = `https://yandex.ru/maps/?rtext=${pos.coords.latitude},${pos.coords.longitude}~${currentInfoPoint.lat},${currentInfoPoint.lon}&rtt=pedestrian`;
      window.open(url, '_blank');
    },
    () => {
      alert('Включите геолокацию для построения маршрута');
    }
  );
});

// ============================================================
// 10. ФИЛЬТРЫ
// ============================================================

function setupFilters() {
  // Фильтр по типу доступа
  document.querySelectorAll('#typeFilters .chip').forEach(chip => {
    chip.addEventListener('click', function() {
      document.querySelectorAll('#typeFilters .chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      currentTypeFilter = this.dataset.type;
      renderMarkers();
    });
  });

  // Фильтр по району
  document.querySelectorAll('#regionFilters .chip').forEach(chip => {
    chip.addEventListener('click', function() {
      document.querySelectorAll('#regionFilters .chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      currentRegionFilter = this.dataset.region;
      renderMarkers();
    });
  });

  // Сброс фильтров
  document.getElementById('resetBtn')?.addEventListener('click', () => {
    document.querySelectorAll('#typeFilters .chip').forEach(c => c.classList.remove('active'));
    const allType = document.querySelector('#typeFilters .chip[data-type="all"]');
    if (allType) allType.classList.add('active');
    currentTypeFilter = 'all';

    document.querySelectorAll('#regionFilters .chip').forEach(c => c.classList.remove('active'));
    const allRegion = document.querySelector('#regionFilters .chip[data-region="all"]');
    if (allRegion) allRegion.classList.add('active');
    currentRegionFilter = 'all';

    if (searchInput) {
      searchInput.value = '';
      searchQuery = '';
    }

    if (userMarker) {
      try { map.removeChild(userMarker); } catch (e) {}
      userMarker = null;
    }

    renderMarkers();
    if (infoPanel) infoPanel.classList.remove('visible');
  });

  // Локация
  document.getElementById('locateBtn')?.addEventListener('click', locateUser);
}

function locateUser() {
  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается в вашем браузере');
    return;
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      userLocation = { lat: latitude, lon: longitude };

      if (userMarker) {
        try { map.removeChild(userMarker); } catch (e) {}
      }

      const { YMapMarker } = window.ymaps3;
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="position:relative;width:24px;height:24px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#4cc9f0;border:3px solid white;box-shadow:0 0 30px rgba(76,201,240,0.8);"></div>
          <div style="position:absolute;top:50%;left:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;border:2px solid rgba(76,201,240,0.3);animation:pulse 2s ease-in-out infinite;"></div>
          <div style="position:absolute;top:50%;left:50%;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;border:2px solid rgba(76,201,240,0.15);animation:pulse 2s ease-in-out infinite 0.5s;"></div>
        </div>
      `;

      userMarker = new YMapMarker(
        { coordinates: [longitude, latitude] },
        el
      );
      map.addChild(userMarker);

      flyToPoint(latitude, longitude, 12);
      renderMarkers();
      showNotification('📍 Вы здесь!');
    },
    (error) => {
      let msg = 'Не удалось определить местоположение';
      if (error.code === 1) msg = 'Разрешите доступ к геолокации';
      if (error.code === 2) msg = 'Сигнал GPS слишком слабый';
      if (error.code === 3) msg = 'Таймаут определения координат';
      alert(msg);
    },
    options
  );
}

// ============================================================
// 11. ТЕМА (ДЕНЬ / НОЧЬ)
// ============================================================

function toggleTheme() {
  isDark = !isDark;

  if (isDark) {
    document.body.classList.add('dark');
    document.body.classList.remove('light');
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = '☀️';
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    document.body.classList.add('light');
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = '🌙';
    localStorage.setItem('theme', 'light');
  }

  if (window._schemeLayer) {
    window._schemeLayer.update({
      mode: isDark ? 'raster' : 'vector'
    });
  }
}

document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);

// ============================================================
// 12. ПОИСК
// ============================================================

const searchInput = document.getElementById('searchInput');
let searchTimeout;

searchInput?.addEventListener('input', function() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = this.value;
    renderMarkers();
  }, 300);
});

// ============================================================
// 13. ЗАПУСК КАРТЫ
// ============================================================

async function initMap() {
  try {
    await ymaps3.ready;

    const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer } = window.ymaps3;

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark');
      const btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = '☀️';
      isDark = true;
    } else {
      document.body.classList.add('light');
      const btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = '🌙';
      isDark = false;
    }

    map = new YMap(
      document.getElementById('map'),
      {
        location: {
          center: [43.3, 58.3],
          zoom: 8
        }
      }
    );

    const schemeLayer = new YMapDefaultSchemeLayer({
      mode: isDark ? 'raster' : 'vector'
    });
    map.addChild(schemeLayer);
    map.addChild(new YMapDefaultFeaturesLayer());

    window._schemeLayer = schemeLayer;

    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';

    // Добавляем районы в фильтр
    const regionsList = [...new Set(allPoints.map(p => p.region))].sort();
    const regionFiltersContainer = document.getElementById('regionFilters');
    if (regionFiltersContainer) {
      regionsList.forEach(region => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.region = region;
        chip.textContent = region;
        regionFiltersContainer.appendChild(chip);
      });
    }

    setupFilters();

    // Отслеживание изменения зума
    let lastZoom = 8;
    let updateTimer = null;

    if (zoomCheckInterval) {
      clearInterval(zoomCheckInterval);
    }

    zoomCheckInterval = setInterval(() => {
      if (map && map.location) {
        const currentZoom = map.location.zoom || 8;
        if (Math.abs(currentZoom - lastZoom) > 0.1) {
          lastZoom = currentZoom;
          clearTimeout(updateTimer);
          updateTimer = setTimeout(() => {
            renderMarkers();
          }, 300);
        }
      }
    }, 500);

    setupTapToAdd();
    renderMarkers();

    setTimeout(() => {
      animateFlyToCenter();
    }, 300);

    console.log('✅ Карта инициализирована');
    console.log(`📊 Всего точек: ${allPoints.length}`);

  } catch (error) {
    console.error('❌ Ошибка инициализации карты:', error);
    const mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8892b0;flex-direction:column;gap:12px;">
          <div style="font-size:24px;">⚠️</div>
          <div>Не удалось загрузить карту</div>
          <div style="font-size:12px;color:#ff6b6b;">${error.message}</div>
          <button onclick="location.reload()" style="padding:8px 20px;border-radius:8px;border:none;background:#4cc9f0;color:#0a0e1a;font-weight:600;cursor:pointer;">Обновить</button>
        </div>
      `;
    }
  }
}

// ============================================================
// 14. ЗАПУСК ПРИЛОЖЕНИЯ
// ============================================================

async function startApp() {
  await loadData();
  await initMap();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (map) map.update({});
    }, 200);
  });

  window.addEventListener('beforeunload', () => {
    if (zoomCheckInterval) {
      clearInterval(zoomCheckInterval);
    }
    if (mapListener) {
      try { map.removeChild(mapListener); } catch(e) {}
    }
  });
}

// Добавляем CSS для анимаций
const style = document.createElement('style');
style.textContent = `
  @keyframes neonPulse {
    0%, 100% {
      box-shadow: 0 0 20px var(--neon-color, #66ffcd), 0 0 40px var(--neon-color, #66ffcd);
    }
    50% {
      box-shadow: 0 0 40px var(--neon-color, #66ffcd), 0 0 80px var(--neon-color, #66ffcd), 0 0 120px var(--neon-color, #66ffcd);
    }
  }
  @keyframes flyIn {
    from {
      opacity: 0;
      transform: scale(0.5) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
`;
document.head.appendChild(style);

// Делаем функции и переменные глобальными
window.allPoints = allPoints;
window.map = map;
window.markers = markers;
window.currentInfoPoint = currentInfoPoint;
window.renderMarkers = renderMarkers;
window.showNotification = showNotification;
window.startFlightAnimation = startFlightAnimation;
window.flyToPoint = flyToPoint;

// Запускаем приложение
startApp();