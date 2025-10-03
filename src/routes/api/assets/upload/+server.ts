// src/routes/api/assets/upload/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { BUNNY_STORAGE_ZONE, BUNNY_ACCESS_KEY, BUNNY_REGION_HOST } from '$env/static/private';

function bad(msg: string, status = 400) {
	return json({ ok: false, error: msg }, { status });
}

export const POST: RequestHandler = async ({ request }) => {
	// ---- Validate envs
	if (!BUNNY_STORAGE_ZONE) return bad('Missing BUNNY_STORAGE_ZONE (server env)');
	if (!BUNNY_ACCESS_KEY) return bad('Missing BUNNY_ACCESS_KEY (server env)');
	if (!BUNNY_REGION_HOST) return bad('Missing BUNNY_REGION_HOST (server env)');

	try {
		const body = await request.json().catch(() => ({}));
		const svg: string = body?.svg;
		let object_key: string | undefined = body?.object_key;

		if (typeof svg !== 'string' || !svg.includes('<svg')) {
			return bad('Invalid or missing SVG string');
		}

		// normalize object_key
		if (!object_key) object_key = `svgs/${crypto.randomUUID()}.svg`;
		object_key = object_key.replace(/^\/+/, ''); // no leading slash

		// PUT https://{REGION_HOST}/{ZONE}/{OBJECT_KEY}
		const url = `https://${BUNNY_REGION_HOST}/${encodeURIComponent(BUNNY_STORAGE_ZONE)}/${object_key
			.split('/')
			.map(encodeURIComponent)
			.join('/')}`;

		const res = await fetch(url, {
			method: 'PUT',
			headers: {
				AccessKey: BUNNY_ACCESS_KEY,
				'Content-Type': 'image/svg+xml; charset=utf-8'
			},
			body: svg
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			// surface the exact Bunny error to the client
			return json(
				{
					ok: false,
					error: `Bunny upload failed (${res.status} ${res.statusText})`,
					detail: text || null
				},
				{ status: 502 }
			);
		}

		return json({ ok: true, object_key });
	} catch (err: any) {
		return json({ ok: false, error: err?.message ?? 'Upload failed' }, { status: 500 });
	}
};
