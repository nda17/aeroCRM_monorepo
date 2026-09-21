export const validEmail =
	/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

export const validPassword = /(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])\S{6,}/g

export const validName = new RegExp(
	"^[\\p{L}][\\p{L}\\p{M}\\p{N} .’'-]*$",
	'u'
)

export const validPhone = /^[0-9+()\-\s]{10,20}$/

export const validPhoneCode = /^\d{4,6}$/
