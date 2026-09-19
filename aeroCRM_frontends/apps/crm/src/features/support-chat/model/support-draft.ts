import type {
	SupportAttachment,
	SupportCreateCommand,
	SupportReplyCommand
} from '@/entities/support'

export interface SupportDraftFile {
	commandId: string
	file: File
	preview: string
	attachment?: SupportAttachment
	state: 'uploading' | 'ready' | 'error'
	error?: string
}
export interface SupportDraft {
	draftId: string
	subject: string
	text: string
	files: SupportDraftFile[]
	pending?: SupportCreateCommand | SupportReplyCommand
	error?: string
	sending: boolean
}
export const newSupportDraft = (): SupportDraft => ({
	draftId: crypto.randomUUID(),
	subject: '',
	text: '',
	files: [],
	sending: false
})
export const disposeSupportDraft = (draft: SupportDraft) =>
	draft.files.forEach(item => URL.revokeObjectURL(item.preview))

/** Session-scoped command memory. It is never serialized to browser storage. */
export class SupportDrafts {
	private readonly items = new Map<string, SupportDraft>()
	get(key: string) {
		let draft = this.items.get(key)
		if (!draft) {
			draft = newSupportDraft()
			this.items.set(key, draft)
		}
		return draft
	}
	delete(key: string) {
		this.items.delete(key)
	}
	clear() {
		this.items.forEach(disposeSupportDraft)
		this.items.clear()
	}
}
export const prepareSupportCommand = (
	draft: SupportDraft,
	actor: string,
	context?: { workspaceId?: string; section: string; appVersion: string }
) => {
	if (draft.pending) return draft.pending
	if (
		!draft.text.trim() ||
		draft.text.trim().length > 10000 ||
		draft.files.some(item => item.state !== 'ready' || !item.attachment)
	)
		throw new Error('Введите сообщение и дождитесь загрузки изображений.')
	if (
		context &&
		(!draft.subject.trim() || draft.subject.trim().length > 160)
	)
		throw new Error('Укажите тему обращения: до 160 символов.')
	const base: SupportReplyCommand = {
		commandId: crypto.randomUUID(),
		expectedActorSubject: actor,
		text: draft.text.trim(),
		attachmentIds: draft.files.map(item => item.attachment!.id)
	}
	return Object.freeze(
		context
			? {
					...base,
					...context,
					draftId: draft.draftId,
					subject: draft.subject.trim()
				}
			: base
	)
}
