import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
	chatAttachmentCapabilities,
	uploadChatAttachment,
	lookupChatAttachment,
	discardChatAttachment,
	type PendingChatAttachment
} from '@/entities/workspace-collaboration'
import type { CollaborationContext } from './use-collaboration'
export type DraftFile = {
	key: string
	commandId: string
	file: File
	progress: number
	attachment?: PendingChatAttachment
	error?: string
	running: boolean
	controller?: AbortController
	discardCommandId: string
}
export function useChatAttachments(
	context: CollaborationContext,
	conversationId: string
) {
	const [files, setFiles] = useState<DraftFile[]>([])
	const filesRef = useRef(files)
	const liveContext = useRef(context)
	useLayoutEffect(() => {
		liveContext.current = context
	}, [context])
	useLayoutEffect(() => {
		filesRef.current = files
	}, [files])
	const mounted = useRef(true)
	const [enabled, setEnabled] = useState(false)
	const [error, setError] = useState('')
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			for (const row of filesRef.current) row.controller?.abort()
		}
	}, [])
	useEffect(() => {
		const context = liveContext.current
		if (!context.ready) return
		void chatAttachmentCapabilities(
			context.session!.accessToken,
			context.binding.workspaceId
		)
			.then(value => {
				if (context.current() && mounted.current) setEnabled(value)
			})
			.catch(() => {
				if (mounted.current)
					setError('Не удалось проверить доступность вложений.')
			})
	}, [context.identity, context.ready])
	const update = (key: string, patch: Partial<DraftFile>) => {
		if (mounted.current && context.current())
			setFiles(rows =>
				rows.map(row => (row.key === key ? { ...row, ...patch } : row))
			)
	}
	const upload = async (row: DraftFile) => {
		if (!context.canWrite || !context.current()) return
		const controller = new AbortController()
		update(row.key, { controller, running: true, error: undefined })
		try {
			let attachment = await lookupChatAttachment(
				context.session!.accessToken,
				context.binding.workspaceId,
				row.commandId
			)
			if (!attachment || attachment.state === 'UPLOADING')
				attachment = await uploadChatAttachment(
					context.session!.accessToken,
					context.binding.workspaceId,
					conversationId,
					row.commandId,
					row.file,
					controller.signal,
					progress => update(row.key, { progress })
				)
			update(row.key, {
				attachment,
				running: false,
				error:
					attachment.state === 'READY'
						? undefined
						: 'Вложение недоступно. Удалите его и выберите файл снова.'
			})
		} catch {
			update(row.key, {
				running: false,
				error:
					'Результат неизвестен. Проверить / повторить загрузку тем же запросом.'
			})
		}
	}
	const add = (list: File[]) => {
		if (!enabled || !context.canWrite) return
		const current = filesRef.current
		if (
			current.length + list.length > 10 ||
			current.reduce((sum, row) => sum + row.file.size, 0) +
				list.reduce((sum, file) => sum + file.size, 0) >
				20971520 ||
			list.some(file => !file.size || file.size > 5242880)
		) {
			setError('До 10 файлов, 5 МБ на файл и 20 МБ на сообщение.')
			return
		}
		setError('')
		const rows = list.map(file => ({
			key: crypto.randomUUID(),
			commandId: crypto.randomUUID(),
			discardCommandId: crypto.randomUUID(),
			file,
			progress: 0,
			running: false
		}))
		setFiles(value => [...value, ...rows])
		for (const row of rows) void upload(row)
	}
	const remove = async (row: DraftFile) => {
		row.controller?.abort()
		if (!context.canWrite || !context.current()) return
		update(row.key, { running: true })
		try {
			const attachment =
				row.attachment ??
				(await lookupChatAttachment(
					context.session!.accessToken,
					context.binding.workspaceId,
					row.commandId
				))
			if (
				attachment &&
				!['DELETED', 'DELETING'].includes(attachment.state)
			)
				await discardChatAttachment(
					context.session!.accessToken,
					context.binding.workspaceId,
					attachment.id,
					row.discardCommandId
				)
			if (mounted.current && context.current())
				setFiles(rows => rows.filter(item => item.key !== row.key))
		} catch {
			update(row.key, {
				running: false,
				error:
					'Не удалось отменить вложение. Проверьте или повторите отмену.'
			})
		}
	}
	const reset = () => setFiles([])
	return {
		files,
		enabled,
		error,
		add,
		upload,
		remove,
		reset,
		ready: files.every(
			row =>
				row.attachment?.state === 'READY' && !row.running && !row.error
		),
		attachmentIds: files.flatMap(row =>
			row.attachment?.state === 'READY' ? [row.attachment.id] : []
		)
	}
}
