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