import type { RequestHandler } from './$types';
import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	// Support both formats: ?code=...  (recommended) AND ?token_hash=...&type=magiclink (legacy)
	const code = url.searchParams.get('code');
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = url.searchParams.get('next') ?? '/';

	// Build a clean redirect target (strip auth params)
	const redirectTo = new URL(url);
	redirectTo.pathname = next;
	['code', 'token_hash', 'type', 'next'].forEach((k) => redirectTo.searchParams.delete(k));

	// Preferred: exchangeCodeForSession
	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) throw redirect(303, redirectTo);
	}

	// Fallback: verifyOtp (works for token_hash/type links)
	if (token_hash && type) {
		const { error } = await supabase.auth.verifyOtp({ token_hash, type });
		if (!error) throw redirect(303, redirectTo);
	}

	// Error → send to /auth with a message
	throw redirect(303, '/auth?error=invalid_or_expired_link');
};
