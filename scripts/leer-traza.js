// ---------------------------------------------------------------- GPX
// Mismo contrato que leerKml: { coords: [[lon, lat], ...], paradas: [...] }.
// En GPX las paradas suelen venir como <wpt> sueltas, que es mas limpio que
// los Placemark de KML: el punto y el nombre estan separados del trazo.

function leerGpx(texto) {
  const coords = [];

// <trkseg><trkpt lat lon> — con o sin <ele> en medio
  // OJO: en los atributos lat viene antes que lon, pero todo el script trabaja
// con [lon, lat]. Por eso m[2] va primero.
for (const m of texto.matchAll(/<trkpt\s+[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>/gi)) {
    coords.push([+Number(m[2]).toFixed(5), +Number(m[1]).toFixed(5)]);
  }
  // <rtept> — rutas planificadas, sin trackeo
  if (coords.length === 0) {
    for (const m of texto.matchAll(/<rtept\s+[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>/gi)) {
      coords.push([+Number(m[2]).toFixed(5), +Number(m[1]).toFixed(5)]);
    }
  }
  // <wpt> sin lat/lon en el atributo, si viniera en cuerpo (no es lo usual)
  if (coords.length === 0) {
    for (const m of texto.matchAll(/<wpt[^>]*>[\s\S]*?<lat>([-\d.]+)<\/lat>[\s\S]*?<lon>([-\d.]+)<\/lon>[\s\S]*?<\/wpt>/gi)) {
      coords.push([+Number(m[2]).toFixed(5), +Number(m[1]).toFixed(5)]);
    }
  }

  // Las paradas son los <wpt> con nombre. Sin nombre no hay nada que buscar en
  // el buscador, asi que se omiten y el importador avisa al final.
  const paradas = [];
  for (const m of texto.matchAll(/<wpt\s+[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/gi)) {
    const bloque = m[3];
    const nombre = (bloque.match(/<name>([\s\S]*?)<\/name>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const cuando = (bloque.match(/<time>([^<]+)<\/time>/i) || [, ''])[1].trim();
    paradas.push({ nombre, punto: [+Number(m[2]).toFixed(5), +Number(m[1]).toFixed(5)], cuando });
  }

  return { coords, paradas };
}

// ---------------------------------------------------------------- KML
// La lectura de KML y GPX vive en leer-traza.js; aqui solo se despacha por
// formato.

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

// ---------------------------------------------------------------- despacho

// La extension manda, pero si el contenido dice otra cosa se respeta el
// contenido: un .txt con <gpx> es un GPX.
function leer(texto, archivo) {
  if (/<gpx[\s>]/i.test(texto)) return { formato: 'GPX', ...leerGpx(texto) };
  if (/<kml[\s>]/i.test(texto)) return { formato: 'KML', ...leerKml(texto) };

  const ext = (archivo.match(/\.(kml|gpx)$/i) || [, ''])[1].toLowerCase();
  if (ext === 'gpx') return { formato: 'GPX', ...leerGpx(texto) };
  if (ext === 'kml') return { formato: 'KML', ...leerKml(texto) };
  return { formato: 'desconocido', coords: [], paradas: [] };
}

module.exports = { leer, leerKml, leerGpx };