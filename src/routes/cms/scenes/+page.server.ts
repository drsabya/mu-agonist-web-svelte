import type { Actions, PageServerLoad } from './$types';
import { supabase } from '$lib/supabaseClient';
import { fail } from '@sveltejs/kit';

type SceneListItem = {
	id: string;
	title: string;
	status: string | null;
	scene_type: 'dragdrop' | 'tap' | 'slider' | 'media';
	updated_at: string;
};

export const load: PageServerLoad = async () => {
	const { data, error } = await supabase
		.from('scenes')
		.select('id, title, status, scene_type, updated_at')
		.order('updated_at', { ascending: false })
		.limit(50);

	if (error) {
		console.error('Error loading scenes:', error.message);
		return { scenes: [] as SceneListItem[] };
	}

	return { scenes: (data ?? []) as SceneListItem[] };
};

export const actions: Actions = {
	// Create a new scene (title + scene_type only)
	create: async ({ request }) => {
		const fd = await request.formData();
		const title = String(fd.get('title') ?? '').trim();
		const scene_type = String(fd.get('scene_type') ?? 'dragdrop').trim() as
			| 'dragdrop'
			| 'tap'
			| 'slider'
			| 'media';

		if (!title) return fail(400, { error: 'Title is required.' });

		const allowed = ['dragdrop', 'tap', 'slider', 'media'];
		if (!allowed.includes(scene_type)) {
			return fail(400, { error: 'Invalid scene type.' });
		}

		const { data, error } = await supabase
			.from('scenes')
			.insert({
				title,
				scene_type, // <- fixed at creation
				status: 'draft' // default status
			})
			.select('id')
			.single();

		if (error) {
			console.error('Create scene error:', error.message);
			return fail(500, { error: 'Failed to create scene.' });
		}

		return { ok: true, id: data?.id as string };
	},

	// Delete a scene
	delete: async ({ request }) => {
		const fd = await request.formData();
		const id = String(fd.get('id') ?? '');
		if (!id) return fail(400, { error: 'Scene id is required.' });

		const { error } = await supabase.from('scenes').delete().eq('id', id);
		if (error) {
			console.error('Delete scene error:', error.message);
			return fail(500, { error: 'Failed to delete scene.' });
		}
		return { ok: true };
	},

	// Toggle publish: 'draft' <-> 'published'
	publish: async ({ request }) => {
		const fd = await request.formData();
		const id = String(fd.get('id') ?? '');
		const next_status = String(fd.get('next_status') ?? '').trim();

		if (!id) return fail(400, { error: 'Scene id is required.' });
		if (!['published', 'draft'].includes(next_status)) {
			return fail(400, { error: 'Invalid next status.' });
		}

		const { error } = await supabase
			.from('scenes')
			.update({
				status: next_status,
				updated_at: new Date().toISOString()
			})
			.eq('id', id);

		if (error) {
			console.error('Toggle publish error:', error.message);
			return fail(500, { error: 'Failed to change publish status.' });
		}

		return { ok: true };
	}
};
