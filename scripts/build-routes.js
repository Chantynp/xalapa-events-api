// Valida data/rutas.json y publica public/routes.json (lo que sirve GitHub Pages).
//
//   node scripts/build-routes.js
//   node scripts/build-routes.js --sync-app ../XalapaConnectMVP/src/data/routesFallback.js
//
// El archivo canonico es data/rutas.json. NO se edita a mano public/routes.json:
// es salida, se regenera. Para cambiar una ruta se edita el canonico y se corre esto.
//
// Las rutas se pueden agregar sin tocar la app: se edita el canonico, se corre esto,
// se commitea, y GitHub Pages publica el commit. La app toma el cambio en el
// siguiente arranque (TTL de 12 h) sin salir de Play.
//
// --sync-app ademas escribe la copia embebida que usa la app para el primer arranque
// y cuando no hay red. Es el unico mecanismo que evita que las dos copias se
// desincronicen; conviene pasarlo siempre que se toquen las rutas.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CANONICO = path.join(RAIZ, 'data', 'rutas.json');
const PUBLICADO = path.join(RAIZ, 'public', 'routes.json');

const AREA = { latMin: 19.40, latMax: 19.62, lonMin: -97.05, lonMax: -96.80 };

const args = process.argv.slice(2);
const flagApp = args.indexOf('--sync-app');
const appPath = flagApp !== -1 ? path.resolve(RAIZ, args[flagApp + 1]) : null;

const errores = [];
const avisos = [];

function err(msg) { errores.push(msg); }
function warn(msg) { avisos.push(msg); }

function dentroDeXalapa([lon, lat]) {
  return lat >= AREA.latMin && lat <= AREA.latMax && lon >= AREA.lonMin && lon <= AREA.lonMax;
}

// El orden de cada ruta se valida contra paradas.features, asi que la lista de ids
// tiene que estar construida antes de recorrer las rutas.
function idsParadaDeclarada(doc, id) {
  return doc.paradas.features.some(f => (f.id ?? f.properties?.id) === id);
}

function validar(doc) {
  if (typeof doc.version !== 'number') err('falta version numerica');
  if (!doc.rutas || doc.rutas.type !== 'FeatureCollection') return err('rutas debe ser un FeatureCollection');
  if (!doc.paradas || doc.paradas.type !== 'FeatureCollection') return err('paradas debe ser un FeatureCollection');
  if (!Array.isArray(doc.rutas.features) || !doc.rutas.features.length) return err('rutas.features vacio');
  if (!Array.isArray(doc.paradas.features) || !doc.paradas.features.length) return err('paradas.features vacio');

  const idsRuta = new Set();
  const idsParada = new Set();

  for (const f of doc.rutas.features) {
    const id = f.id ?? f.properties?.id;
    if (!id) { err('una ruta no tiene id'); continue; }
    if (idsRuta.has(id)) err(`ruta duplicada: ${id}`);
    idsRuta.add(id);

    if (f.geometry?.type !== 'LineString') { err(`${id}: la geometria debe ser LineString, es ${f.geometry?.type}`); continue; }
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) { err(`${id}: LineString con ${c?.length ?? 0} puntos, se necesitan 2`); continue; }
    if (!c.every(dentroDeXalapa)) {
      const fuera = c.filter(p => !dentroDeXalapa(p)).length;
      err(`${id}: ${fuera} de ${c.length} puntos fuera del area de Xalapa`);
    }
    if (c.some(p => Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) err(`${id}: coordenadas fuera de rango`);
    if (!f.properties?.nombre) err(`${id}: falta properties.nombre`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(f.properties?.color || '')) err(`${id}: color invalido (${f.properties?.color})`);
    if (typeof f.properties?.frecuencia !== 'number') err(`${id}: falta properties.frecuencia`);

    // Orden de paradas: el planner calcula cuantos tramos hay entre origen y destino
    const orden = f.properties?.paradas;
    if (!Array.isArray(orden) || orden.length < 2) { err(`${id}: properties.paradas debe listar al menos 2 paradas`); continue; }
    const repetidas = orden.filter((p, i) => orden.indexOf(p) !== i);
    if (repetidas.length) err(`${id}: paradas repetidas en el orden (${[...new Set(repetidas)].join(', ')})`);
    for (const p of orden) {
      if (!idsParadaDeclarada(doc, p)) err(`${id}: el orden menciona la parada "${p}", que no existe en paradas.features`);
    }
  }

  for (const f of doc.paradas.features) {
    const id = f.id ?? f.properties?.id;
    if (!id) { err('una parada no tiene id'); continue; }
    if (idsParada.has(id)) err(`parada duplicada: ${id}`);
    idsParada.add(id);
    if (f.geometry?.type !== 'Point') err(`parada ${id}: la geometria debe ser Point`);
    else if (!dentroDeXalapa(f.geometry.coordinates)) err(`parada ${id} fuera del area de Xalapa`);
    if (!f.properties?.nombre) err(`parada ${id}: falta properties.nombre`);
    if (!Array.isArray(f.properties?.rutas) || !f.properties.rutas.length) err(`parada ${id}: properties.rutas vacio`);
    else {
      for (const r of f.properties.rutas) {
        if (!idsRuta.has(r)) err(`parada ${id}: referencia a la ruta "${r}", que no existe`);
      }
    }
  }

  // cada parada compartida por dos rutas debe tener las MISMAS coordenadas
  const porNombre = new Map();
  for (const f of doc.paradas.features) {
    const k = (f.properties?.nombre || '').trim().toLowerCase();
    const prev = porNombre.get(k);
    if (prev && f.geometry?.coordinates) {
      if (prev[0] !== f.geometry.coordinates[0] || prev[1] !== f.geometry.coordinates[1]) {
        warn(`"${f.properties.nombre}" aparece con coordenadas distintas`);
      }
    } else if (f.geometry?.coordinates) porNombre.set(k, f.geometry.coordinates);
  }
}

const doc = JSON.parse(fs.readFileSync(CANONICO, 'utf8'));
validar(doc);

console.log('rutas.json v' + doc.version + '  (' + doc.rutas.features.length + ' rutas, ' + doc.paradas.features.length + ' paradas)');

if (avisos.length) { console.log('\navisos:'); avisos.forEach(a => console.log('  ' + a)); }
if (errores.length) {
  console.error('\n' + errores.length + ' error(es):');
  errores.forEach(e => console.error('  x ' + e));
  console.error('\nNo se publico nada. Corrige data/rutas.json y vuelve a correr.');
  process.exit(1);
}

doc.updatedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(PUBLICADO), { recursive: true });
fs.writeFileSync(PUBLICADO, JSON.stringify(doc), 'utf8');
console.log('\n-> public/routes.json  (' + (fs.statSync(PUBLICADO).size / 1024).toFixed(1) + ' KB)');

if (appPath) {
  const js = '// GENERADO por xalapa-events-api/scripts/build-routes.js --sync-app. No editar a mano.\n'
    + '// Copia embebida de las rutas: se usa en el primer arranque y cuando no hay red.\n'
    + '// Fuente de verdad: xalapa-events-api/data/rutas.json\n'
    + 'export const RUTAS_FALLBACK = ' + JSON.stringify(doc) + ';\n';
  fs.writeFileSync(appPath, js, 'utf8');
  console.log('-> ' + appPath + '  (' + (fs.statSync(appPath).size / 1024).toFixed(1) + ' KB)');
}

console.log('\nCommitear data/rutas.json y public/routes.json juntos. GitHub Pages publica el commit.');