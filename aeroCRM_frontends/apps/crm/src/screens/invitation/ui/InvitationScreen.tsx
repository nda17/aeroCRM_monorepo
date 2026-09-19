import { InvitationFlow } from '@/features/accept-invitation'
import styles from './InvitationScreen.module.scss'

export const InvitationScreen = ({
	invitationId
}: {
	invitationId: string
}) => (
	<main className={styles.viewport}>
		<section className={styles.panel}>
			<h1 className={styles.brand}>aeroCRM</h1>
			<InvitationFlow invitationId={invitationId} />
		</section>
	</main>
)
