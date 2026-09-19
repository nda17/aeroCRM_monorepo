'use client'
import styles from '@/shared/ui/tiptap-editor/TiptapEditor.module.scss'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { FC, useEffect } from 'react'

interface Props {
	value: string
	onChange: (html: string) => void
}

const TiptapEditor: FC<Props> = ({ value, onChange }) => {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			Link.configure({ openOnClick: false }),
			TextAlign.configure({ types: ['heading', 'paragraph'] })
		],
		content: value,
		immediatelyRender: false,
		onUpdate({ editor }) {
			onChange(editor.getHTML())
		}
	})

	useEffect(() => {
		if (editor && value !== editor.getHTML()) {
			editor.commands.setContent(value, { emitUpdate: false })
		}
	}, [value, editor])

	if (!editor) return null

	const btn = (active: boolean) =>
		`${styles.toolBtn} ${active ? styles.toolBtnActive : ''}`

	return (
		<div className={styles.wrap}>
			<div className={styles.toolbar}>
				<button
					type="button"
					className={btn(editor.isActive('bold'))}
					onClick={() => editor.chain().focus().toggleBold().run()}
					title="Жирный"
				>
					<strong>B</strong>
				</button>
				<button
					type="button"
					className={btn(editor.isActive('italic'))}
					onClick={() => editor.chain().focus().toggleItalic().run()}
					title="Курсив"
				>
					<em>I</em>
				</button>
				<button
					type="button"
					className={btn(editor.isActive('underline'))}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
					title="Подчёркнутый"
				>
					<u>U</u>
				</button>

				<span className={styles.sep} />

				<button
					type="button"
					className={btn(editor.isActive('heading', { level: 1 }))}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 1 }).run()
					}
					title="Заголовок 1"
				>
					H1
				</button>
				<button
					type="button"
					className={btn(editor.isActive('heading', { level: 2 }))}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
					title="Заголовок 2"
				>
					H2
				</button>
				<button
					type="button"
					className={btn(editor.isActive('heading', { level: 3 }))}
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
					title="Заголовок 3"
				>
					H3
				</button>

				<span className={styles.sep} />

				<button
					type="button"
					className={btn(editor.isActive('bulletList'))}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					title="Маркированный список"
				>
					• —
				</button>
				<button
					type="button"
					className={btn(editor.isActive('orderedList'))}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					title="Нумерованный список"
				>
					1. —
				</button>

				<span className={styles.sep} />

				<button
					type="button"
					className={btn(editor.isActive({ textAlign: 'left' }))}
					onClick={() => editor.chain().focus().setTextAlign('left').run()}
					title="По левому краю"
				>
					⬅
				</button>
				<button
					type="button"
					className={btn(editor.isActive({ textAlign: 'center' }))}
					onClick={() =>
						editor.chain().focus().setTextAlign('center').run()
					}
					title="По центру"
				>
					↔
				</button>
				<button
					type="button"
					className={btn(editor.isActive({ textAlign: 'right' }))}
					onClick={() =>
						editor.chain().focus().setTextAlign('right').run()
					}
					title="По правому краю"
				>
					➡
				</button>

				<span className={styles.sep} />

				<button
					type="button"
					className={btn(editor.isActive('link'))}
					onClick={() => {
						const url = editor.isActive('link')
							? null
							: window.prompt('Ссылка:', 'https://')
						if (url === null) {
							editor.chain().focus().unsetLink().run()
						} else if (url) {
							editor.chain().focus().setLink({ href: url }).run()
						}
					}}
					title="Ссылка"
				>
					🔗
				</button>

				<span className={styles.sep} />

				<button
					type="button"
					className={styles.toolBtn}
					onClick={() => editor.chain().focus().undo().run()}
					title="Отменить"
				>
					↩
				</button>
				<button
					type="button"
					className={styles.toolBtn}
					onClick={() => editor.chain().focus().redo().run()}
					title="Повторить"
				>
					↪
				</button>
			</div>

			<EditorContent editor={editor} className={styles.editor} />
		</div>
	)
}

export default TiptapEditor
