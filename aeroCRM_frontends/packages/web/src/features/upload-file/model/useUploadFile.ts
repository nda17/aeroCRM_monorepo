import { errorCatch } from '@/shared/api'
import { useMutation } from '@tanstack/react-query'
import {
	ChangeEvent,
	MutableRefObject,
	useCallback,
	useMemo,
	useState
} from 'react'
import toast from 'react-hot-toast'

interface IUseUploadFileOptions {
	operationLockRef: MutableRefObject<boolean>
	successMessage?: string
}

const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_AVATAR_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp'
])

const getAvatarValidationError = (file: File) => {
	if (!ALLOWED_AVATAR_MIME_TYPES.has(file.type)) {
		return 'Можно загрузить только PNG, JPEG или WebP'
	}

	if (file.size > MAX_AVATAR_FILE_SIZE) {
		return 'Размер фото не должен превышать 5 МБ'
	}

	return null
}

export const useUploadFile = (
	onChange: (fileUrl: string | null) => void,
	onUpload: (file: File) => Promise<string>,
	options: IUseUploadFileOptions
) => {
	const { operationLockRef, successMessage } = options
	const [isProcessing, setIsProcessing] = useState(false)
	const { mutateAsync } = useMutation({
		mutationKey: ['upload-avatar'],
		mutationFn: onUpload
	})

	const uploadFile = useCallback(
		async (e: ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files

			if (!files?.length || operationLockRef.current) {
				e.target.value = ''
				return
			}

			const file = files[0]
			const validationError = getAvatarValidationError(file)

			if (validationError) {
				toast.error(validationError)
				e.target.value = ''
				return
			}

			operationLockRef.current = true
			const toastId = toast.loading('Загружаем фото...')
			setIsProcessing(true)
			try {
				const fileUrl = await mutateAsync(file)
				onChange(fileUrl)
				toast.success(successMessage || 'Фото загружено', {
					id: toastId
				})
			} catch (error) {
				const message = errorCatch(error) || 'Не удалось загрузить фото'

				toast.error(`Ошибка загрузки фото: ${message}`, {
					id: toastId
				})
			} finally {
				operationLockRef.current = false
				setIsProcessing(false)
				e.target.value = ''
			}
		},
		[mutateAsync, onChange, operationLockRef, successMessage]
	)

	return useMemo(
		() => ({ uploadFile, isLoading: isProcessing }),
		[uploadFile, isProcessing]
	)
}
