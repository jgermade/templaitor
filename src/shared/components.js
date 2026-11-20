// Catalog of the MJML components the visual editor knows how to handle.
// `children`: tags allowed as children. `attrs`: attributes with a dedicated
// editor in the inspector (the rest are edited as free key/value pairs).

const PADDING = { name: 'padding', type: 'spacing', label: 'Padding' }
const BG = { name: 'background-color', type: 'color', label: 'Background' }
const ALIGN = { name: 'align', type: 'select', label: 'Alignment', options: ['left', 'center', 'right'] }
const RADIUS = { name: 'border-radius', type: 'size', label: 'Border radius' }
const CSS_CLASS = { name: 'css-class', type: 'text', label: 'CSS class' }

const CONTENT = ['mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-table', 'mj-social', 'mj-raw', 'mj-navbar', 'mj-carousel', 'mj-accordion']

export const COMPONENTS = {
  'mj-wrapper': {
    label: 'Wrapper', icon: '▣', children: ['mj-section', 'mj-raw'],
    attrs: [BG, PADDING, RADIUS, { name: 'border', type: 'text', label: 'Border' }, { name: 'full-width', type: 'select', options: ['', 'full-width'] }, CSS_CLASS],
    create: () => el('mj-wrapper', [['padding', '0']], [COMPONENTS['mj-section'].create()]),
  },
  'mj-section': {
    label: 'Section', icon: '▭', children: ['mj-column', 'mj-group', 'mj-raw'],
    attrs: [BG, PADDING, RADIUS, { name: 'background-url', type: 'text', label: 'Background image' }, { name: 'text-align', type: 'select', label: 'Alignment', options: ['', 'left', 'center', 'right'] }, { name: 'full-width', type: 'select', options: ['', 'full-width'] }, CSS_CLASS],
    create: () => el('mj-section', [['background-color', '#ffffff'], ['padding', '16px 24px']], [COMPONENTS['mj-column'].create()]),
  },
  'mj-group': {
    label: 'Group', icon: '⫴', children: ['mj-column', 'mj-raw'],
    attrs: [BG, { name: 'width', type: 'size', label: 'Width' }, CSS_CLASS],
    create: () => el('mj-group', [], [COMPONENTS['mj-column'].create(), COMPONENTS['mj-column'].create()]),
  },
  'mj-column': {
    label: 'Column', icon: '▯', children: CONTENT,
    attrs: [{ name: 'width', type: 'size', label: 'Width' }, BG, PADDING, RADIUS, { name: 'vertical-align', type: 'select', label: 'Vertical alignment', options: ['', 'top', 'middle', 'bottom'] }, CSS_CLASS],
    create: () => el('mj-column', [], []),
  },
  'mj-text': {
    label: 'Text', icon: '¶', editable: true,
    attrs: [{ name: 'color', type: 'color', label: 'Color' }, { name: 'font-size', type: 'size', label: 'Size' }, { name: 'font-weight', type: 'select', label: 'Weight', options: ['', '400', '500', '600', '700'] }, { name: 'line-height', type: 'text', label: 'Line height' }, ALIGN, { name: 'font-family', type: 'text', label: 'Font' }, PADDING, CSS_CLASS],
    create: (content = 'New text') => el('mj-text', [], [], content),
  },
  'mj-button': {
    label: 'Button', icon: '⏺', editable: true,
    attrs: [{ name: 'href', type: 'text', label: 'Link' }, { name: 'background-color', type: 'color', label: 'Background' }, { name: 'color', type: 'color', label: 'Text color' }, { name: 'font-size', type: 'size', label: 'Size' }, { name: 'font-weight', type: 'select', label: 'Weight', options: ['', '400', '500', '600', '700'] }, RADIUS, ALIGN, { name: 'inner-padding', type: 'spacing', label: 'Inner padding' }, { name: 'width', type: 'size', label: 'Width' }, PADDING, CSS_CLASS],
    create: (content = 'Button') => el('mj-button', [['href', '#']], [], content),
  },
  'mj-image': {
    label: 'Image', icon: '🖼',
    attrs: [{ name: 'src', type: 'image', label: 'Image' }, { name: 'alt', type: 'text', label: 'Alt text' }, { name: 'href', type: 'text', label: 'Link' }, { name: 'width', type: 'size', label: 'Width' }, { name: 'height', type: 'size', label: 'Height' }, ALIGN, RADIUS, PADDING, CSS_CLASS],
    create: () => el('mj-image', [['src', 'https://placehold.co/600x200/e5e7eb/6b7280?text=Image'], ['alt', '']], []),
  },
  'mj-divider': {
    label: 'Divider', icon: '―',
    attrs: [{ name: 'border-color', type: 'color', label: 'Color' }, { name: 'border-width', type: 'size', label: 'Thickness' }, { name: 'border-style', type: 'select', label: 'Style', options: ['', 'solid', 'dashed', 'dotted'] }, { name: 'width', type: 'size', label: 'Width' }, PADDING, CSS_CLASS],
    create: () => el('mj-divider', [['border-color', '#e5e7eb'], ['border-width', '1px']], []),
  },
  'mj-spacer': {
    label: 'Spacer', icon: '↕',
    attrs: [{ name: 'height', type: 'size', label: 'Height' }, CSS_CLASS],
    create: () => el('mj-spacer', [['height', '24px']], []),
  },
  'mj-raw': {
    label: 'HTML / Jinja', icon: '{%',
    attrs: [],
    create: (content = '{% if condition %}{% endif %}') => el('mj-raw', [], [], content),
  },
  'mj-table': {
    label: 'Table', icon: '▦',
    attrs: [{ name: 'color', type: 'color', label: 'Color' }, { name: 'font-size', type: 'size', label: 'Size' }, { name: 'width', type: 'size', label: 'Width' }, ALIGN, PADDING, CSS_CLASS],
    create: () => el('mj-table', [], [], '<thead><tr><th scope="col">Item</th><th scope="col">Amount</th></tr></thead>\n{% for item in items %}\n<tr><td>{{ item.name }}</td><td>{{ item.price }}</td></tr>\n{% endfor %}'),
  },
  'mj-social': {
    label: 'Social links', icon: '☍', children: ['mj-social-element'],
    attrs: [{ name: 'mode', type: 'select', options: ['', 'horizontal', 'vertical'] }, { name: 'icon-size', type: 'size', label: 'Icon size' }, ALIGN, PADDING, CSS_CLASS],
    create: () => el('mj-social', [['mode', 'horizontal']], [el('mj-social-element', [['name', 'x'], ['href', 'https://x.com']], [], 'X')]),
  },
  'mj-social-element': {
    label: 'Social link', icon: '◎',
    attrs: [{ name: 'name', type: 'text', label: 'Network' }, { name: 'href', type: 'text', label: 'Link' }, { name: 'src', type: 'text', label: 'Icon' }],
    create: () => el('mj-social-element', [['name', 'x'], ['href', '#']], [], 'X'),
  },
}

// Top-level containers allowed inside mj-body or a layout
export const BODY_CHILDREN = ['mj-wrapper', 'mj-section', 'mj-hero', 'mj-raw']

// Components that can be added from the palette
export const PALETTE = ['mj-section', 'mj-wrapper', 'mj-group', 'mj-column', 'mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-spacer', 'mj-table', 'mj-social', 'mj-raw']

// Tags that are not visual content (not selectable on the canvas)
export const NON_VISUAL = new Set(['mjml', 'mj-head', 'mj-attributes', 'mj-all', 'mj-class', 'mj-style', 'mj-font', 'mj-title', 'mj-preview', 'mj-breakpoint', 'mj-html-attributes', 'mj-include'])

export function el(tag, attrs = [], children = [], content = null) {
  return { type: 'element', tag, attrs, children, content }
}

/** Can `childTag` live inside a `parentTag` node? (`null` = root/fragment) */
export function canContain(parentTag, childTag, { fragment = true } = {}) {
  if (parentTag === null || parentTag === undefined || parentTag === 'mj-body') {
    return fragment || parentTag === 'mj-body' ? BODY_CHILDREN.includes(childTag) : childTag === 'mjml'
  }
  const def = COMPONENTS[parentTag]
  return !!def?.children?.includes(childTag)
}

const STRUCTURE = {
  mjml: { label: 'Document', icon: '◰', attrs: [] },
  'mj-body': { label: 'Body', icon: '▤', attrs: [{ name: 'background-color', type: 'color', label: 'Background' }, { name: 'width', type: 'size', label: 'Width' }] },
  'mj-hero': { label: 'Hero', icon: '▩', attrs: [] },
}

export function describe(tag) {
  return COMPONENTS[tag] || STRUCTURE[tag] || { label: tag.replace(/^mj-/, ''), icon: '◇', attrs: [] }
}
