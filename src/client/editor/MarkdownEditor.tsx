import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor as useTiptap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	Bold,
	Braces,
	Code,
	Heading2,
	Heading3,
	Italic,
	List,
	ListOrdered,
	Quote,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Markdown as MarkdownExtension } from "tiptap-markdown";

/**
 * Rich editing over the markdown files on disk: the document model is
 * TipTap's, but every change serializes back to markdown, so `nodes/<id>.md`
 * and `briefing.md` stay hand-editable. Raw mode shows the same text plain.
 */
export function MarkdownEditor({
	value,
	onChange,
	placeholder,
	tall,
	large,
	autoFocus,
}: {
	value: string;
	onChange: (text: string) => void;
	placeholder?: string;
	tall?: boolean;
	/** Full-screen editor: bigger type, a comfortable reading measure. */
	large?: boolean;
	autoFocus?: boolean;
}) {
	const [raw, setRaw] = useState(false);

	const editor = useTiptap({
		extensions: [
			StarterKit,
			Placeholder.configure({ placeholder: placeholder ?? "Write markdown…" }),
			MarkdownExtension.configure({ html: false, tightLists: true, linkify: false }),
		],
		content: value,
		autofocus: autoFocus ? "end" : false,
		editorProps: { attributes: { class: "md tt-content" } },
		onUpdate: ({ editor: e }) => {
			onChange((e.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
		},
	});

	useEffect(() => {
		if (!editor || editor.isFocused) return;
		const current = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
		if (current !== value) editor.commands.setContent(value, false);
	}, [value, editor]);

	if (!editor) return null;

	const btn = (
		active: boolean,
		run: () => void,
		icon: ReactNode,
		label: string,
	): ReactNode => (
		<button
			key={label}
			type="button"
			title={label}
			className={active ? "on" : ""}
			onMouseDown={(e) => {
				e.preventDefault();
				run();
			}}
		>
			{icon}
		</button>
	);

	const chain = () => editor.chain().focus();

	return (
		<div className={`tt ${tall ? "tall" : ""} ${large ? "large" : ""}`}>
			<div className="tt-bar">
				{!raw && (
					<>
						{btn(editor.isActive("bold"), () => chain().toggleBold().run(), <Bold size={13} />, "Bold")}
						{btn(editor.isActive("italic"), () => chain().toggleItalic().run(), <Italic size={13} />, "Italic")}
						{btn(editor.isActive("code"), () => chain().toggleCode().run(), <Code size={13} />, "Inline code")}
						<span className="tt-sep" />
						{btn(editor.isActive("heading", { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), <Heading2 size={13} />, "Heading")}
						{btn(editor.isActive("heading", { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), <Heading3 size={13} />, "Subheading")}
						<span className="tt-sep" />
						{btn(editor.isActive("bulletList"), () => chain().toggleBulletList().run(), <List size={13} />, "Bullet list")}
						{btn(editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), <ListOrdered size={13} />, "Numbered list")}
						{btn(editor.isActive("codeBlock"), () => chain().toggleCodeBlock().run(), <Braces size={13} />, "Code block")}
						{btn(editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), <Quote size={13} />, "Quote")}
					</>
				)}
				<span className="grow" />
				<div className="seg tt-mode">
					<button type="button" className={raw ? "" : "on"} onClick={() => setRaw(false)}>
						Rich
					</button>
					<button type="button" className={raw ? "on" : ""} onClick={() => setRaw(true)}>
						Raw
					</button>
				</div>
			</div>
			{raw ? (
				<textarea
					className="tt-raw mono"
					value={value}
					spellCheck={false}
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<EditorContent editor={editor} className="tt-scroll" />
			)}
		</div>
	);
}
