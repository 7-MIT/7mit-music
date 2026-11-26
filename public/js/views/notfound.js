import { empty } from '../ui/components.js'; import { h } from '../core/dom.js';
export default ({ el }) => el.append(empty('compass' in {} ? 'info' : 'info', 'Page not found', 'That page doesn’t exist.', h('a', { class: 'btn primary', href: '/' }, 'Back to Home')));
