import brand from '../../../../brand/aerocrm-wing.json'
import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
	return new ImageResponse(
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 88, background: '#171027', color: '#fff', fontFamily: 'Arial, sans-serif' }}>
			<svg width="858" height="198" viewBox={brand.viewBox}><path d={brand.wing} fill="#efc85b" /><path d={brand.wordmark} fill="#ffffff" /></svg>
			<div style={{ display: 'flex', fontSize: 49, marginTop: 48 }}>Клиенты и продажи в одном месте</div>
		</div>,
		size
	)
}
