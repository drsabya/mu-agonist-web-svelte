import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';

const supabase: Handle = async ({ event, resolve }) => {
	// Attach a per-request Supabase client
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	// Safe session getter (validates JWT)
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) return { session: null, user: null };
		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

const authGuard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	event.locals.role = null;
	event.locals.isAdmin = false;

	// ✅ If signed in, ALWAYS fetch role (not just under /cms)
	if (session && user) {
		const { data: roleRow, error: roleErr } = await event.locals.supabase
			.from('user_roles')
			.select('role')
			.eq('user_id', user.id)
			.maybeSingle();

		if (!roleErr) {
			event.locals.role = roleRow?.role ?? null;
			event.locals.isAdmin = roleRow?.role === 'admin';
		}
	}

	// 🔒 Protect /cms and everything under it
	if (event.url.pathname.startsWith('/cms')) {
		if (!session || !user) {
			throw redirect(303, '/auth');
		}
		if (!event.locals.isAdmin) {
			throw redirect(303, '/forbidden');
		}
	}

	// If already signed in, keep /auth out of the way
	if (session && event.url.pathname === '/auth') {
		throw redirect(303, '/cms');
	}

	return resolve(event);
};

export const handle: Handle = sequence(supabase, authGuard);
