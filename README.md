<p align="center"><img src="assets/brand/logo.svg" width="112" alt="templaitor" /></p>

# templaitor

Editor genérico de plantillas de email **MJML → HTML/TXT con Jinja2**, con editor visual (WYSIWYG).

Nace del motor de emails de `doomus-rs` (`emails/_engine`) y lo generaliza: cualquier proyecto con un
`templaitor.config.yml` puede compilar y editar sus plantillas. La salida sigue siendo Jinja2, lista
para renderizarse en runtime (minijinja, Jinja2, Tera…).

```
plantilla.mjml + plantilla.yml (textos por idioma) ──► dist/<id>/<nombre>.<locale>.html
                                                   ──► dist/<id>/<nombre>.<locale>.txt
                                                   ──► dist/<id>/<nombre>.<locale>.subject.txt
```

## Uso rápido

```bash
make install           # (o `make i`) instala dependencias y compila el editor (dist/editor)
make up                # desarrollo local: editor + API en http://localhost:5180 (Mailpit en /mailpit/)
make down              # para Mailpit
make test              # tests
make build             # compila el editor a dist/editor
```

`make up` abre `examples/demo` por defecto; para otro proyecto: `make up PROJECT=ruta/al/proyecto`.

**Mailpit local**: si hay Docker, `make up` arranca [Mailpit](https://mailpit.axllent.org/) con
`docker compose` (SMTP en `localhost:1025`). Su bandeja se publica en **`/mailpit/`** del propio editor
(http://localhost:5180/mailpit/), así que con `GATE=...` también es accesible en `https://<gate>/mailpit/`. El botón **mailpit ➤** del
editor envía la plantilla renderizada con los datos de demo; el aviso y el icono ↗ de la barra superior
abren **ese email** en Mailpit (o la bandeja si aún no se ha enviado nada). Sin Docker
arranca igual (con un aviso); `make up MAILPIT=0` lo desactiva y `make down` lo para. Puertos:
`MAILPIT_SMTP_PORT` / `MAILPIT_WEB_PORT`.

Para exponerlo públicamente con [intergate](https://jgermade.github.io/intergate/):

```bash
make up GATE=templaitor.gate.example.com
```

Abre un túnel SSH (`ssh -p 2222 -R templaitor:80:localhost:5180 gate.example.com`) que se reconecta
solo, y permite ese host en Vite. Requiere que tu clave SSH esté autorizada para el subdominio en el
dashboard de intergate. El puerto SSH es 2222 por defecto; se puede indicar en el propio host
(`GATE=templaitor.gate.example.com:2223`) o con `GATE_SSH_PORT`. Clave concreta: `GATE_KEY=~/.ssh/intergate`.
⚠ El editor no tiene autenticación y puede escribir ficheros del proyecto: restringe el acceso al
subdominio en intergate si no quieres que sea público.
Sin `make`: `npm run dev` (desarrollo, :5180), `npm run editor` (editor ya compilado, :3333) y `npm run compile`.

En otro proyecto:

```bash
npx templaitor editor --cwd ruta/al/proyecto     # editor visual
npx templaitor compile --cwd ruta/al/proyecto    # compilar (--watch, --strict)
npx templaitor new grupo/nombre --layout base.layout.mjml
```


# Project Specs

## Estructura de un proyecto

```
templaitor.config.yml
templates/
  _layouts/base.layout.mjml        # layouts con $content
  _components/footer/              # componentes reutilizables: $import(_components/footer)
    footer.mjml · footer.yml · footer.json5
  _shared/links.yml                # URLs para $link{...}
  _shared/logo.svg                 # estáticos (servidos en /static/ por el editor)
  customers/email-verification/
    email-verification.mjml        # plantilla (frontmatter opcional: layout)
    email-verification.yml         # subject + messages por idioma
    email-verification.json5       # datos de demo para la vista previa
dist/                              # salida compilada
```

Las carpetas que empiezan por `_` no son plantillas. Una plantilla es una carpeta `x/` con `x.mjml`.

## `templaitor.config.yml`

```yaml
name: Mi proyecto
templates: templates     # raíz de plantillas
outDir: dist
layouts: _layouts        # relativo a templates
partials: _partials
components: _components  # componentes reutilizables
previewLayout: base.layout.mjml   # <mj-head> para previsualizar componentes (por defecto, el primero)
links: _shared/links.yml
static: _shared
locales:                 # clave de idioma en el .yml → locale ($lang y nombre de fichero)
  es: es-ES
  en: en-US
output:
  text: true             # genera .txt
  subject: true          # genera .subject.txt
smtp:                    # opcional: botón "Enviar" del editor (p.ej. Mailpit)
  host: localhost
  port: 1025
  from: noreply@example.com
  label: mailpit         # texto del botón de envío
  web: /mailpit/         # bandeja web (enlace tras enviar; relativa al editor)
```

## Comandos `$` (compile-time) y Jinja2 (runtime)

| Comando | Descripción |
|---|---|
| `$import( ruta, clave="valor", … )` | Incluye un parcial o componente (relativo a `templates/`; `_components/x` = `_components/x/x.mjml`), con parámetros opcionales |
| `$param.nombre` | (dentro de un componente) valor del parámetro de la instancia o su valor por defecto |
| `$lang` / `$country` | Locale actual (`es-ES`) / país (`ES`) |
| `$if( expr ) … $else … $end` | Condicional compile-time (expresión JS) |
| `$t('clave')` | Texto de `messages.<idioma>.clave` (admite claves anidadas `a.b`) |
| `$link{ nombre, label: …, title: … }` | `<a>` con la URL de `links.yml` |

La resolución es recursiva (un `$t` puede contener otros comandos). Todo lo que sea Jinja2
(`{{ }}`, `{% %}`, `{# #}`) se protege del compilador MJML y llega intacto al HTML, al TXT y al asunto.
Para bloques Jinja2 entre secciones usa `<mj-raw>{% if … %}</mj-raw>`.

## Componentes reutilizables

Un componente es una carpeta `_components/<nombre>/` con `<nombre>.mjml` (fragmento MJML),
`<nombre>.yml` (`messages` por idioma) y `<nombre>.json5` (datos de demo). Se usa con
`$import(_components/<nombre>)` en plantillas, layouts u otros componentes.

- Sus textos `$t` se resuelven con su propio `.yml`; la plantilla puede **sobrescribir** cualquier clave en el suyo.
- En el editor: panel **Componentes** para insertarlos, ver cuántas plantillas los usan y crearlos;
  en el lienzo cada instancia se selecciona como un bloque (◆) y con **doble click** se edita el componente
  con el mismo WYSIWYG (con «← volver» a la plantilla). Los cambios se aplican en todas las plantillas.
- **Parámetros**: se declaran en el frontmatter del componente y se usan como `$param.nombre` en
  textos, botones o atributos. Cada instancia les da valor (o usa el valor por defecto):

  ```
  ---
  params:
    url: { type: text, label: Enlace, default: "#" }
    color: { type: color, label: Color, default: "#4F46E5" }
    align: { type: select, options: [left, center, right], default: center }
    label: $t('cta')          # forma corta: solo el valor por defecto
    logo: { type: image, default: "{{ assets_url }}/logo.svg" }
    show_note: { type: boolean, default: false }
  ---
  <mj-section>
    <mj-column>
      <mj-button href="$param.url" background-color="$param.color" align="$param.align">$param.label</mj-button>
      $if($param.show_note)
      <mj-text>…</mj-text>
      $end
    </mj-column>
  </mj-section>
  ```

  ```
  $import(_components/cta-button, url="{{ app_url }}/verify?token={{ token }}", label="$t('cta')", color="#059669")
  ```

  Tipos: `text`, `color`, `select` (con `options`), `image` (URL; en el editor, miniatura, galería de las
  imágenes de `static` y subida de ficheros, que se insertan como `{{ assets_url }}/fichero`, configurable con
  `assetsUrl`) y `boolean` (`true`/`false`, para `$if($param.x) … $end`; se evalúa al compilar, así que para
  condiciones en runtime usa `{% if %}`).

  Los valores (entre comillas dobles o simples) admiten Jinja2 y comandos `$`. En el editor, el inspector
  de una instancia muestra un formulario con los parámetros declarados, y al editar
  el componente el panel **Parámetros** permite declararlos y añadir `$param.x` como chip en los textos.
- **Convertir selección en componente**: mueve el bloque seleccionado y sus textos a un componente nuevo.
- **Desvincular**: sustituye una instancia por una copia editable solo en esa plantilla.

## Layouts

Un layout (`_layouts/<nombre>.mjml`) es un documento MJML completo con `$content` donde va cada plantilla
(que lo elige con `layout: <nombre>.mjml` en su frontmatter). En el editor se abren desde el buscador
(sección **Layouts**) o con ✎ junto al selector de layout de la plantilla, y se editan con el mismo WYSIWYG:
`$content` aparece como un hueco discontinuo que se puede mover en «Estructura». Como un layout no tiene
textos ni datos propios, la vista previa usa los de la primera plantilla que lo usa (no se guardan con el
layout) y sus `$t` se muestran pero no se editan ahí. Se pueden crear layouts nuevos y borrar los que no se usan.

## Editor visual

- **Diseño**: el lienzo es el HTML real compilado por MJML. Click para seleccionar un bloque;
  en textos y botones se escribe directamente. Si el contenido es `$t('clave')`, lo que escribes
  va al `.yml` del idioma activo. Las variables Jinja2 y los comandos `$` aparecen como *chips*
  no editables; escribir `{{ variable }}` crea uno nuevo.
- **Interfaz**: ruta de la plantilla (click para buscar/abrir plantillas y componentes), banderas de idioma,
  botón de envío SMTP (p.ej. *mailpit*) e icono ↗ que abre Mailpit (el último email enviado); en la barra
  del asunto, abrir la vista previa en otra pestaña y el conmutador `text`. A la izquierda, datos de demo (JSON5) y secciones plegables: Mensajes, Componentes,
  Bloques, Estructura y Plantilla. El inspector aparece al seleccionar un bloque.
- **Estructura**: árbol de bloques con arrastrar y soltar (valida dónde puede ir cada componente),
  subir/bajar, duplicar y eliminar. **Bloques**: paleta de componentes MJML; los nuevos textos y
  botones nacen traducibles en todos los idiomas.
- **Inspector**: atributos de cada componente, traducciones en todos los idiomas, renombrar claves,
  insertar variables (de los datos de demo) y links. Sin selección: layout, asunto, idiomas y
  traducciones pendientes.
- **Mensajes**: todas las claves del idioma activo, añadir/eliminar claves e idiomas.
- **Vista previa / text**: render con los datos de demo (nunjucks, compatible con Jinja2) y versión TXT.
- **Código**: `.mjml`, `.yml`, `.json5`, layouts, parciales y `links.yml` con vista previa en vivo.
- Deshacer/rehacer, `Ctrl+S`, vista móvil, compilar y enviar prueba por SMTP.

Las ediciones visuales reescriben el MJML con un formato normalizado (indentación de 2 espacios).

## Marca

`assets/brand/`: `logo.svg` (color), `logo-mono.svg` (una tinta, impresión), `favicon.svg` (versión
simplificada para 16–48 px) y exportaciones PNG (`logo-128/256/512.png`, `favicon-32.png`,
`logo-mono-256.png`). Los SVG solo usan trazados y degradados lineales (sin filtros, máscaras ni
fuentes), así que se incrustan como vectores en PDF; en emails usa los PNG (Gmail/Outlook no muestran SVG).

## Arquitectura

```
bin/templaitor.js          CLI (compile · editor · new)
src/shared/                código común Node/navegador
  mjml-tree.js             parser/serializador MJML que conserva comandos $ y Jinja2
  components.js            catálogo de componentes (atributos, anidamiento válido)
src/engine/                motor de compilación (portado de doomus-rs)
  pipeline.js              frontmatter → $import/layout → comandos $ → guard → MJML → HTML/TXT
  design.js                anotación del modo diseño (ids de nodo, regiones editables, chips)
  commands.js · guard.js · resolver.js · render.js · project.js
src/server/server.js       API HTTP del editor + estáticos
editor/                    SPA Svelte 5 + Vite (→ dist/editor)
  src/stores/editor.svelte.js   estado: los textos fuente son la única fuente de verdad
  src/lib/bridge.js             script del iframe (selección, edición inline, serialización)
examples/demo/             proyecto de ejemplo
```

# Todos

- [ ] Integrar en `doomus-rs`: sustituir `emails/_engine` por `templaitor compile` y leer `*.subject.txt` en el backend.
- [ ] Barra de formato flotante (negrita, cursiva, enlace) en la edición inline.
- [ ] Validación de variables: avisar de `{{ var }}` sin dato de demo.
- [ ] Modo "render" en Rust (minijinja) para que la vista previa sea idéntica al runtime.
