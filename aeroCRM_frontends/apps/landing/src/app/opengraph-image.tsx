import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
	return new ImageResponse(
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 88, background: '#171027', color: '#fff', fontFamily: 'Arial, sans-serif' }}>
			<div style={{ display: 'flex', fontSize: 94, fontWeight: 900, fontStyle: 'italic', letterSpacing: -5 }}><span>aero</span><span style={{ color: '#d5a0ed' }}>CRM</span></div>
			<div style={{ display: 'flex', fontSize: 49, marginTop: 48 }}>Клиенты и продажи в одном месте</div>
		</div>,
		size
	)
}
