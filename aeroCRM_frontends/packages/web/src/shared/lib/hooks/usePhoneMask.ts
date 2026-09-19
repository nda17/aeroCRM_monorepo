import { useCallback, useRef, useState } from 'react'
import type {
	FieldValues,
	Path,
	PathValue,
	UseFormSetValue
} from 'react-hook-form'

const MASK = '+7 (9__) ___-__-__'

type PhoneMaskHandlers = {
	onFocus: (e: React.FocusEvent<HTMLInputElement>) => void
	onClick: (e: React.MouseEvent<HTMLInputElement>) => void
	onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
	onBeforeInput: (e: React.FormEvent<HTMLInputElement>) => void
	onInput: (e: React.FormEvent<HTMLInputElement>) => void
	onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
	onBlur: (e: React.FocusEvent<HTMLInputElement>) => void
	reset: () => void
	isMaskEmpty: boolean
}

export const usePhoneMask = <
	TFieldValues extends FieldValues & { phone?: string }
>(
	setValue: UseFormSetValue<TFieldValues>,
	inputRef: React.RefObject<HTMLInputElement>
): PhoneMaskHandlers => {
	const phoneField = 'phone' as Path<TFieldValues>

	const digitsRef = useRef('')
	const syncingRef = useRef(false)
	const interactedRef = useRef(false)
	const [isMaskEmpty, setIsMaskEmpty] = useState(true)

	const updateMaskEmpty = useCallback((isEmpty: boolean) => {
		setIsMaskEmpty(isEmpty)
	}, [])

	const normalizeDigits = useCallback((digitsOnly: string) => {
		if (!digitsOnly) return ''

		// Full number like 79991234567 or 89991234567
		if (
			digitsOnly.length === 11 &&
			(digitsOnly.startsWith('7') || digitsOnly.startsWith('8'))
		) {
			const rest = digitsOnly.slice(1) // 10 digits
			return rest.slice(1, 10) // drop leading 9 (fixed in mask), keep 9 digits
		}

		// Local 10 digits like 9991234567
		if (digitsOnly.length === 10) {
			return digitsOnly.slice(1) // drop leading 9, keep 9 digits
		}

		return digitsOnly.slice(-9)
	}, [])

	const moveCursor = useCallback(() => {
		const input = inputRef.current
		if (!input) return
		const pos = input.value.indexOf('_')
		const caret = pos === -1 ? input.value.length : pos
		requestAnimationFrame(() => {
			input.setSelectionRange(caret, caret)
		})
	}, [inputRef])

	const renderMask = useCallback(() => {
		let result = MASK.split('')
		let d = 0

		for (let i = 0; i < result.length; i++) {
			if (result[i] === '_' && digitsRef.current[d]) {
				result[i] = digitsRef.current[d++]
			}
		}

		const nextValue = result.join('')
		const currentValue = inputRef.current?.value ?? ''

		if (currentValue === nextValue) {
			return
		}

		const isEmpty = digitsRef.current.length === 0
		updateMaskEmpty(isEmpty)
		syncingRef.current = true
		setValue(
			phoneField,
			nextValue as PathValue<TFieldValues, typeof phoneField>,
			{
				shouldValidate: interactedRef.current,
				shouldDirty: interactedRef.current,
				shouldTouch: interactedRef.current
			}
		)
		syncingRef.current = false
		moveCursor()
	}, [inputRef, moveCursor, phoneField, setValue, updateMaskEmpty])

	const onFocus = useCallback(() => {
		const input = inputRef.current
		if (!input) return
		if (!input.value) {
			renderMask()
		}
	}, [inputRef, renderMask])

	const onClick = useCallback(() => {
		moveCursor()
	}, [moveCursor])

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (/\d/.test(e.key)) {
				if (digitsRef.current.length < 9) {
					interactedRef.current = true
					digitsRef.current += e.key
					updateMaskEmpty(false)
					renderMask()
				}
				e.preventDefault()
				return
			}

			if (e.key === 'Backspace') {
				interactedRef.current = true
				digitsRef.current = digitsRef.current.slice(0, -1)
				updateMaskEmpty(digitsRef.current.length === 0)
				renderMask()
				e.preventDefault()
				return
			}

			if (!['ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
				e.preventDefault()
			}
		},
		[renderMask, updateMaskEmpty]
	)

	const onPaste = useCallback(
		(e: React.ClipboardEvent<HTMLInputElement>) => {
			const text = e.clipboardData.getData('text')
			const digitsOnly = text.replace(/\D/g, '')
			interactedRef.current = true
			digitsRef.current = normalizeDigits(digitsOnly)
			updateMaskEmpty(digitsRef.current.length === 0)
			renderMask()
			e.preventDefault()
		},
		[normalizeDigits, renderMask, updateMaskEmpty]
	)

	const onBeforeInput = useCallback(
		(e: React.FormEvent<HTMLInputElement>) => {
			const nativeEvent = e.nativeEvent as InputEvent
			if (nativeEvent.inputType === 'deleteContentBackward') {
				digitsRef.current = digitsRef.current.slice(0, -1)
				renderMask()
				e.preventDefault()
			}
		},
		[renderMask]
	)

	const onInput = useCallback(
		(e: React.FormEvent<HTMLInputElement>) => {
			if (syncingRef.current) {
				return
			}
			const target = e.currentTarget
			const digitsOnly = target.value.replace(/\D/g, '')
			if (digitsOnly.length) {
				interactedRef.current = true
				digitsRef.current = normalizeDigits(digitsOnly)
				updateMaskEmpty(false)
				renderMask()
			}
		},
		[normalizeDigits, renderMask, updateMaskEmpty]
	)

	const onBlur = useCallback(() => {
		if (!digitsRef.current.length) {
			updateMaskEmpty(true)
			setValue(
				phoneField,
				'' as PathValue<TFieldValues, typeof phoneField>,
				{
					shouldDirty: interactedRef.current,
					shouldValidate: interactedRef.current,
					shouldTouch: interactedRef.current
				}
			)
		}
	}, [phoneField, setValue, updateMaskEmpty])

	const reset = useCallback(() => {
		digitsRef.current = ''
		interactedRef.current = false
		updateMaskEmpty(true)
		setValue(
			phoneField,
			'' as PathValue<TFieldValues, typeof phoneField>,
			{
				shouldDirty: false,
				shouldValidate: false
			}
		)
	}, [phoneField, setValue, updateMaskEmpty])

	return {
		onFocus,
		onClick,
		onKeyDown,
		onBeforeInput,
		onInput,
		onPaste,
		onBlur,
		reset,
		isMaskEmpty
	}
}
