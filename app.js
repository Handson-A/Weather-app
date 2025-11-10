const geoBase = 'https://geocoding-api.open-meteo.com/v1/search?name=';
const weatherBase = 'https://api.open-meteo.com/v1/forecast';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('search-form');
  const q = document.getElementById('q');
  const unitsSelect = document.getElementById('units');

  // load saved unit preference
  const saved = localStorage.getItem('weather_units') || 'metric';
  unitsSelect.value = saved;

  unitsSelect.addEventListener('change', () => {
    localStorage.setItem('weather_units', unitsSelect.value);
    //refresh it
    const loc = document.getElementById('current-location').dataset.coords;
    if (loc) {
      const [lat, lon] = loc.split(',');
      fetchAndRender(lat, lon);
    }
  });

  const unitsCustom = document.getElementById('units-custom');
  if (unitsCustom) {
    const customList = unitsCustom.querySelector('.custom-select-list');
    const customLabel = unitsCustom.querySelector('.custom-select-label');

    // populate from native select options
    Array.from(unitsSelect.options).forEach(opt => {
      const li = document.createElement('li');
      li.textContent = opt.textContent;
      li.dataset.value = opt.value;
      li.tabIndex = -1;
      if (opt.value === unitsSelect.value) {
        li.setAttribute('aria-selected', 'true');
        customLabel.textContent = opt.textContent;
      }
      customList.appendChild(li);

      li.addEventListener('click', () => {
        // update native select which triggers the existing change handler
        unitsSelect.value = li.dataset.value;
        unitsSelect.dispatchEvent(new Event('change', { bubbles: true }));
        Array.from(customList.children).forEach(ch => ch.setAttribute('aria-selected', 'false'));
        li.setAttribute('aria-selected', 'true');
        customList.hidden = true;
        unitsCustom.setAttribute('aria-expanded', 'false');
      });
    });

    if (!unitsCustom.dataset.inited) {
      unitsCustom.addEventListener('click', () => {
        const expanded = unitsCustom.getAttribute('aria-expanded') === 'true';
        if (expanded) { customList.hidden = true; unitsCustom.setAttribute('aria-expanded', 'false'); }
        else { customList.hidden = false; unitsCustom.setAttribute('aria-expanded', 'true'); const selItem = customList.querySelector('[aria-selected="true"]'); if (selItem) selItem.focus(); }
      });

      unitsCustom.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); unitsCustom.click(); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); customList.hidden = false; unitsCustom.setAttribute('aria-expanded','true'); const first = customList.querySelector('li'); if (first) first.focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); customList.hidden = false; unitsCustom.setAttribute('aria-expanded','true'); const items = customList.querySelectorAll('li'); if (items.length) items[items.length-1].focus(); }
        else if (ev.key === 'Escape') { customList.hidden = true; unitsCustom.setAttribute('aria-expanded','false'); }
      });

      customList.addEventListener('keydown', (ev) => {
        const focused = document.activeElement;
        if (ev.key === 'ArrowDown') { ev.preventDefault(); const next = focused.nextElementSibling || customList.querySelector('li'); if (next) next.focus(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); const prev = focused.previousElementSibling || customList.querySelector('li:last-child'); if (prev) prev.focus(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); focused.click(); }
        else if (ev.key === 'Escape') { customList.hidden = true; unitsCustom.setAttribute('aria-expanded','false'); unitsCustom.focus(); }
      });

      document.addEventListener('click', (e) => { if (!unitsCustom.contains(e.target)) { customList.hidden = true; unitsCustom.setAttribute('aria-expanded','false'); } });
      unitsCustom.dataset.inited = '1';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = q.value.trim();
    if (!name) return;
    form.querySelector('button').disabled = true;
    form.querySelector('button').textContent = 'Searching...';
    try {
      const geo = await geocode(name);
      if (!geo) {
        alert('No location found');
      } else {
        const {latitude, longitude, name: placeName, country} = geo;
        document.getElementById('current-location').textContent = `${placeName}, ${country}`;
        document.getElementById('current-location').dataset.coords = `${latitude},${longitude}`;
        await fetchAndRender(latitude, longitude, placeName, country);
      }
    } catch (err) {
      console.error(err);
      alert('Error searching for location. See console.');
    } finally {
      form.querySelector('button').disabled = false;
      form.querySelector('button').textContent = 'Search';
    }
  });

  // default city on first visit
  if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      fetchAndRender(latitude, longitude);
    },
    err => {
      q.value = 'Accra, Ghana';
      form.requestSubmit();
    },
    { timeout: 10000 }
  );
} else {
  // no geolocation API: fallback
  q.value = 'Accra, Ghana';
  form.requestSubmit();
}
});

async function geocode(name) {
  const url = geoBase + encodeURIComponent(name);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();

  return data && data.results && data.results[0];
}

async function fetchAndRender(lat, lon, placeName = null, country = null) {
  const units = localStorage.getItem('weather_units') || 'metric';


  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current_weather: 'true',
  hourly: 'temperature_2m,precipitation,relativehumidity_2m,windspeed_10m',
  // include daily weathercode so we can render accurate icons per day
  daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode',
    timezone: 'auto'
  });

  const url = `${weatherBase}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();


  try {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('weather_last') || 'null'); } catch(e) { stored = null; }
    if (!placeName && stored && stored.placeName && stored.lat == lat && stored.lon == lon) {
      placeName = stored.placeName;
      country = stored.country;
    }
    if (!placeName) {
      // attempt reverse geocoding to get place name

      try {
        showLocationLoader(true);
        const rev = await reverseGeocode(lat, lon);
        if (rev) {
          placeName = rev.name || placeName;
          country = rev.country || country;
        }
      } catch (e) {
        // ignore reverse geocode errors; still render numeric coordinates if needed
        console.warn('reverse geocode failed', e);
      } finally {
        showLocationLoader(false);
      }
    }

    // caching (include place name when available)
    if (!placeName) {
      // fallback friendly label when reverse geocoding didn't yield a name
      placeName = 'Your location';
      country = country || '';
    }
    localStorage.setItem('weather_last', JSON.stringify({lat, lon, placeName, country}));
  } catch (e) {
    console.warn('storing last weather failed', e);
  }


  try {
    const locEl = document.getElementById('current-location');
    if (locEl) {
      if (placeName) locEl.textContent = `${placeName}${country ? ', ' + country : ''}`;
      else locEl.textContent = `${lat}, ${lon}`;
      locEl.dataset.coords = `${lat},${lon}`;
    }
  } catch (e) { /* ignore UI update errors */ }

  renderCurrent(data, units);
  renderDaily(data, units);
  setupHourlyDaySelector(data);
  renderHourlyForSelectedDay(data, units);
}

// Reverse geocode to obtain a place name from coordinates (use Open-Meteo reverse endpoint)
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Reverse geocoding failed');
    const data = await res.json();
  
    if (data && data.name) return { name: data.name, country: data.country };
    if (data && data.results && data.results.length) {
      const r = data.results[0];
      return { name: r.name, country: r.country };
    }
    return null;
  } catch (err) {
    console.warn('reverseGeocode error', err);
    return null;
  }
}
//EL = element
function renderCurrent(data, units) {
  const cur = data.current_weather;
  const locEl = document.getElementById('current-location');
  const dateEl = document.getElementById('current-date');
  const tempEl = document.getElementById('current-temp');
  const iconEl = document.getElementById('current-icon');
  const feelsEl = document.getElementById('feels-like');
  const humEl = document.getElementById('humidity');
  const windEl = document.getElementById('wind');
  const precipEl = document.getElementById('precipitation');

  // current_weather has temperature and windspeed
  tempEl.textContent = formatTemp(cur.temperature, units);
  iconEl.textContent = weatherCodeToEmoji(cur.weathercode);
  dateEl.textContent = new Date(cur.time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  // find index of current time 
  // find the closest hourly index to the current time 
  const idx = findClosestIndex(data.hourly.time, cur.time);
  const humidity = idx >= 0 && data.hourly.relativehumidity_2m ? data.hourly.relativehumidity_2m[idx] : null;
  const precipitation = idx >= 0 && data.hourly.precipitation ? data.hourly.precipitation[idx] : null;

  const wind = idx >= 0 && data.hourly.windspeed_10m ? data.hourly.windspeed_10m[idx] : (cur.windspeed || null);

  feelsEl.textContent = formatTemp(computeFeelsLike(cur.temperature, humidity, wind), units);
  humEl.textContent = humidity !== null ? `${Math.round(humidity)}%` : '—';
  windEl.textContent = wind !== null ? formatWind(wind, units) : '—';
  precipEl.textContent = precipitation !== null ? formatPrecip(precipitation, units) : '—';
}

function renderDaily(data, units) {
  const container = document.getElementById('daily');
  container.innerHTML = '';
  const times = data.daily.time || [];
  for (let i = 0; i < times.length; i++) {
    const day = times[i];
    const tmax = data.daily.temperature_2m_max ? data.daily.temperature_2m_max[i] : null;
    const tmin = data.daily.temperature_2m_min ? data.daily.temperature_2m_min[i] : null;
    const precip = data.daily.precipitation_sum ? data.daily.precipitation_sum[i] : null;
    // prefer daily.weathercode (if provided by API); fall back to current_weather code if missing
    const code = data.daily.weathercode && data.daily.weathercode[i] != null ? data.daily.weathercode[i] : (data.current_weather && data.current_weather.weathercode ? data.current_weather.weathercode : 0);
    const el = document.createElement('div');
    el.className = 'daily-item';
    el.setAttribute('role','listitem');
    // add a tooltip description element for hover/focus
    const tooltipId = `daily-tooltip-${i}`;
    el.tabIndex = 0; // make focusable for keyboard users
    el.setAttribute('aria-describedby', tooltipId);
    el.innerHTML = `
      <div class="daily-day">${new Date(day).toLocaleDateString(undefined,{weekday:'short'})}</div>
      <div class="daily-icon">${weatherCodeToEmoji(code)}</div>
      <div class="daily-temps">${tmax != null ? formatTemp(tmax, units) : '—'} / ${tmin != null ? formatTemp(tmin, units) : '—'}</div>
      <div class="daily-tooltip" id="${tooltipId}" role="tooltip">${weatherCodeToLabel(code)}</div>
    `;
    container.appendChild(el);
  }
}

// Return a short textual label for a WMO weather code
function weatherCodeToLabel(code) {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61 || code === 63 || code === 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71 || code === 73 || code === 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code === 80 || code === 81 || code === 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95 || code === 96 || code === 99) return 'Thunderstorm';
  return 'Cloudy';
}

// Find the index in an array of ISO timestamps closest to the target ISO timestamp
function findClosestIndex(timeArray, targetIso) {
  if (!Array.isArray(timeArray) || timeArray.length === 0 || !targetIso) return -1;
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return -1;
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < timeArray.length; i++) {
    const t = Date.parse(timeArray[i]);
    if (Number.isNaN(t)) continue;
    const diff = Math.abs(t - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

function setupHourlyDaySelector(data) {
  const sel = document.getElementById('hourly-day-select');
  const custom = document.getElementById('hourly-day-custom');
  const list = custom.querySelector('.custom-select-list');
  const label = custom.querySelector('.custom-select-label');

  // clear both native select and custom list
  sel.innerHTML = '';
  list.innerHTML = '';

  const dates = Array.from(new Set(data.daily.time.map(t => t)));
  dates.forEach((d, i) => {
    const pretty = new Date(d).toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
    // native option (hidden, kept for accessibility)
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = pretty;
    sel.appendChild(opt);

    // custom list item
    const li = document.createElement('li');
    li.setAttribute('role','option');
    li.dataset.value = d;
    li.tabIndex = -1;
    li.textContent = pretty;
    list.appendChild(li);

    li.addEventListener('click', () => {
      // set native select value and trigger render
      sel.value = d;
      // update list aria-selected
      Array.from(list.children).forEach(ch => ch.setAttribute('aria-selected','false'));
      li.setAttribute('aria-selected','true');
      label.textContent = pretty;
      // close list
      list.hidden = true;
      custom.setAttribute('aria-expanded','false');
      renderHourlyForSelectedDay(data, localStorage.getItem('weather_units')||'metric');
    });
  });

  // initial selection: first day
  if (dates.length) {
    sel.value = dates[0];
    const first = list.querySelector('li');
    if (first) {
      first.setAttribute('aria-selected','true');
      first.tabIndex = 0;
      label.textContent = first.textContent;
    }
  }

  // ensure native select change still renders (keeps compatibility)
  sel.addEventListener('change', () => renderHourlyForSelectedDay(data, localStorage.getItem('weather_units')||'metric'));

  // Basic interactions for the custom element (toggle, keyboard, close-on-outside-click)
  if (!custom.dataset.inited) {
    custom.addEventListener('click', (e) => {
      const expanded = custom.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        list.hidden = true;
        custom.setAttribute('aria-expanded','false');
      } else {
        list.hidden = false;
        custom.setAttribute('aria-expanded','true');
        // focus selected item
        const selItem = list.querySelector('[aria-selected="true"]');
        if (selItem) selItem.focus();
      }
    });

    // keyboard handling
    custom.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ' ) {
        ev.preventDefault();
        custom.click();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        // open and focus first
        list.hidden = false; custom.setAttribute('aria-expanded','true');
        const first = list.querySelector('li'); if (first) first.focus();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault(); list.hidden = false; custom.setAttribute('aria-expanded','true');
        const items = list.querySelectorAll('li'); if (items.length) items[items.length-1].focus();
      } else if (ev.key === 'Escape') {
        list.hidden = true; custom.setAttribute('aria-expanded','false');
      }
    });

    // delegate keyboard navigation inside the list
    list.addEventListener('keydown', (ev) => {
      const focused = document.activeElement;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        const next = focused.nextElementSibling || list.querySelector('li');
        if (next) next.focus();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        const prev = focused.previousElementSibling || list.querySelector('li:last-child');
        if (prev) prev.focus();
      } else if (ev.key === 'Enter') {
        ev.preventDefault(); focused.click();
      } else if (ev.key === 'Escape') {
        list.hidden = true; custom.setAttribute('aria-expanded','false'); custom.focus();
      }
    });

    // click outside to close
    document.addEventListener('click', (e) => {
      if (!custom.contains(e.target)) {
        list.hidden = true; custom.setAttribute('aria-expanded','false');
      }
    });

    custom.dataset.inited = '1';
  }
}

function renderHourlyForSelectedDay(data, units) {
  const sel = document.getElementById('hourly-day-select');
  const day = sel.value || data.daily.time[0];
  const container = document.getElementById('hourly');
  container.innerHTML = '';
  
  data.hourly.time.forEach((t, idx) => {
    if (t.startsWith(day)) {
      const hourLabel = new Date(t).toLocaleTimeString(undefined,{hour:'numeric',hour12:true});
      const temp = data.hourly.temperature_2m[idx];
      const precip = data.hourly.precipitation[idx];
      const item = document.createElement('div');
      item.className = 'hourly-item';
      item.setAttribute('role','listitem');
      item.innerHTML = `
        <div class="hour-left">
          <div class="hour-time">${hourLabel}</div>
        </div>
        <div class="hour-right">
          <div class="hour-temp">${formatTemp(temp, units)}</div>
        </div>
      `;
      container.appendChild(item);
    }
  });
}

// Helpers
function formatTemp(celsius, units){
  if (units === 'imperial') return `${Math.round(celsius*9/5+32)}°F`;
  return `${Math.round(celsius)}°C`;
}
function formatWind(kmh, units){
  // km/h -> mph
  if (units === 'imperial') return `${Math.round(kmh * 0.621371)} mph`;
  return `${Math.round(kmh)} km/h`;
}
function formatPrecip(mm, units){
  if (mm == null) return '—';
  if (units === 'imperial') return `${(mm * 0.0393701).toFixed(2)} in`;
  // show one decimal for mm when fractional, else integer
  return (Math.round(mm) === mm) ? `${mm} mm` : `${mm.toFixed(1)} mm`;
}

// Compute realistic 'feels like' temperature.
// Uses Wind Chill when cold and windy, Heat Index when hot and humid, otherwise returns air temp.
function computeFeelsLike(tempC, humidity, windKmh) {
  // if humidity or wind are missing, return raw temp
  if (tempC == null) return null;
  const t = Number(tempC);
  const rh = humidity == null ? null : Number(humidity);
  const w = windKmh == null ? null : Number(windKmh);

  // Wind Chill (valid for <=10°C and wind > 4.8 km/h)
  if (t <= 10 && w !== null && w > 4.8) {
    const v = w;
    // Canadian wind chill formula (°C)
    const wc = 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16);
    return Math.round(wc*10)/10;
  }

  // Heat Index (approx) - use when >=27°C and humidity present
  if (t >= 27 && rh !== null) {
    // formula uses °F
    const T = t * 9/5 + 32;
    const R = rh;
    // Rothfusz regression
    let HI = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    // adjustment
    if (R < 13 && T >= 80 && T <= 112) {
      HI -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (R > 85 && T >= 80 && T <= 87) {
      HI += ((R - 85) / 10) * ((87 - T) / 5);
    }
    // convert back to °C
    const hic = (HI - 32) * 5/9;
    return Math.round(hic*10)/10;
  }

  // otherwise return temperature unchanged (rounded to 1 decimal)
  return Math.round(t*10)/10;
}

function weatherCodeToEmoji(code){
  // Map WMO weather codes (from Open-Meteo) to emoji: quick display.
  // Reference: https://open-meteo.com/en/docs#api_form
  if (code === 0) return '☀️'; // clear sky
  if (code === 1) return '🌤️'; // mainly clear
  if (code === 2) return '⛅'; // partly cloudy
  if (code === 3) return '☁️'; // overcast
  if (code === 45 || code === 48) return '🌫️'; // fog
  if (code === 51 || code === 53 || code === 55) return '🌦️'; // drizzle
  if (code === 56 || code === 57) return '🌧️'; // freezing drizzle
  if (code === 61 || code === 63 || code === 65) return '🌧️'; // rain
  if (code === 66 || code === 67) return '🌧️'; // freezing rain
  if (code === 71 || code === 73 || code === 75) return '🌨️'; // snow
  if (code === 77) return '🌨️'; // snow grains
  if (code === 80 || code === 81 || code === 82) return '⛈️'; // showers
  if (code === 85 || code === 86) return '🌨️'; // snow showers
  if (code === 95 || code === 96 || code === 99) return '⛈️'; // thunderstorm
  return '☁️';
}

// UI helper to toggle the small location loader shown next to the place name.
function showLocationLoader(show) {
  try {
    const el = document.getElementById('location-loader');
    if (!el) return;
    if (show) {
      el.hidden = false;
      el.classList.add('active');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.classList.remove('active');
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    }
  } catch (e) { /* ignore UI helper errors */ }
}
