const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.EVENTBRITE_API_KEY;
const OUTPUT = path.join(__dirname, '..', 'public', 'events.json');

const VENUES = [
  { id: '298290194', name: 'Tlaqn\u00e1 Centro Cultural' },
  { id: '99775489',  name: 'Cauz | Foro & Librer\u00eda' },
  { id: '298595972', name: 'Sala Anexa (Tlaqn\u00e1)' },
  { id: '298544881', name: 'La S\u00e9ptima Estaci\u00f3n' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const headers = {};
    if (url.includes('eventbriteapi.com')) {
      headers.Authorization = `Bearer ${API_KEY}`;
    }
    mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

async function fetchEventbriteEvents() {
  console.log('🎵 Fetching Eventbrite events...');
  const all = [];

  for (const venue of VENUES) {
    try {
      const res = await get(`https://www.eventbriteapi.com/v3/venues/${venue.id}/events/`);
      for (const e of res.events) {
        if (e.status === 'live' || e.status === 'started') {
          const logoUrl = e.logo?.url || null;
          all.push({
            id: `eb_${e.id}`,
            source: 'eventbrite',
            title: e.name.text,
            description: (e.description?.text || '').slice(0, 300),
            url: e.url,
            date: e.start.local.split('T')[0],
            time: e.start.local.split('T')[1]?.slice(0, 5) || null,
            timezone: e.start.timezone || 'America/Mexico_City',
            venue: venue.name,
            venueAddress: null,
            isFree: e.is_free,
            price: e.is_free ? 0 : null,
            currency: e.currency || 'MXN',
            image: logoUrl,
            categoryId: e.category_id || null,
          });
        }
      }
      console.log(`  ✅ ${venue.name}: ${res.events.filter((e) => e.status === 'live').length} live`);
    } catch (err) {
      console.error(`  ❌ ${venue.name}: ${err.message}`);
    }
  }

  return all;
}

function mergeAndSort(events) {
  const unique = new Map();
  for (const e of events) {
    if (!unique.has(e.id)) {
      unique.set(e.id, e);
    }
  }
  return Array.from(unique.values()).sort((a, b) => {
    const da = a.date + (a.time || 'T00:00');
    const db = b.date + (b.time || 'T00:00');
    return da.localeCompare(db);
  });
}

async function main() {
  if (!API_KEY) {
    console.error('❌ EVENTBRITE_API_KEY not set');
    process.exit(1);
  }

  const eventbrite = await fetchEventbriteEvents();
  const all = mergeAndSort(eventbrite);

  const output = {
    updated: new Date().toISOString(),
    source: 'eventbrite',
    total: all.length,
    events: all,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`\n✅ ${all.length} eventos guardados en public/events.json`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
