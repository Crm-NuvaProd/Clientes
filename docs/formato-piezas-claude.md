# Piezas de correo diseñadas por Claude

NuvaMail importa piezas en dos formatos desde **Diseños de correo → Importar pieza de Claude**:

1. **JSON `nuvamail/1`** (recomendado): cada bloque queda editable en el editor visual.
2. **HTML de correo completo**: se importa como un único bloque HTML. Se puede ver y enviar, pero no se edita bloque por bloque.

En ambos casos la app quita scripts y eventos, sube a S3 las imágenes incrustadas en base64 y agrega el pie legal y el enlace de baja.

## Instrucción para pegar en Claude

```
Diseña una pieza de correo de marketing para NuvaMail y entrégamela SOLO como un bloque de código JSON con este formato exacto ("nuvamail/1"):

{
  "formato": "nuvamail/1",
  "ajustes": { "fondo": "#f4f6fa", "fondoContenido": "#ffffff", "ancho": 600, "fuente": "Poppins, Arial, sans-serif", "colorTexto": "#1f2937", "colorEnlace": "#00B4D8" },
  "bloques": [ ...bloques en orden... ]
}

Tipos de bloque permitidos (campo "tipo") y sus campos:
- "encabezado": texto, logoUrl (https, opcional), fondo, color, alineacion ("left"|"center"|"right")
- "texto": html (solo <p> <b> <i> <u> <a href> <br> <ul> <ol> <li> <h2> <h3>), alineacion, tamano (14–18), color
- "imagen": src (URL https pública o data:image/png;base64), alt (obligatorio, descriptivo), enlace (opcional), ancho (% de 10 a 100)
- "boton": texto, url (https), colorFondo, color, alineacion, radio
- "columnas": imagen { src, alt, enlace }, html (texto de la columna derecha), invertir (true/false)
- "divisor": color, grosor
- "espaciador": alto (px)
- "redes": enlaces [{ "red": "linkedin"|"instagram"|"facebook"|"youtube"|"x"|"whatsapp"|"web", "url": "https://..." }]

Reglas para que no caiga en spam:
- Colores de marca NuvaProd: azul marino #0A2342, cian #00B4D8, amarillo #FFC313.
- Al menos 60 % texto frente a imágenes; toda imagen con "alt".
- Un solo llamado a la acción principal (botón) y máximo 6 enlaces.
- Personaliza con {{nombre}} y {{empresa}} (o {{empresa|"su empresa"}}).
- Nada de MAYÚSCULAS sostenidas, signos !!!, ni palabras como "gratis", "urgente", "gane".
- No incluyas pie legal ni enlace de baja: NuvaMail los agrega solo.
- Propón también 2 asuntos (30–55 caracteres) y un preencabezado, fuera del JSON.

Contenido de la pieza: 
```

## Ejemplo de respuesta válida

```json
{
  "formato": "nuvamail/1",
  "ajustes": { "fondo": "#f4f6fa", "fondoContenido": "#ffffff", "ancho": 600, "fuente": "Poppins, Arial, sans-serif", "colorTexto": "#1f2937", "colorEnlace": "#00B4D8" },
  "bloques": [
    { "tipo": "encabezado", "texto": "NuvaProd", "fondo": "#0A2342", "color": "#ffffff" },
    { "tipo": "texto", "html": "<p>Hola {{nombre}},</p><p>Las pymes que llevan su contabilidad en <b>Siigo</b> pueden planear la producción sin Excel. Con NuvaProd, {{empresa|\"su empresa\"}} controla órdenes, inventario y costos reales.</p>" },
    { "tipo": "boton", "texto": "Agendar demostración", "url": "https://nuvaprod.com/demo", "colorFondo": "#00B4D8", "color": "#ffffff" },
    { "tipo": "columnas", "imagen": { "src": "https://nuvaprod.com/img/caso.png", "alt": "Planta de Lácteos La Pradera" }, "html": "<p><b>Caso Lácteos La Pradera</b><br>Redujo el desperdicio de materia prima en el primer trimestre.</p>" },
    { "tipo": "redes", "enlaces": [{ "red": "linkedin", "url": "https://www.linkedin.com/company/nuvaprod" }] }
  ]
}
```
