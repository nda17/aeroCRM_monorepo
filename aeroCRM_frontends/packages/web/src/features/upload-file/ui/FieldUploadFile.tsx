'use client'

import { IUploadField } from '@/shared/ui/form-elements/form.interface'
import styles from '@/features/upload-file/ui/FieldUploadFile.module.scss'
import { useUploadFile } from '@/features/upload-file/model/useUploadFile'
import SkeletonLoader from '@/shared/ui/skeleton-loader/SkeletonLoader'
import clsx from 'clsx'
import { NextPage } from 'next'
import Image from 'next/image'
import { useId, useRef, useState } from 'react'
import toast from 'react-hot-toast'

const DEFAULT_AVATAR = '/avatar-default.png'

const FieldUploadFile: NextPage<IUploadField> = ({
	currentFile,
	placeholder,
	style,
	value,
	onChange,
	onUpload,
	canDelete,
	disabled,
	showFilePath,
	uploadSuccessMessage,
	onDelete
}) => {
	const [isDeleting, setIsDeleting] = useState(false)
	const operationLockRef = useRef(false)
	const { uploadFile, isLoading } = useUploadFile(onChange, onUpload, {
		operationLockRef,
		successMessage: uploadSuccessMessage
	})
	const currentImageSrc = currentFile ? encodeURI(currentFile) : ''
	const valueImageSrc = value ? encodeURI(value) : ''
	const inputId = useId()
	const busy = isLoading || isDeleting
	const avatarWasDeleted = value === null
	const hasCustomAvatar = avatarWasDeleted
		? false
		: value || (currentFile && currentFile !== DEFAULT_AVATAR)
	const fileLabel = avatarWasDeleted
		? 'Фото по умолчанию'
		: value
			? 'Фото обновлено'
			: currentFile
				? currentFile === DEFAULT_AVATAR
					? 'Фото по умолчанию'
					: 'Фото загружено'
				: 'Фото не выбрано'
	const shouldShowCurrentPath = Boolean(
		!avatarWasDeleted && currentFile && currentFile !== DEFAULT_AVATAR
	)
	const displayLabel = showFilePath
		? value ||
			(shouldShowCurrentPath ? currentFile : fileLabel) ||
			fileLabel
		: fileLabel

	const handleDelete = async () => {
		if (!onDelete || operationLockRef.current) return
		operationLockRef.current = true
		const toastId = toast.loading('Удаляем фото...')
		setIsDeleting(true)
		try {
			await onDelete()
			onChange(null)
			toast.success('Фото удалено', { id: toastId })
		} catch {
			toast.error('Не удалось удалить фото', { id: toastId })
		} finally {
			operationLockRef.current = false
			setIsDeleting(false)
		}
	}

	const avatarPreview = (
		<div className={styles['preview-wrapper']}>
			<div className={clsx(styles['file-preview'])}>
				{busy ? (
					<div className="w-full h-full">
						<SkeletonLoader count={1} className="w-full h-full p-1" />
					</div>
				) : value ? (
					<Image
						src={valueImageSrc}
						alt={placeholder}
						priority
						fill
						unoptimized
					/>
				) : avatarWasDeleted ? (
					<Image
						src={DEFAULT_AVATAR}
						alt={placeholder}
						priority
						fill
						unoptimized
					/>
				) : (
					<Image
						src={currentImageSrc}
						alt={placeholder}
						priority
						fill
						unoptimized
					/>
				)}
			</div>
			{canDelete && onDelete && hasCustomAvatar && (
				<button
					type="button"
					className={styles['delete-button']}
					onClick={handleDelete}
					disabled={busy}
					title="Удалить фото"
				>
					<svg
						viewBox="0 0 10 10"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M1 1L9 9M9 1L1 9"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			)}
		</div>
	)

	return (
		<div
			className={clsx(
				styles.wrapper,
				showFilePath && styles['wrapper-with-path']
			)}
			style={style}
		>
			<p className={clsx(styles['field-path'])}>{displayLabel}</p>
			<div className={styles.controls}>
				{disabled ? (
					avatarPreview
				) : (
					<>
						<label className={clsx(styles['label-input'])}>
							<span className="srOnly">Загрузить файл</span>
							<span className={clsx(styles['custom-input'])}>
								<span className={styles.button} aria-hidden="true">
									Загрузить файл
								</span>
							</span>
							<input
								id={inputId}
								type="file"
								accept="image/jpeg,image/png,image/webp"
								onChange={uploadFile}
								disabled={busy}
								className={clsx(styles['input-field'])}
								aria-label={placeholder}
							/>
						</label>
						{avatarPreview}
					</>
				)}
			</div>
		</div>
	)
}

export default FieldUploadFile
