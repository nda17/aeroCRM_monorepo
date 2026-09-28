'use client'

import { useEffect, useId, useState } from 'react'
import {
	EditorContent,
	useEditor,
	useEditorState,
	type JSONContent
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
	isSafeMailLink,
	serializeMailRichText
} from '../model/mail-rich-text'
import { Button, TextField, TextareaField } from '@/shared/ui'
import styles from './Mail.module.scss'

const plainDocument = (text: string): JSONContent => ({
	type: 'doc',
	content: text.split('\n').map(line => ({
		type: 'paragraph',
		content: line ? [{ type: 'text', text: line }] : []
	}))
})

export const RichMailEditor = ({
	text,
	html,
	disabled,
	onChange
}: {
	text: string
	html?: string
	disabled: boolean
	onChange: (content: { text: string; html?: string }) => void
}) => {
	const labelId = useId()
	const [plain, setPlain] = useState(false)
	const [linkOpen, setLinkOpen] = useState(false)
	const [link, setLink] = useState('')
	const [linkError, setLinkError] = useState<string | null>(null)
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit.configure({
				heading: false,
				blockquote: false,
				code: false,
				codeBlock: false,
				strike: false,
				underline: false,
				horizontalRule: false,
				link: {
					openOnClick: false,
					autolink: false,
					linkOnPaste: false,
					defaultProtocol: 'https',
					isAllowedUri: isSafeMailLink,
					HTMLAttributes: { target: null, rel: null, class: null }
				}
			})
		],
		content: plainDocument(text),
		editable: !disabled,
		editorProps: {
			attributes: {
				role: 'textbox',
				'aria-labelledby': labelId,
				'aria-multiline': 'true',
				class: styles.richEditorContent
			}
		},
		onUpdate: ({ editor: active }) =>
			onChange({
				text: active.getText({ blockSeparator: '\n\n' }),
				html: active.isEmpty
					? undefined
					: serializeMailRichText(active.getJSON())
			})
	})
	const state = useEditorState({
		editor,
		selector: ({ editor: active }) =>
			active
				? {
						bold: active.isActive('bold'),
						italic: active.isActive('italic'),
						bulletList: active.isActive('bulletList'),
						orderedList: active.isActive('orderedList'),
						link: active.isActive('link'),
						undo: active.can().undo(),
						redo: active.can().redo()
					}
				: null
	})
	useEffect(() => {
		editor?.setEditable(!disabled)
	}, [editor, disabled])
	useEffect(() => {
		if (editor && editor.getText({ blockSeparator: '\n\n' }) !== text)
			editor.commands.setContent(html ?? plainDocument(text), {
				emitUpdate: false
			})
	}, [editor, text, html])
	const richMode = () => {
		if (!editor) return
		editor.commands.setContent(html ?? plainDocument(text), {
			emitUpdate: false
		})
		setPlain(false)
	}
	return (
		<div className={styles.stack}>
			<div className={styles.row}>
				<span id={labelId}>Письмо</span>
				{editor ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={disabled}
						onClick={() => (plain ? richMode() : setPlain(true))}
					>
						{plain ? 'Форматировать текст' : 'Обычный текст'}
					</Button>
				) : null}
			</div>
			{plain || !editor ? (
				<TextareaField
					label="Письмо"
					rows={10}
					maxLength={24576}
					value={text}
					disabled={disabled}
					hint={
						plain
							? 'При изменении обычного текста форматирование письма будет удалено.'
							: 'Загружаем редактор. Можно продолжить ввод обычного текста.'
					}
					onChange={event => onChange({ text: event.target.value })}
				/>
			) : (
				<>
					<div
						className={styles.editorToolbar}
						role="group"
						aria-label="Форматирование письма"
					>
						<Button
							size="sm"
							variant="secondary"
							aria-label="Полужирный"
							aria-pressed={state?.bold ?? false}
							disabled={disabled}
							onClick={() => editor.chain().focus().toggleBold().run()}
						>
							<strong>Ж</strong>
						</Button>
						<Button
							size="sm"
							variant="secondary"
							aria-label="Курсив"
							aria-pressed={state?.italic ?? false}
							disabled={disabled}
							onClick={() => editor.chain().focus().toggleItalic().run()}
						>
							<em>К</em>
						</Button>
						<Button
							size="sm"
							variant="secondary"
							aria-pressed={state?.bulletList ?? false}
							disabled={disabled}
							onClick={() =>
								editor.chain().focus().toggleBulletList().run()
							}
						>
							Маркированный список
						</Button>
						<Button
							size="sm"
							variant="secondary"
							aria-pressed={state?.orderedList ?? false}
							disabled={disabled}
							onClick={() =>
								editor.chain().focus().toggleOrderedList().run()
							}
						>
							Нумерованный список
						</Button>
						<Button
							size="sm"
							variant="secondary"
							aria-pressed={state?.link ?? false}
							disabled={disabled}
							onClick={() => {
								setLink(editor.getAttributes('link').href ?? '')
								setLinkError(null)
								setLinkOpen(open => !open)
							}}
						>
							Ссылка
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled || !state?.undo}
							onClick={() => editor.chain().focus().undo().run()}
						>
							Отменить
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled || !state?.redo}
							onClick={() => editor.chain().focus().redo().run()}
						>
							Повторить
						</Button>
					</div>
					{linkOpen ? (
						<div className={styles.stack}>
							<TextField
								label="Адрес ссылки"
								value={link}
								disabled={disabled}
								hint="Выделите текст и укажите полный адрес https://, http:// или mailto:."
								onChange={event => {
									setLink(event.target.value)
									setLinkError(null)
								}}
							/>
							<div className={styles.actions}>
								<Button
									size="sm"
									variant="secondary"
									disabled={disabled}
									onClick={() => {
										if (!isSafeMailLink(link)) {
											setLinkError(
												'Укажите полный адрес http://, https:// или mailto:.'
											)
											return
										}
										editor
											.chain()
											.focus()
											.extendMarkRange('link')
											.setLink({ href: link })
											.run()
										setLinkOpen(false)
									}}
								>
									Применить ссылку
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={disabled}
									onClick={() => {
										editor
											.chain()
											.focus()
											.extendMarkRange('link')
											.unsetLink()
											.run()
										setLinkOpen(false)
									}}
								>
									Убрать ссылку
								</Button>
							</div>
							{linkError ? <p role="alert">{linkError}</p> : null}
						</div>
					) : null}
					<div className={styles.richEditor}>
						<EditorContent editor={editor} />
					</div>
				</>
			)}
		</div>
	)
}
