import { SessionGate } from '@/features/session-bootstrap'
import { BillingScreen } from '@/screens/billing'

export default function BillingPage() {
	return (
		<SessionGate>
			<BillingScreen />
		</SessionGate>
	)
}
