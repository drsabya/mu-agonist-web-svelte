<script lang="ts">
	import type { PageData } from './$types';
	import SceneList from '$lib/components/cms/ScenesList.svelte';

	// runes-style props
	let {
		data
	}: {
		data: PageData & {
			scenes: {
				id: string;
				title: string;
				status: string | null;
				scene_type: 'dragdrop' | 'tap' | 'slider' | 'media';
			}[];
		};
	} = $props();

	function confirmToggle(e: SubmitEvent, next: 'published' | 'draft') {
		if (
			!confirm(
				`Are you sure you want to ${next === 'published' ? 'publish' : 'unpublish'} this scene?`
			)
		) {
			e.preventDefault();
		}
	}

	function confirmDelete(e: SubmitEvent) {
		if (!confirm('Delete this scene permanently?')) {
			e.preventDefault();
		}
	}
</script>

<div class="p-3 font-mono">
	<!-- CREATE: title + scene_type (fixed after creation) -->
	<form class="flex flex-col gap-2 border p-3" method="post" action="?/create">
		<h1 class="font-bold">Create a scene</h1>

		<input
			class="w-full border p-2"
			name="title"
			placeholder="Scene title"
			required
			autocomplete="off"
		/>

		<div class="flex items-center gap-2">
			<label for="scene_type" class="text-sm">Type</label>
			<select id="scene_type" name="scene_type" class="border p-2 text-sm" required>
				<option value="dragdrop" selected>Drag & Drop</option>
				<option value="tap">Tap</option>
				<option value="slider">Slider</option>
				<option value="media">Media</option>
			</select>
		</div>

		<button class="bg-black p-2 text-white" type="submit">Create</button>
	</form>

	<br />

	<h2 class="text-center font-bold">List of Scenes</h2>
	<!-- Reuse the list component (it doesn't need to show or edit scene_type) -->
	<SceneList scenes={data.scenes} />
</div>
