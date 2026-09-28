import { Node, mergeAttributes } from '@tiptap/core';

export const PlaceholderToken = Node.create({
  name: 'placeholderToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-placeholder]',
        getAttrs: (el) => ({ name: (el as HTMLElement).getAttribute('data-placeholder') }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // When the editor serializes HTML to be saved/sent, we output the literal
    // {name} token so existing notification edge functions can string-replace it.
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-placeholder': node.attrs.name,
        style:
          'display:inline-block;background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));padding:1px 8px;border-radius:9999px;font-size:0.85em;font-weight:600;',
      }),
      `{${node.attrs.name}}`,
    ];
  },

  renderText({ node }) {
    return `{${node.attrs.name}}`;
  },
});
