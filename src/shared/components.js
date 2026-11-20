// Catálogo de componentes MJML que el editor visual sabe manejar.
// `children`: etiquetas permitidas como hijas. `attrs`: atributos con editor
// específico en el inspector (el resto se edita como clave/valor libre).

const PADDING = { name: 'padding', type: 'spacing', label: 'Padding' }
const BG = { name: 'background-color', type: 'color', label: 'Fondo' }
const ALIGN = { name: 'align', type: 'select', label: 'Alineación', options: ['left', 'center', 'right'] }
const RADIUS = { name: 'border-radius', type: 'size', label: 'Radio de borde' }
const CSS_CLASS = { name: 'css-class', type: 'text', label: 'Clase CSS' }

const CONTENT = ['mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-table', 'mj-social', 'mj-raw', 'mj-navbar', 'mj-carousel', 'mj-accordion']

export const COMPONENTS = {
  'mj-wrapper': {
    label: 'Contenedor', icon: '▣', children: ['mj-section', 'mj-raw'],
    attrs: [BG, PADDING, RADIUS, { name: 'border', type: 'text', label: 'Borde' }, { name: 'full-width', type: 'select', options: ['', 'full-width'] }, CSS_CLASS],
    create: () => el('mj-wrapper', [['padding', '0']], [COMPONENTS['mj-section'].create()]),
  },
  'mj-section': {
    label: 'Sección', icon: '▭', children: ['mj-column', 'mj-group', 'mj-raw'],
    attrs: [BG, PADDING, RADIUS, { name: 'background-url', type: 'text', label: 'Imagen de fondo' }, { name: 'text-align', type: 'select', label: 'Alineación', options: ['', 'left', 'center', 'right'] }, { name: 'full-width', type: 'select', options: ['', 'full-width'] }, CSS_CLASS],
    create: () => el('mj-section', [['background-color', '#ffffff'], ['padding', '16px 24px']], [COMPONENTS['mj-column'].create()]),
  },
  'mj-group': {
    label: 'Grupo', icon: '⫴', children: ['mj-column', 'mj-raw'],
    attrs: [BG, { name: 'width', type: 'size', label: 'Ancho' }, CSS_CLASS],
    create: () => el('mj-group', [], [COMPONENTS['mj-column'].create(), COMPONENTS['mj-column'].create()]),
  },
  'mj-column': {
    label: 'Columna', icon: '▯', children: CONTENT,
    attrs: [{ name: 'width', type: 'size', label: 'Ancho' }, BG, PADDING, RADIUS, { name: 'vertical-align', type: 'select', label: 'Alineación vertical', options: ['', 'top', 'middle', 'bottom'] }, CSS_CLASS],
    create: () => el('mj-column', [], []),
  },
  'mj-text': {
    label: 'Texto', icon: '¶', editable: true,
    attrs: [{ name: 'color', type: 'color', label: 'Color' }, { name: 'font-size', type: 'size', label: 'Tamaño' }, { name: 'font-weight', type: 'select', label: 'Peso', options: ['', '400', '500', '600', '700'] }, { name: 'line-height', type: 'text', label: 'Interlineado' }, ALIGN, { name: 'font-family', type: 'text', label: 'Fuente' }, PADDING, CSS_CLASS],
    create: (content = 'Nuevo texto') => el('mj-text', [], [], content),
  },
  'mj-button': {
    label: 'Botón', icon: '⏺', editable: true,
    attrs: [{ name: 'href', type: 'text', label: 'Enlace' }, { name: 'background-color', type: 'color', label: 'Fondo' }, { name: 'color', type: 'color', label: 'Color texto' }, { name: 'font-size', type: 'size', label: 'Tamaño' }, { name: 'font-weight', type: 'select', label: 'Peso', options: ['', '400', '500', '600', '700'] }, RADIUS, ALIGN, { name: 'inner-padding', type: 'spacing', label: 'Padding interior' }, { name: 'width', type: 'size', label: 'Ancho' }, PADDING, CSS_CLASS],
    create: (content = 'Botón') => el('mj-button', [['href', '#']], [], content),
  },
  'mj-image': {
    label: 'Imagen', icon: '🖼',
    attrs: [{ name: 'src', type: 'text', label: 'URL' }, { name: 'alt', type: 'text', label: 'Texto alternativo' }, { name: 'href', type: 'text', label: 'Enlace' }, { name: 'width', type: 'size', label: 'Ancho' }, { name: 'height', type: 'size', label: 'Alto' }, ALIGN, RADIUS, PADDING, CSS_CLASS],
    create: () => el('mj-image', [['src', 'https://placehold.co/600x200/e5e7eb/6b7280?text=Imagen'], ['alt', '']], []),
  },
  'mj-divider': {
    label: 'Separador', icon: '―',
    attrs: [{ name: 'border-color', type: 'color', label: 'Color' }, { name: 'border-width', type: 'size', label: 'Grosor' }, { name: 'border-style', type: 'select', label: 'Estilo', options: ['', 'solid', 'dashed', 'dotted'] }, { name: 'width', type: 'size', label: 'Ancho' }, PADDING, CSS_CLASS],
    create: () => el('mj-divider', [['border-color', '#e5e7eb'], ['border-width', '1px']], []),
  },
  'mj-spacer': {
    label: 'Espaciador', icon: '↕',
    attrs: [{ name: 'height', type: 'size', label: 'Alto' }, CSS_CLASS],
    create: () => el('mj-spacer', [['height', '24px']], []),
  },
  'mj-raw': {
    label: 'HTML / Jinja', icon: '{%',
    attrs: [],
    create: (content = '{% if condition %}{% endif %}') => el('mj-raw', [], [], content),
  },
  'mj-table': {
    label: 'Tabla', icon: '▦',
    attrs: [{ name: 'color', type: 'color', label: 'Color' }, { name: 'font-size', type: 'size', label: 'Tamaño' }, { name: 'width', type: 'size', label: 'Ancho' }, ALIGN, PADDING, CSS_CLASS],
    create: () => el('mj-table', [], [], '<tr><th>Concepto</th><th>Importe</th></tr>\n{% for item in items %}\n<tr><td>{{ item.name }}</td><td>{{ item.price }}</td></tr>\n{% endfor %}'),
  },
  'mj-social': {
    label: 'Redes sociales', icon: '☍', children: ['mj-social-element'],
    attrs: [{ name: 'mode', type: 'select', options: ['', 'horizontal', 'vertical'] }, { name: 'icon-size', type: 'size', label: 'Tamaño icono' }, ALIGN, PADDING, CSS_CLASS],
    create: () => el('mj-social', [['mode', 'horizontal']], [el('mj-social-element', [['name', 'x'], ['href', 'https://x.com']], [], 'X')]),
  },
  'mj-social-element': {
    label: 'Red social', icon: '◎',
    attrs: [{ name: 'name', type: 'text', label: 'Red' }, { name: 'href', type: 'text', label: 'Enlace' }, { name: 'src', type: 'text', label: 'Icono' }],
    create: () => el('mj-social-element', [['name', 'x'], ['href', '#']], [], 'X'),
  },
}

// Contenedores de primer nivel válidos dentro de mj-body o de un layout
export const BODY_CHILDREN = ['mj-wrapper', 'mj-section', 'mj-hero', 'mj-raw']

// Componentes que se pueden añadir desde la paleta
export const PALETTE = ['mj-section', 'mj-wrapper', 'mj-group', 'mj-column', 'mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-table', 'mj-social', 'mj-raw']

// Etiquetas que no forman parte del contenido visual (no seleccionables en el lienzo)
export const NON_VISUAL = new Set(['mjml', 'mj-head', 'mj-attributes', 'mj-all', 'mj-class', 'mj-style', 'mj-font', 'mj-title', 'mj-preview', 'mj-breakpoint', 'mj-html-attributes', 'mj-include'])

export function el(tag, attrs = [], children = [], content = null) {
  return { type: 'element', tag, attrs, children, content }
}

/** ¿Puede `childTag` vivir dentro de un nodo `parentTag`? (`null` = raíz/fragmento) */
export function canContain(parentTag, childTag, { fragment = true } = {}) {
  if (parentTag === null || parentTag === undefined || parentTag === 'mj-body') {
    return fragment || parentTag === 'mj-body' ? BODY_CHILDREN.includes(childTag) : childTag === 'mjml'
  }
  const def = COMPONENTS[parentTag]
  return !!def?.children?.includes(childTag)
}

const STRUCTURE = {
  mjml: { label: 'Documento', icon: '◰', attrs: [] },
  'mj-body': { label: 'Cuerpo', icon: '▤', attrs: [{ name: 'background-color', type: 'color', label: 'Fondo' }, { name: 'width', type: 'size', label: 'Ancho' }] },
  'mj-hero': { label: 'Hero', icon: '▩', attrs: [] },
}

export function describe(tag) {
  return COMPONENTS[tag] || STRUCTURE[tag] || { label: tag.replace(/^mj-/, ''), icon: '◇', attrs: [] }
}
