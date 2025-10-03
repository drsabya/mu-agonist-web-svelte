import type { Actions, PageServerLoad } from './$types';
import { supabase } from '$lib/supabaseClient';
import { error, fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	// +page.server.ts
	const { id } = params;

	// 1) scene (if you still need it)
	const { data: scene, error: sceneErr } = await supabase
		.from('scenes')
		.select('*')
		.eq('id', id)
		.single();
	if (sceneErr || !scene) throw error(404, 'Scene not found');

	// 2) items for that scene
	const { data: items, error: itemsErr } = await supabase
		.from('scene_items')
		.select('*')
		.eq('scene_id', id)
		.order('z_index', { ascending: true });
	if (itemsErr) throw error(500, itemsErr.message);

	return { scene, items };
};
