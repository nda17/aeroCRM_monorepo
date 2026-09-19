'use client'

import NextLink from 'next/link'
import { forwardRef, type ComponentProps } from 'react'
import { needsDocumentNavigation } from './frontend-zones'

type ZoneLinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & {
	href: string
}

// Cross-app links must not request another application's RSC payload or chunks.
const ZoneLink = forwardRef<HTMLAnchorElement, ZoneLinkProps>(
	function ZoneLink(props, ref) {
		if (!needsDocumentNavigation(props.href))
			return <NextLink {...props} ref={ref} />
		const {
			children,
			as: _as,
			replace: _replace,
			scroll: _scroll,
			shallow: _shallow,
			prefetch: _prefetch,
			locale: _locale,
			legacyBehavior: _legacyBehavior,
			passHref: _passHref,
			...anchor
		} = props
		void [
			_as,
			_replace,
			_scroll,
			_shallow,
			_prefetch,
			_locale,
			_legacyBehavior,
			_passHref
		]
		return (
			<a {...anchor} ref={ref}>
				{children}
			</a>
		)
	}
)

export default ZoneLink
