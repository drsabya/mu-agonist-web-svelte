// src/routes/api/scene-items/[id]/+server.ts
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

// Helper: JSON response
function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

// PATCH /api/scene-items/:id  -> partial update
export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const { id } = params;
		const patch = await request.json();

		// Whitelist of updatable columns
		const allowed = [
			'scene_id',
			'kind',
			'src',
			'cx_pct',
			'cy_pct',
			'w_pct',
			'rot',
			'z_index',
			'role',
			'correct_target_id',
			'tap_message',
			'final_cx_pct',
			'final_cy_pct',
			'anim_type',
			'anim_duration_ms',
			'anim_delay_ms',
			'anim_easing',
			'anim_move_cx_pct',
			'anim_move_cy_pct',
			'anim_scale_w_pct',
			'anim_rotate_by',
			'anim_opacity_to',
			'is_scene_trigger',
			'moveable',
			'resizeable',
			'move_dir',
			'scale_factor',
			'opacity' // NEW: base opacity (0..1)
		] as const;

		const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

		// Copy only allowed keys
		for (const k of allowed) if (k in patch) payload[k] = patch[k];

		// Guard: nothing to update
		const hasUpdatable = Object.keys(payload).some((k) => k !== 'updated_at');
		if (!hasUpdatable) return json({ ok: false, error: 'No valid fields provided' }, 400);

		// Soft validation for opacity 0..1 if provided
		if ('opacity' in payload && payload.opacity !== null && payload.opacity !== undefined) {
			const v = Number(payload.opacity);
			if (Number.isNaN(v) || v < 0 || v > 1) {
				return json({ ok: false, error: 'opacity must be a number between 0 and 1' }, 400);
			}
		}

		const { error } = await supabase.from('scene_items').update(payload).eq('id', id);

		if (error) return json({ ok: false, error: error.message }, 500);
		return json({ ok: true }, 200);
	} catch (e: any) {
		return json({ ok: false, error: e?.message ?? 'Unknown error' }, 500);
	}
};

// DELETE /api/scene-items/:id  -> delete one
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { id } = params;
		const { error } = await supabase.from('scene_items').delete().eq('id', id);

		if (error) return json({ ok: false, error: error.message }, 500);
		return json({ ok: true }, 200);
	} catch (e: any) {
		return json({ ok: false, error: e?.message ?? 'Unknown error' }, 500);
	}
};
