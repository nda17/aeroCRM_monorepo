import { BrandIcon } from '@/shared/ui/brand-logo/BrandIcon'
import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
	return new ImageResponse(<BrandIcon size={size.width} />, size)
}
