import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';

const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
	auth: { persistSession: false }
});

function escapeLike(input: string) {
	return input.replace(/[%_]/g, (m) => '\\' + m);
}

export async function GET({ url }) {
	const q = (url.searchParams.get('q') ?? '').trim();
	const limitParam = Number(url.searchParams.get('limit') ?? 20);
	const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

	// No query → no results
	if (!q) return json({ ok: true, data: [], count: 0 });

	const pattern = `%${escapeLike(q)}%`;
	const { data, error, count } = await supabase
		.from('assets')
		.select('id,title,public_url', { count: 'exact' })
		.ilike('title', pattern)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) return json({ ok: false, error: error.message }, { status: 500 });
	return json({ ok: true, data: data ?? [], count: count ?? 0 });
}
