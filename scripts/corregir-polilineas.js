// Las polilineas de Ruta Directa vienen con barras invertidas DOBLES porque su
// JSON las escapa para meterlas en un literal de JavaScript. Al pegarlas tal
// cual en otro literal de JavaScript quedaban escapadas dos veces, y al
// decodificar el texto crudo se leia una barra de mas: como el algoritmo agrupa
// de 5 en 5 bits, una barra sobrante desplaza todos los deltas siguientes y la
// linea sale corrupta. No habia ningun error, solo una ruta que no cerraba.
//
// El sintoma era que el loop no cerraba y las paradas quedaban lejos:
//   verde  284 puntos, el loop se abria 7.4 km y Art 3 quedaba a 3.4 km
//   al quitar la barra doble: 282 puntos, cierra a 4 m, peor parada 22 m
//
// Este script decodifica desde el literal de JavaScript, que es donde ya se
// desescapan solas, en vez de desde el texto crudo del archivo.
//
//   node scripts/corregir-polilineas.js <app-repo>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// El algoritmo de polilinea codificada de Google, tal cual:
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
// Se replica aqui para no meter @mapbox/polyline como dependencia del repo de
// datos, que solo tiene dotenv.
function decode(encoded, precision = 5) {
  const factor = Math.pow(10, precision);
  const out = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 1, shift = 0, b;
    do { b = encoded.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lat += (result & 1 ? ~(result >> 1) : result >> 1);
    result = 1; shift = 0;
    do { b = encoded.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lng += (result & 1 ? ~(result >> 1) : result >> 1);
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

const APP = process.argv[2] || path.join(__dirname, '..', '..', 'XalapaConnectMVP');
const RUTAS = path.join(__dirname, '..', 'data', 'rutas.json');

function hav(a, b) {
  const R = 6371000, t = x => x * Math.PI / 180;
  const dLa = t(b[0] - a[0]), dLo = t(b[1] - a[1]);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function polilineasDelRepoDeLaApp() {
  // constants.js ya no las tiene: viven en el historial, en el commit donde
  // la app todavia las traia embebidas.
  const ref = process.env.APP_REF || 'staging';
  const txt = execFileSync('git', ['show', ref + ':src/data/constants.js'], { cwd: APP, encoding: 'utf8' });
  const out = {};
  let actual = null;
  for (const l of txt.split('\n')) {
    const mi = l.match(/^\s*id:\s*'([^']+)'/);
    if (mi) { actual = mi[1]; continue; }
    const me = l.match(/encodedLine:\s*"((?:[^"\\]|\\.)*)"/);
    if (me && actual) {
      // eval es justo lo que hacia JavaScript con el literal: desescapa \\ a \
      out[actual] = eval('"' + me[1] + '"');
      actual = null;
    }
  }
  return out;
}

const doc = JSON.parse(fs.readFileSync(RUTAS, 'utf8'));
const enc = polilineasDelRepoDeLaApp();
const idDeNombre = { 'CamiÃ³n Amarillo': 'amarillo', 'CamiÃ³n Verde': 'verde' };

console.log('polilineas leidas del literal de JavaScript de ' + (process.env.APP_REF || 'staging') + '\n');

for (const f of doc.rutas.features) {
  const id = f.id || idDeNombre[f.properties.nombre];
  if (!enc[id]) { console.log('  ' + id + ': sin polilinea, se queda como esta'); continue; }

  const antes = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const despues = decode(enc[id]);
  const cierreA = hav(antes[0], antes[antes.length - 1]);
  const cierreD = hav(despues[0], despues[despues.length - 1]);

  f.geometry.coordinates = despues.map(([lat, lon]) => [
    Number(lon.toFixed(5)),
    Number(lat.toFixed(5)),
  ]);

  console.log('  ' + f.properties.nombre);
  console.log('    puntos   ' + antes.length + ' -> ' + despues.length);
  console.log('    cierre   ' + Math.round(cierreA) + ' m -> ' + Math.round(cierreD) + ' m');
}

fs.writeFileSync(RUTAS, JSON.stringify(doc, null, 2) + '\n');
console.log('\nescrito ' + RUTAS + '\ncorre ahora:  npm run routes:sync');
