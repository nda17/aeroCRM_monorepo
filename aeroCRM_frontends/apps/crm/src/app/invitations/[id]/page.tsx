import { SessionGate } from '@/features/session-bootstrap'
import { InvitationScreen } from '@/screens/invitation'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Приглашение' }

const InvitationPage = async ({
	params
}: {
	params: Promise<{ id: string }>
}) => {
	const { id } = await params
	return (
		<SessionGate>
			<InvitationScreen invitationId={id} />
		</SessionGate>
	)
}

export default InvitationPage
