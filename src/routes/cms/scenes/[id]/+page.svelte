<script lang="ts">
	import Canvas from '$lib/components/cms/Canvas.svelte';
	import SceneEditor from '$lib/components/cms/SceneEditor.svelte';
	import SceneMetadata from '$lib/components/cms/SceneMetadata.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData & { scene: any; items: any[] } } = $props();
	// e.g. <SceneEditor items={data.items} />

	// local editable copy (optimistic UI)
	let scene = $state({ ...data.scene });

	// debounce saving to /api/scenes/[id]
	let t: ReturnType<typeof setTimeout> | null = null;
	function scheduleSave(partial: Record<string, unknown>) {
		Object.assign(scene, partial); // optimistic update
		if (t) clearTimeout(t);
		t = setTimeout(async () => {
			await fetch(`/api/scenes/${scene.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(partial)
			}).catch(() => {
				/* optionally show retry UI */
			});
		}, 500);
	}

	type TabKey = 'metadata' | 'scene' | 'preview';
	let activeTab: TabKey = $state('metadata');

	const tabs: { key: TabKey; label: string }[] = [
		{ key: 'metadata', label: 'Metadata' },
		{ key: 'scene', label: 'Scene' },
		{ key: 'preview', label: 'Preview' }
	];

	function setTab(key: TabKey) {
		activeTab = key;
	}

	function cls(tabKey: TabKey) {
		const base = 'px-3 py-2 text-sm border-b-2 -mb-px transition-colors focus:outline-none';
		return tabKey === activeTab
			? `${base} border-black text-black`
			: `${base} border-transparent text-gray-500 hover:text-black`;
	}
</script>

<div class="flex flex-col gap-3 p-4 font-mono">
	<a href="/cms/scenes" class="text-sm underline underline-offset-2">&larr; Back</a>

	<!-- Tabs -->
	<div class="mt-2">
		<div class="flex gap-4 border-b">
			{#each tabs as t}
				<button type="button" class={cls(t.key)} onclick={() => setTab(t.key)}>
					{t.label}
				</button>
			{/each}
		</div>

		<!-- Panels -->
		<div class="pt-4">
			{#if activeTab === 'metadata'}
				<SceneMetadata {scene} onChange={scheduleSave} />
			{:else if activeTab === 'scene'}
				<SceneEditor id={scene.id} scene_type={scene.scene_type} {data} />
				<!-- <Canvas bg={scene.background_color} /> -->
			{:else if activeTab === 'preview'}
				<!-- Placeholder: put your live preview here -->
				<div class="rounded border p-4 text-sm text-gray-600">
					Preview area will render here. (Coming soon)
				</div>
			{/if}
		</div>
	</div>
</div>
