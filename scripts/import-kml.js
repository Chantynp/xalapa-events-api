// Importa una ruta trackeada en KML y la agrega a data/rutas.json.
//
//   node scripts/import-kml.js --file mi-ruta.kml --id verde2 --nombre "Camión 2" --color "#4CAF50"
//   node scripts/import-kml.js --file ruta.kml --id azul --nombre "Camión Azul" --simplify 8
//
// Que resuelve del KML:
//   - el trazo (LineString o gx:Track) -> geometria de la ruta
//   - los Placemark con <name> y <Point> -> paradas
//   - el ORDEN de las paradas, que el KML no garantiza: se proyecta cada parada
//     sobre el trazo y se ordena por distancia recorrida. Sobre una traza GPS densa
//     esto es fiable; seria frágil sobre una geometria de rutas publicas.
//
// Lo que NO puede resolver, y avisa:
//   - Placemark sin nombre (no hay de donde sacar el nombre de la parada)
//   - paradas fuera de Xalapa
//   - paradas con el mismo nombre y coordenadas distintas
//
// Opciones:
//   --file <ruta.kml>      obligatorio
//   --id <slug>            obligatorio, unico en el JSON
//   --nombre <texto>       obligatorio, como aparece en el selector
//   --color <#RRGGBB>      opcional, si no se rota una paleta
//   --frecuencia <min>     opcional, por defecto 30
//   --simplify <metros>    opcional, Douglas-Peucker para quitar el tembleque del GPS
//
// No publica nada: escribe data/rutas.json y hay que correr `npm run routes:sync`.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CANONICO = path.join(RAIZ, 'data', 'rutas.json');

const AREA = { latMin: 19.40, latMax: 19.62, lonMin: -97.05, lonMax: -96.80 };
const PALETA = ['#2D6A4F', '#D4890C', '#1B4965', '#9B2226', '#6B3FA0', '#0F766E', '#B45309', '#4D7C0F'];

const args = process.argv.slice(2);
function opt(nombre, def) {
  const i = args.indexOf(nombre);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const avisos = [];
const errores = [];

function dentro([lon, lat]) {
  return lat >= AREA.latMin && lat <= AREA.latMax && lon >= AREA.lonMin && lon <= AREA.lonMax;
}

// ---------------------------------------------------------------- KML

function leerKml(texto) {
  const coords = [];
  // LineString clasico. Entre <LineString> y <coordinates> puede haber <tessellate>
  // o <gx:...>, asi que se empareja el inicio con el primer <coordinates> que sigue.
  for (const m of texto.matchAll(/<LineString[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
    coords.push(...parsearLista(m[1]));
  }
  // gx:Track (Google Earth y varias apps de trackeo)
  if (coords.length === 0) {
    for (const m of texto.matchAll(/<gx:Track[^>]*>([\s\S]*?)<\/gx:Track>/gi)) {
      for (const c of m[1].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)) {
        coords.push(...parsearLista(c[1].replace(/\s+/g, ' ')));
      }
    }
  }
  // PolyLine (algunas exportaciones)
  if (coords.length === 0) {
    for (const m of texto.matchAll(/<gx:Polyline[^>]*>([\s\S]*?)<\/gx:Polyline>/gi)) {
      for (const c of m[1].matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)) {
        coords.push(...parsearLista(c[1].replace(/\s+/g, ' ')));
      }
    }
  }

  const paradas = [];
  for (const m of texto.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
    const bloque = m[1];
    const punto = bloque.match(/<Point[^>]*>\s*<coordinates>([^<]+)<\/coordinates>\s*<\/Point>/i);
    if (!punto) continue;
    const c = parsearLista(punto[1])[0];
    if (!c) continue;
    const nombre = (bloque.match(/<name>([\s\S]*?)<\/name>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const cuando = (bloque.match(/<when>([^<]+)<\/when>/i) || [, ''])[1].trim();
    paradas.push({ nombre, punto: c, cuando });
  }

  return { coords, paradas };
}

// KML: "lon,lat,alt lon,lat,alt" -> [[lon, lat], ...]
function parsearLista(bruto) {
  return bruto.trim().split(/\s+/).map(t => t.split(',').map(Number))
    .filter(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}

// ---------------------------------------------------------------- geometria

function metrosEntre(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  const dx = (a[0] - b[0]) * 111320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

// Douglas-Peucker. El GPS registra el tembleque del vehiculo y las paradas en
// los semaforos; sin simplificar, la linea se ve serruchosa frente a las rutas
// hechas con OSRM.
function simplificar(coords, toleranciaM) {
  if (toleranciaM <= 0 || coords.length < 3) return coords;

  function puntoSegmento(p, a, b) {
    const lat = p[1] * Math.PI / 180;
    const mx = (p[0] - a[0]) * 111320 * Math.cos(lat);
    const my = (p[1] - a[1]) * 110540;
    const bx = (b[0] - a[0]) * 111320 * Math.cos(lat);
    const by = (b[1] - a[1]) * 110540;
    const len2 = bx * bx + by * by;
    if (len2 === 0) return Math.hypot(mx, my);
    const t = Math.max(0, Math.min(1, (mx * bx + my * by) / len2));
    return Math.hypot(mx - t * bx, my - t * by);
  }

  // Recursiva; con trazas GPS largas conviene un stack explicito, pero los puntos
  // de un trackeo urbano entran de sobra en el limite de JS.
  function DP(ini, fin) {
    if (fin <= ini + 1) return [coords[fin]];
    let maxD = -1, idx = -1;
    for (let i = ini + 1; i < fin; i++) {
      const d = puntoSegmento(coords[i], coords[ini], coords[fin]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= toleranciaM) return [coords[fin]];
    return [...DP(ini, idx), ...DP(idx, fin)];
  }

  const mitad = DP(0, coords.length - 1);
  const ultimo = coords[coords.length - 1];
  const out = [coords[0], ...mitad, ultimo].filter((c, i, a) => i === 0 || c !== a[i - 1]);
  return out;
}

// Ordena las paradas por cuanto se han recorrido del trazo.
function ordenarPorTrazo(paradas, coords) {
  return paradas.map(p => {
    let idx = 0, min = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = metrosEntre(p.punto, coords[i]);
      if (d < min) { min = d; idx = i; }
    }
    return { ...p, idx, desvio: min };
  }).sort((a, b) => a.idx - b.idx);
}

// ---------------------------------------------------------------- main

const file = opt('--file');
const id = opt('--id');
const nombre = opt('--nombre');
const color = opt('--color');
const frecuencia = Number(opt('--frecuencia', '30'));
const simplificarM = Number(opt('--simplify', '0'));

if (!file || !id || !nombre) {
  console.error('Uso: node scripts/import-kml.js --file <ruta.kml> --id <slug> --nombre "Camion X" [--color #RRGGBB] [--frecuencia 30] [--simplify 8]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(id)) errores.push(`--id "${id}" debe ser un slug en minusculas (a-z, 0-9, guion)`);
if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) errores.push(`--color "${color}" no es un hex de 6 digitos`);

const doc = JSON.parse(fs.readFileSync(CANONICO, 'utf8'));
if (doc.rutas.features.some(f => f.id === id)) errores.push(`ya existe una ruta con id "${id}"`);

const { coords, paradas } = leerKml(fs.readFileSync(path.resolve(RAIZ, file), 'utf8'));

if (coords.length < 2) {
  console.error('\nNo se encontro ninguna traza en el KML.');
  console.error('Se buscan <LineString><coordinates>, <gx:Track><gx:coord> y <gx:Polyline>.');
  console.error('Revisa el archivo: algunos exportadores ponen la traza como <MultiGeometry> o en un .gpx.');
  process.exit(1);
}
if (!paradas.length) {
  avisos.push('el KML no trae Placemark con <Point>: hay que agregar las paradas a mano en data/rutas.json');
}

const geo = simplificarM > 0 ? simplificar(coords, simplificarM) : coords;
const fuera = geo.filter(c => !dentro(c));
if (fuera.length) avisos.push(`${fuera.length} de ${geo.length} puntos del trazo caen fuera de Xalapa`);

const ordenadas = ordenarPorTrazo(paradas, geo);
const sinNombre = ordenadas.filter(p => !p.nombre);
for (const p of sinNombre) avisos.push(`parada sin nombre en el KML (cerca de ${p.punto.join(', ')}) — ponle nombre en el editor o en el KML antes de volver a correr`);
for (const p of ordenadas.filter(p => p.desvio > 80)) avisos.push(`"${p.nombre || 'sin nombre'}" esta a ${Math.round(p.desvio)} m del trazo: revisa que caiga sobre la linea`);

// ids de parada
let n = 1;
const idDe = (nombreParada) => {
  const base = nombreParada.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'parada';
  let cand = base;
  while (doc.paradas.features.some(f => f.id === cand) && doc.paradas.features.some(f => f.id === cand && f.properties.nombre !== nombreParada)) cand = base + '-' + (++n);
  return cand;
};

const colorFinal = color || PALETA[doc.rutas.features.length % PALETA.length];
const nuevasParadas = [];
const idsUsados = new Set(doc.paradas.features.map(f => f.id));

const featureParadas = ordenadas.filter(p => p.nombre).map(p => {
  let pid = idDe(p.nombre);
  while (idsUsados.has(pid)) pid = pid + '-b';
  idsUsados.add(pid);
  const f = {
    type: 'Feature',
    id: pid,
    properties: { nombre: p.nombre, rutas: [id] },
    geometry: { type: 'Point', coordinates: p.punto },
  };
  nuevasParadas.push(f);
  return pid;
});

if (!errores.length) {
  doc.rutas.features.push({
    type: 'Feature',
    id,
    properties: {
      nombre, color: colorFinal,
      colorOscuro: PALETA[(PALETA.indexOf(colorFinal) + 3) % PALETA.length],
      frecuencia,
      paradas: featureParadas,
    },
    geometry: { type: 'LineString', coordinates: geo },
  });
  doc.paradas.features.push(...nuevasParadas);
  doc.updatedAt = new Date().toISOString();
}

console.log(`trazo: ${coords.length} puntos${simplificarM > 0 ? ` -> ${geo.length} (simplificado a ${simplificarM} m)` : ' (sin simplificar)'}`);
let km = 0;
for (let i = 1; i < geo.length; i++) km += metrosEntre(geo[i - 1], geo[i]);
console.log(`longitud: ${(km / 1000).toFixed(2)} km`);
console.log(`paradas en el KML: ${paradas.length} | con nombre: ${featureParadas.length}`);
if (featureParadas.length) console.log('orden detectado:\n  ' + featureParadas.map((_, i) => `${i + 1}. ${nuevasParadas[i].properties.nombre}`).join('\n  '));

if (errores.length) {
  console.error('\n' + errores.length + ' error(es):');
  errores.forEach(e => console.error('  x ' + e));
  process.exit(1);
}
if (avisos.length) {
  console.log('\navisos:');
  avisos.forEach(a => console.log('  ! ' + a));
}

fs.writeFileSync(CANONICO, JSON.stringify(doc, null, 2), 'utf8');
console.log(`\n-> data/rutas.json  (${(fs.statSync(CANONICO).size / 1024).toFixed(1)} KB)`);
console.log('\nRevisa el orden de las paradas y el color en el editor, luego:');
console.log('  npm run routes:sync');