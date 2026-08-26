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

async function fetchVenueAddresses() {
  const addresses = {};
  for (const venue of VENUES) {
    try {
      const v = await get(`https://www.eventbriteapi.com/v3/venues/${venue.id}/`);
      addresses[venue.id] = v.address?.localized_address_display || v.address?.address_1 || null;
    } catch (_) {}
  }
  return addresses;
}

const RECENT_DAYS = 30;

async function fetchVenueEvents(venueId) {
  const events = [];
  let url = `https://www.eventbriteapi.com/v3/venues/${venueId}/events/`;
  let page = 0;

  while (url) {
    const res = await get(url);
    events.push(...res.events);
    page++;
    console.log(`    page ${page}: +${res.events.length} events (total: ${events.length}/${res.pagination.object_count})`);

    if (res.pagination.has_more_items && res.pagination.continuation) {
      url = `https://www.eventbriteapi.com/v3/venues/${venueId}/events/?continuation=${res.pagination.continuation}`;
    } else {
      url = null;
    }
  }

  return events;
}

async function fetchEventbriteEvents() {
  console.log('🎵 Fetching Eventbrite events...');
  const addresses = await fetchVenueAddresses();
  const now = new Date();
  const cutoff = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const all = [];

  for (const venue of VENUES) {
    try {
      console.log(`  📍 ${venue.name}...`);
      const events = await fetchVenueEvents(venue.id);
      let liveCount = 0;
      let included = 0;

      for (const e of events) {
        const isLive = e.status === 'live' || e.status === 'started';
        const eventDate = new Date(e.start.local);
        const isRecent = e.status === 'completed' && eventDate >= cutoff && eventDate <= now;

        if (isLive || isRecent) {
          if (isLive) liveCount++;
          included++;
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
            venueAddress: addresses[venue.id] || null,
            isFree: e.is_free,
            price: e.is_free ? 0 : null,
            currency: e.currency || 'MXN',
            image: e.logo?.url || null,
            categoryId: e.category_id || null,
            status: e.status,
          });
        }
      }
      console.log(`  ✅ ${venue.name}: ${liveCount} live, ${included} included, ${events.length} total`);
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
    const scoreA = a.status === 'live' ? 0 : a.status === 'started' ? 1 : 2;
    const scoreB = b.status === 'live' ? 0 : b.status === 'started' ? 1 : 2;
    if (scoreA !== scoreB) return scoreA - scoreB;
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
