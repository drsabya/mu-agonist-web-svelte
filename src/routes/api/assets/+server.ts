// src/routes/api/assets/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		const { title, provider, bucket_or_zone, object_key, public_url, content_type } = body;

		if (!title || !provider || !bucket_or_zone || !object_key || !public_url) {
			return new Response(JSON.stringify({ ok: false, error: 'Missing required fields' }), {
				status: 400
			});
		}

		const { data, error } = await supabase
			.from('assets')
			.insert([
				{
					title,
					provider,
					bucket_or_zone,
					object_key,
					public_url,
					content_type: content_type ?? 'image/svg+xml'
				}
			])
			.select()
			.single();

		if (error) throw error;

		return json({ ok: true, asset: data });
	} catch (err: any) {
		return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
	}
};
