// src/routes/api/scenes/[id]/+server.ts
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

type McqOption = {
	text: string;
	is_correct?: boolean;
	explanation?: string | null;
};

function sanitizeMcqOptions(input: unknown): McqOption[] | null {
	if (!Array.isArray(input)) return null;
	const out: McqOption[] = [];
	for (const raw of input) {
		if (raw && typeof raw === 'object') {
			const text = String((raw as any).text ?? '').trim();
			const is_correct = Boolean((raw as any).is_correct);
			const explanationRaw = (raw as any).explanation;
			const explanation =
				explanationRaw === undefined || explanationRaw === null
					? null
					: String(explanationRaw).trim();

			// Only push if we at least have text
			if (text.length > 0) {
				out.push({ text, is_correct, explanation });
			}
		}
	}
	return out;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	const patch = await request.json();

	// Whitelist fields
	const allowed = [
		'title',
		'description',
		'explanation',
		'access_tier',
		'status',
		'thumbnail_src',
		'background_color',
		'canvas_width_px',
		'canvas_height_px',
		'slider_min',
		'slider_max',
		'slider_step',
		'tags',
		'subjects',
		'mcq_options' // ✅ NEW
	];

	const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

	for (const k of allowed) {
		if (!(k in patch)) continue;

		if (k === 'mcq_options') {
			const sanitized = sanitizeMcqOptions(patch.mcq_options);
			if (sanitized) payload.mcq_options = sanitized;
			else payload.mcq_options = []; // fallback to empty array if bad input
			continue;
		}

		payload[k] = patch[k];
	}

	const { error } = await supabase.from('scenes').update(payload).eq('id', id);

	if (error) {
		return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
	}
	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
