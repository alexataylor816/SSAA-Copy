import { useEditor, EditorContent, Editor, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import { PlaceholderToken } from './PlaceholderToken';
import { StyledDiv, StyledSpan } from './StyledDiv';
import { styleAttribute, alignAttribute } from './StyleAttributes';
import { BLOCK_TEMPLATES } from './BlockTemplates';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Link2, Image as ImageIcon, Heading1, Heading2, Heading3,
  Pilcrow, Eraser, Loader2, Plus, ChevronDown,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholders: string[];
}

/**
 * Converts saved HTML (which contains literal {placeholder} tokens) into HTML
 * the editor can parse so placeholders render as styled, atomic node chips.
 */
function tokensToNodes(html: string, placeholders: string[]): string {
  if (!placeholders.length) return html;
  let out = html;
  const sorted = [...placeholders].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(`\\{${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
    out = out.replace(re, `<span data-placeholder="${name}">{${name}}</span>`);
  }
  return out;
}

/**
 * Adds a `style` attribute to existing block/inline node types so colored
 * text, aligned headings, etc. round-trip without being stripped.
 */
const StyleAttrs = Extension.create({
  name: 'styleAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'],
        attributes: {
          style: styleAttribute,
          align: alignAttribute,
        },
      },
    ];
  },
});

const RichEmailEditor = ({ value, onChange, placeholders }: Props) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSetValueRef = useRef<string>('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline' } }),
      Image.configure({ HTMLAttributes: { class: 'max-w-full rounded' } }),
      StyleAttrs,
      StyledDiv,
      StyledSpan,
      PlaceholderToken,
    ],
    content: tokensToNodes(value || '', placeholders),
    parseOptions: { preserveWhitespace: 'full' },
    editorProps: {
      attributes: {
        class:
          'email-canvas min-h-[420px] max-h-[640px] overflow-y-auto rounded-md border border-input bg-white text-black px-8 py-6 text-[15px] leading-relaxed focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      lastSetValueRef.current = html;
      onChange(html);
    },
  });

  // Sync external value changes (e.g. switching templates) into the editor.
  useEffect(() => {
    if (!editor) return;
    if (value === lastSetValueRef.current) return;
    lastSetValueRef.current = value;
    editor.commands.setContent(
      tokensToNodes(value || '', placeholders),
      { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } } as any,
    );
  }, [value, editor, placeholders]);

  if (!editor) return null;

  const insertPlaceholder = (name: string) => {
    editor.chain().focus().insertContent({ type: 'placeholderToken', attrs: { name } }).run();
  };

  const insertBlock = (html: string) => {
    editor.chain().focus().insertContent(html, {
      parseOptions: { preserveWhitespace: 'full' },
    }).run();
  };

  const promptLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('email-template-images')
        .upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('email-template-images').getPublicUrl(path);
      editor.chain().focus().setImage({ src: data.publicUrl, alt: file.name }).run();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-muted/30 p-2">
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon className="h-4 w-4" /></ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().setParagraph().run()} active={editor.isActive('paragraph')} title="Paragraph"><Pilcrow className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1"><Heading1 className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 className="h-4 w-4" /></ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List className="h-4 w-4" /></ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolbarBtn>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn editor={editor} action={promptLink} active={editor.isActive('link')} title="Link"><Link2 className="h-4 w-4" /></ToolbarBtn>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          title="Insert image"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageUpload}
        />
        <Separator orientation="vertical" className="h-6 mx-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 gap-1" title="Insert design block">
              <Plus className="h-4 w-4" />
              <span className="text-xs">Block</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 bg-popover z-[60]">
            <DropdownMenuLabel>Insert design block</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {BLOCK_TEMPLATES.map(b => (
              <DropdownMenuItem key={b.id} onClick={() => insertBlock(b.html)} className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{b.label}</span>
                <span className="text-xs text-muted-foreground">{b.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6 mx-1" />
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().unsetAllMarks().run()}
          title="Clear inline formatting (keeps blocks)"
        >
          <Eraser className="h-4 w-4" />
        </ToolbarBtn>
      </div>

      {placeholders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-muted-foreground mr-1">Insert:</span>
          {placeholders.map((p) => (
            <Badge
              key={p}
              variant="secondary"
              className="cursor-pointer hover:bg-secondary/80"
              onClick={() => insertPlaceholder(p)}
            >
              {`{${p}}`}
            </Badge>
          ))}
        </div>
      )}

      <div className="rounded-md border border-input bg-muted/20 p-3">
        <div className="text-xs text-muted-foreground mb-2">
          Live editor — what you see here is what recipients get. Click anywhere
          (including inside the colored boxes) to edit. Use the Block menu to add
          callout boxes, buttons, or code frames.
        </div>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

const ToolbarBtn = ({
  editor: _editor,
  action,
  active,
  title,
  children,
}: {
  editor: Editor;
  action: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) => (
  <Button
    type="button"
    variant={active ? 'secondary' : 'ghost'}
    size="sm"
    className="h-8 px-2"
    onClick={action}
    title={title}
  >
    {children}
  </Button>
);

export default RichEmailEditor;
