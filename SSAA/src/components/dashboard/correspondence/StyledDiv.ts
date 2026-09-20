import { Node, mergeAttributes } from '@tiptap/core';
import { styleAttribute, alignAttribute } from './StyleAttributes';

/**
 * Generic styled <div> node. Preserves any inline style on the wrapping div so
 * email callout boxes, framed code blocks, button containers, etc. survive
 * a load -> edit -> save round-trip without losing formatting.
 */
export const StyledDiv = Node.create({
  name: 'styledDiv',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      style: styleAttribute,
      align: alignAttribute,
      class: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute('class'),
        renderHTML: (attrs: Record<string, any>) =>
          attrs.class ? { class: attrs.class } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * Inline styled <span>. Lets colored/bold inline runs (e.g. green "Option 1"
 * headings, the underlined "Get Started" link wrapper) survive editing.
 */
export const StyledSpan = Node.create({
  name: 'styledSpan',
  group: 'inline',
  inline: true,
  content: 'inline*',

  addAttributes() {
    return {
      style: styleAttribute,
      class: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute('class'),
        renderHTML: (attrs: Record<string, any>) =>
          attrs.class ? { class: attrs.class } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        // Don't swallow placeholder chips (handled by PlaceholderToken).
        getAttrs: (el) => {
          const node = el as HTMLElement;
          if (node.hasAttribute('data-placeholder')) return false;
          // Only claim spans that actually carry styling worth preserving.
          if (!node.getAttribute('style') && !node.getAttribute('class')) return false;
          return {};
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});
