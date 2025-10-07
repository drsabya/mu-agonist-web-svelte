import { fail, redirect, type Actions } from '@sveltejs/kit';

export const actions: Actions = {
	login: async ({ request, locals, url }) => {
		const data = await request.formData();
		const email = (data.get('email') ?? '').toString().trim();
		if (!email) return fail(400, { error: 'Email is required' });

		// Where the magic link should bring the user back
		const emailRedirectTo = `${url.origin}/auth/confirm?next=${encodeURIComponent('/')}`;

		const { error } = await locals.supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo }
		});

		if (error) return fail(400, { error: error.message });
		return { message: 'Check your email for a magic link.' };
	}
};
