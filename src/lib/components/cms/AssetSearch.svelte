<script lang="ts">
	// ✨ Svelte 5 runes
	type Asset = { id: string; title: string; public_url: string };
	type SelectedAsset = { id: string; title: string; url: string };

	// Bindable selection back to parent
	let { selected = $bindable<SelectedAsset | null>(null) } = $props();

	// --- Dialog visibility ---
	let showSearch = $state(false); // opens search dialog on mount
	let showPreview = $state(false);

	// --- Search State ---
	let q = $state('');
	let results = $state<Asset[]>([]);
	let loading = $state(false);
	let error = $state('');
	let count = $state(0);

	// --- Preview State ---
	let previewAsset = $state<{ id: string; title: string; url: string } | null>(null);

	// Deriveds
	const isQueryTooShort = $derived(q.trim().length < 2);
	const isSearchDisabled = $derived(loading || isQueryTooShort);
	const resultsText = $derived(`${count} result${count === 1 ? '' : 's'}`);

	// Debounced search effect
	$effect(() => {
		if (!showSearch) return; // only search while dialog open
		const term = q.trim();
		const aborter = new AbortController();

		if (term.length < 2) {
			results = [];
			count = 0;
			error = '';
			return;
		}

		const timer = setTimeout(() => {
			runSearch(term, aborter.signal);
		}, 300);

		return () => {
			clearTimeout(timer);
			aborter.abort();
		};
	});

	async function runSearch(term: string, signal: AbortSignal) {
		loading = true;
		error = '';
		try {
			const params = new URLSearchParams({ q: term, limit: '20' });
			const res = await fetch(`/api/assets/search?${params}`, { signal });
			const json = await res.json();
			if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
			results = (json.data ?? []) as Asset[];
			count = json.count ?? results.length;
		} catch (e: any) {
			if (e?.name !== 'AbortError') {
				error = e?.message || 'Search failed';
				results = [];
				count = 0;
			}
		} finally {
			loading = false;
		}
	}

	// Open stacked preview dialog over search dialog
	function openPreview(asset: Asset) {
		previewAsset = { id: asset.id, title: asset.title, url: asset.public_url };
		showPreview = true;
	}

	function addSelected() {
		if (!previewAsset) return;
		selected = previewAsset;
		closePreview();
		closeSearch(); // close both after selecting
	}

	function closePreview() {
		showPreview = false;
		previewAsset = null;
	}

	function closeSearch() {
		showSearch = false;
		// reset search UI for next time
		q = '';
		results = [];
		error = '';
		count = 0;
		loading = false;
	}

	// Backdrop clicks only close the topmost open dialog
	function onBackdropSearch(e: MouseEvent) {
		if ((e.target as HTMLElement).dataset.backdrop === 'search') {
			// If preview is open, do not close search
			if (!showPreview) closeSearch();
		}
	}
	function onBackdropPreview(e: MouseEvent) {
		if ((e.target as HTMLElement).dataset.backdrop === 'preview') {
			closePreview();
		}
	}

	// Keyboard handling: Esc closes topmost, Enter confirms in preview
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (showPreview) closePreview();
			else if (showSearch) closeSearch();
		}
		if (showPreview && (e.key === 'Enter' || e.key === 'NumpadEnter')) {
			addSelected();
		}
	}
</script>

<svelte:window on:keydown={onKeydown} />

<div class="font-mono text-sm text-black">
	<!-- Trigger to open search dialog again if needed -->
	{#if !showSearch}
		<button
			type="button"
			class="rounded-md border border-black bg-black px-3 py-1 text-white"
			onclick={() => (showSearch = true)}
		>
			Choose asset…
		</button>
	{/if}
</div>

<!-- Search Dialog -->
{#if showSearch}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Search assets"
		data-backdrop="search"
		onclick={onBackdropSearch}
	>
		<div class="max-h-[90vh] w-full max-w-[520px] overflow-auto rounded-xl bg-white p-4 shadow-2xl">
			<div class="mb-3 flex items-center justify-between gap-3">
				<h2 class="font-bold">Search assets</h2>
				<div class="flex items-center gap-2">
					<button class="rounded-md border px-2 py-0.5 text-xs" onclick={closeSearch}>
						Close
					</button>
				</div>
			</div>

			<div class="mb-2 flex items-center gap-2">
				<input
					type="text"
					placeholder="Type ≥2 chars to search…"
					class="w-full rounded-md border px-2 py-1 placeholder-gray-400 focus:outline-none"
					bind:value={q}
					autofocus
				/>
				<button
					class="rounded-md border border-black bg-black px-2.5 py-1 text-white disabled:opacity-40"
					onclick={() => runSearch(q.trim(), new AbortController().signal)}
					disabled={isSearchDisabled}
				>
					{loading ? 'Searching…' : 'Search'}
				</button>
			</div>

			{#if isQueryTooShort}
				<div class="text-gray-600">Enter at least 2 characters.</div>
			{:else if error}
				<div class="text-red-600">{error}</div>
			{:else}
				<div class="mb-1 text-gray-600">{resultsText}</div>
			{/if}

			<ul class="divide-y">
				{#each results as a (a.id)}
					<li>
						<button
							type="button"
							class="block w-full truncate py-2 text-left underline-offset-2 hover:underline"
							onclick={() => openPreview(a)}
							title={a.title}
						>
							{a.title}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}

<!-- Stacked Preview Dialog (on top of Search) -->
{#if showPreview && previewAsset}
	<div
		class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
		role="dialog"
		aria-modal="true"
		aria-label="Preview asset"
		data-backdrop="preview"
		onclick={onBackdropPreview}
	>
		<div class="max-h-[90vh] w-full max-w-[520px] overflow-auto rounded-xl bg-white p-3 shadow-2xl">
			<div class="mb-2 flex items-center justify-between gap-3">
				<div class="truncate font-bold">{previewAsset.title}</div>
				<div class="flex items-center gap-2">
					<button
						class="rounded-md border border-black bg-black px-2 py-0.5 text-xs text-white"
						onclick={addSelected}
					>
						Add
					</button>
					<button class="rounded-md border px-2 py-0.5 text-xs" onclick={closePreview}>
						Cancel
					</button>
				</div>
			</div>

			<div class="overflow-hidden rounded border p-10">
				<img
					src={previewAsset.url}
					alt={previewAsset.title}
					class="block h-auto max-h-[72vh] w-full"
					decoding="async"
					loading="eager"
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Ensure layered z-index values */
	.z-60 {
		z-index: 60;
	}
</style>
