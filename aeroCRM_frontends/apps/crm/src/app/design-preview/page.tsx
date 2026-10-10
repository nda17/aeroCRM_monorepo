import { notFound } from 'next/navigation'
import DesignPreview from '@/screens/design-preview/ui/DesignPreview'

export default function DesignPreviewPage() {
	if (
		process.env.NODE_ENV !== 'development' ||
		process.env.CRM_DESIGN_PREVIEW !== '1'
	)
		notFound()

	return <DesignPreview />
}
