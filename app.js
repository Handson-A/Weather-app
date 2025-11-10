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
        // pass placeName/country so fetchAndRender can persist and avoid extra reverse lookups
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
  q.value = 'Accra';
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
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'auto'
  });

  const url = `${weatherBase}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();

  // Ensure we have a human-readable place name to show. Use provided values first,
  // then fall back to stored info, then try reverse geocoding.
  try {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('weather_last') || 'null'); } catch(e) { stored = null; }
    if (!placeName && stored && stored.placeName && stored.lat == lat && stored.lon == lon) {
      placeName = stored.placeName;
      country = stored.country;
    }
    if (!placeName) {
      // Try reverse geocoding to get a name for the coordinates.
      // Show a small, non-blocking loader in the UI while this runs.
      try {
        showLocationLoader(true);
        const rev = await reverseGeocode(lat, lon);
        if (rev) {
          placeName = rev.name || placeName;
          country = rev.country || country;
        }
      } catch (e) {
        // ignore reverse geocode errors; we'll still render numeric coords if needed
        console.warn('reverse geocode failed', e);
      } finally {
        showLocationLoader(false);
      }
    }

    // caching (include place name when available)
    localStorage.setItem('weather_last', JSON.stringify({lat, lon, placeName, country}));
  } catch (e) {
    console.warn('storing last weather failed', e);
  }

  // Ensure the location label in the UI is updated (may have been set earlier by geocode)
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

// Reverse geocode to obtain a place name from coordinates (uses Open-Meteo reverse endpoint)
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Reverse geocoding failed');
    const data = await res.json();
    // API returns 'name' and 'country' in the top-level object or in results[0]
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
  dateEl.textContent = new Date(cur.time).toLocaleString();

  // find index of current time 
  const idx = data.hourly.time.indexOf(cur.time);
  const humidity = idx >= 0 ? data.hourly.relativehumidity_2m[idx] : null;
  const precipitation = idx >= 0 ? data.hourly.precipitation[idx] : null;
  const wind = cur.windspeed; // default units: km/h 

  feelsEl.textContent = formatTemp(approxFeelsLike(cur.temperature, humidity), units);
  humEl.textContent = humidity !== null ? `${Math.round(humidity)}%` : '—';
  windEl.textContent = wind !== null ? formatWind(wind, units) : '—';
  precipEl.textContent = precipitation !== null ? formatPrecip(precipitation, units) : '—';
}

function renderDaily(data, units) {
  const container = document.getElementById('daily');
  container.innerHTML = '';
  const times = data.daily.time;
  for (let i = 0; i < times.length; i++) {
    const day = times[i];
    const tmax = data.daily.temperature_2m_max[i];
    const tmin = data.daily.temperature_2m_min[i];
    const precip = data.daily.precipitation_sum[i];
    const el = document.createElement('div');
    el.className = 'daily-item';
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <div class="daily-day">${new Date(day).toLocaleDateString(undefined,{weekday:'short'})}</div>
      <div class="daily-icon">${weatherCodeToEmoji(0)}</div>
      <div class="daily-temps">${formatTemp(tmax, units)} / ${formatTemp(tmin, units)}</div>
    `;
    container.appendChild(el);
  }
}

function setupHourlyDaySelector(data) {
  const sel = document.getElementById('hourly-day-select');
  sel.innerHTML = '';
  const dates = Array.from(new Set(data.daily.time.map(t => t)));
  dates.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = new Date(d).toLocaleDateString(undefined,{weekday:'long', month:'short', day:'numeric'});
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => renderHourlyForSelectedDay(data, localStorage.getItem('weather_units')||'metric'));
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
  if (units === 'imperial') return `${(mm * 0.0393701).toFixed(2)} in`;
  return `${mm} mm`;
}

function approxFeelsLike(tempC, humidity){
  //use temp if humidity missing
  if (humidity == null) return tempC;
  // simple adjustment
  const adj = (humidity - 50) * 0.02; 
  return tempC + adj;
}

function weatherCodeToEmoji(code){
//example mapping
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '⛈️';
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
