import { CSSProperties, InputHTMLAttributes } from 'react'
import { FieldError, FieldErrorsImpl, Merge } from 'react-hook-form'

export interface IFieldProps {
	error?: FieldError | Merge<FieldError, FieldErrorsImpl<any>> | undefined
}

type TypeInputPropsField = InputHTMLAttributes<HTMLInputElement> &
	IFieldProps

export interface IField extends TypeInputPropsField {}

export interface IUploadField {
	currentFile?: string
	value?: string | null
	onChange: (fileUrl: string | null) => void
	onUpload: (file: File) => Promise<string>
	placeholder: string
	error?: FieldError
	style?: CSSProperties
	canDelete?: boolean
	disabled?: boolean
	showFilePath?: boolean
	uploadSuccessMessage?: string
	onDelete?: () => Promise<void>
}
