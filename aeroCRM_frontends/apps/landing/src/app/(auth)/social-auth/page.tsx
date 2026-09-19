import { SocialAuth } from '@/screens/auth'
import { Suspense } from 'react'

const SocialAuthPage = () => {
	return (
		<Suspense fallback={null}>
			<SocialAuth />
		</Suspense>
	)
}

export default SocialAuthPage
