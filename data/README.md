rutas del transporte publico de Xalapa

data/rutas.json es el canonico: dos FeatureCollections (LineStrings para las
rutas, Points para las paradas) con las propiedades de la app (color, frecuencia,
orden de paradas). Ahi se edita para agregar o cambiar una ruta.

public/routes.json es salida generada. No editarlo a mano.

    npm run routes        valida y publica
    npm run routes:sync   publica y regenera la copia embebida de la app

El validador no publica nada si hay un error, y cubre geometria, ids, colores,
puntos fuera del area de Xalapa y referencias rotas en el orden de paradas.

La URL que consume la app es

    https://chantynp.github.io/xalapa-events-api/public/routes.json

y GitHub Pages la publica en cada commit, sin cron: las rutas cambian pocas
veces al ano y asi cada cambio es una decision consciente, no una regeneracion
automatica que puede pisar una edicion manual.


## Dar de alta una ruta nueva

Se importa desde el archivo que exporta la app de trackeo, en KML o GPX. No hay
que escribir GeoJSON a mano.

    npm run routes:import -- --file ruta.gpx --id ruta12 --nombre "Ruta 12" \
        --color "#B45309" --frecuencia 25 --simplify 6

| Argumento | Obligatorio | Que hace |
|-----------|-------------|----------|
| `--file` | si | La traza. KML o GPX; el formato se detecta por contenido. |
| `--id` | si | Identificador unico en minusculas y guiones. Aparece en `properties.paradas`. |
| `--nombre` | si | Como se ve en el selector de rutas. |
| `--color` | no | Hex de 6 digitos, con `#`. Si se omite rota una paleta. |
| `--frecuencia` | no | Minutos entre camiones. Por defecto 30. |
| `--simplify` | no | Douglas-Peucker en metros. Por defecto 0 (no simplifica). |

Que se admitan las dos fuentes:

- **KML**: traza en `<LineString><coordinates>`, `<gx:Track><gx:coord>` o
  `<gx:Polyline>`. Las paradas son los `Placemark` con `<Point>` y `<name>`.
- **GPX**: traza en `<trkpt lat lon>` o `<rtept lat lon>`. Las paradas son los
  `<wpt lat lon>` con `<name>`. Es la opcion mas limpia, porque el punto y el
  nombre estan separados del trazo.

El importador **ordena las paradas por si solas**: el archivo no garantiza el
orden, asi que proyecta cada parada sobre la traza y las ordena por distancia
recorrida. Sirve tanto si vienen desordenadas como al reves.

`--simplify` importa porque el GPS registra el tembleque del vehiculo y las
paradas en los semaforos, y sin limpiar la linea se ve serruchosa frente a las
rutas hechas con OSRM. Con 6 m basta en la practica.

El importador **no publica nada**. Avisa, sin bloquear, de paradas sin nombre,
paradas a mas de 80 m del trazo y puntos fuera de Xalapa, y luego hay que correr
`routes:sync`, que es donde el validador puede rechazarlo.

### Se integra solo en la app

No hay que tocar la app. `routes:sync` publica `public/routes.json`, GitHub Pages
lo sirve en el commit y la app lo baja en el proximo arranque, con el respaldo
embebido mientras tanto. El selector de rutas, el buscador, el planificador y las
paradas leen todo de ahi, incluido el color de la linea.

La unica excepcion: un cambio en `routes.json` **no se ve con hot reload**, porque
el estado queda en memoria. Para verlo hace falta APK nuevo.