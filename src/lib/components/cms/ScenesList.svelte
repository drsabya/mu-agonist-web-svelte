<script lang="ts">
	import type { SceneListItem } from '$lib/types/cms';

	let { scenes }: { scenes: SceneListItem[] } = $props();

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

{#if scenes?.length}
	<ul class="mt-2 space-y-2">
		{#each scenes as s}
			<li class="flex items-center justify-between rounded border p-2">
				<!-- Title links to /cms/scenes/[id] -->
				<div class="min-w-0 pr-3">
					<a
						href={`/cms/scenes/${s.id}`}
						class="underline-offset-2 outline-none hover:underline focus:underline focus-visible:ring-2 focus-visible:ring-black"
						data-sveltekit-preload-data
					>
						{s.title}
					</a>
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-2">
					<!-- Publish/Unpublish toggle -->
					<form
						method="post"
						action="?/publish"
						onsubmit={(e) => confirmToggle(e, s.status === 'published' ? 'draft' : 'published')}
					>
						<input type="hidden" name="id" value={s.id} />
						<input
							type="hidden"
							name="next_status"
							value={s.status === 'published' ? 'draft' : 'published'}
						/>
						<button
							class="rounded border px-3 py-1 text-xs uppercase"
							type="submit"
							title={s.status === 'published' ? 'Unpublish' : 'Publish'}
						>
							{s.status === 'published' ? 'Unpublish' : 'Publish'}
						</button>
					</form>

					<!-- Delete (icon button) -->
					<form method="post" action="?/delete" onsubmit={confirmDelete}>
						<input type="hidden" name="id" value={s.id} />
						<button
							class="rounded border p-2"
							type="submit"
							title="Delete scene"
							aria-label="Delete scene"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M3 6h18" />
								<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
								<path d="M10 11v6" />
								<path d="M14 11v6" />
							</svg>
						</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>
{:else}
	<p class="mt-2 text-center text-sm text-gray-600">No scenes yet.</p>
{/if}
