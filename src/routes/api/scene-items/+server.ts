// src/routes/api/scene-items/+server.ts
import type { RequestHandler } from './$types';
import { supabase } from '$lib/supabaseClient';

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function isNumber(n: unknown) {
	return typeof n === 'number' && Number.isFinite(n);
}

// POST /api/scene-items  -> create one item
// Body: { scene_id, kind, src, cx_pct, cy_pct, w_pct, ... }
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		// Required fields
		const required = ['scene_id', 'kind', 'src', 'cx_pct', 'cy_pct', 'w_pct'] as const;
		for (const k of required) {
			if (!(k in body)) {
				return json({ ok: false, error: `Missing field: ${k}` }, 400);
			}
		}

		// Soft validation for opacity 0..1 (if provided)
		if (body.opacity !== undefined && body.opacity !== null) {
			const v = Number(body.opacity);
			if (Number.isNaN(v) || v < 0 || v > 1) {
				return json({ ok: false, error: 'opacity must be a number between 0 and 1' }, 400);
			}
		}

		const insertPayload = {
			scene_id: body.scene_id,
			kind: body.kind, // 'svg' | 'image' (DB check constraint will enforce)
			src: body.src,
			cx_pct: body.cx_pct,
			cy_pct: body.cy_pct,
			w_pct: body.w_pct,
			rot: body.rot ?? 0,
			z_index: body.z_index ?? 0,
			role: body.role ?? 'none',
			correct_target_id: body.correct_target_id ?? null,
			tap_message: body.tap_message ?? null,
			final_cx_pct: body.final_cx_pct ?? null,
			final_cy_pct: body.final_cy_pct ?? null,
			anim_type: body.anim_type ?? 'none',
			anim_duration_ms: body.anim_duration_ms ?? null,
			anim_delay_ms: body.anim_delay_ms ?? null,
			anim_easing: body.anim_easing ?? null,
			anim_move_cx_pct: body.anim_move_cx_pct ?? null,
			anim_move_cy_pct: body.anim_move_cy_pct ?? null,
			anim_scale_w_pct: body.anim_scale_w_pct ?? null,
			anim_rotate_by: body.anim_rotate_by ?? null,
			anim_opacity_to: body.anim_opacity_to ?? null,
			is_scene_trigger: body.is_scene_trigger ?? false,
			moveable: body.moveable ?? false,
			resizeable: body.resizeable ?? false,
			move_dir: body.move_dir ?? null,
			scale_factor: body.scale_factor ?? 1.0,
			opacity: isNumber(body.opacity) ? body.opacity : 1.0 // NEW: base opacity
		};

		const { data, error } = await supabase
			.from('scene_items')
			.insert(insertPayload)
			.select('id')
			.single();

		if (error) return json({ ok: false, error: error.message }, 500);
		return json({ ok: true, id: data?.id }, 201);
	} catch (e: any) {
		return json({ ok: false, error: e?.message ?? 'Unknown error' }, 500);
	}
};

// OPTIONAL: bulk delete helper
// DELETE /api/scene-items?scene_id=...  body: { keepIds?: string[] }
// Deletes all items in scene that are NOT in keepIds
export const DELETE: RequestHandler = async ({ url, request }) => {
	try {
		const scene_id = url.searchParams.get('scene_id');
		if (!scene_id) return json({ ok: false, error: 'scene_id is required' }, 400);

		let keepIds: string[] = [];
		try {
			const body = await request.json().catch(() => ({}));
			keepIds = Array.isArray(body?.keepIds) ? body.keepIds.filter(Boolean) : [];
		} catch {
			keepIds = [];
		}

		// Base delete query
		let query = supabase.from('scene_items').delete().eq('scene_id', scene_id);

		// If keepIds present, do NOT IN (...). Quote UUIDs to be safe.
		if (keepIds.length > 0) {
			const quoted = keepIds.map((id) => `"${id}"`).join(',');
			query = query.not('id', 'in', `(${quoted})`);
		}

		const { error } = await query;
		if (error) return json({ ok: false, error: error.message }, 500);
		return json({ ok: true }, 200);
	} catch (e: any) {
		return json({ ok: false, error: e?.message ?? 'Unknown error' }, 500);
	}
};
