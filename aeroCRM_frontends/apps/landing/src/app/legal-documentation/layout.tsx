import PageWidthScope from '@/app/_ui/PageWidthScope'
import type { PropsWithChildren } from 'react'

const LegalDocumentationLayout = ({
	children
}: PropsWithChildren<unknown>) => {
	return <PageWidthScope>{children}</PageWidthScope>
}

export default LegalDocumentationLayout
