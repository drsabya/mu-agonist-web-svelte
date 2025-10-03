<script lang="ts">
	// src/lib/components/cms/SceneMetadata.svelte
	export let scene: any;
	export let onChange: (partial: Record<string, unknown>) => void;

	type McqOption = {
		text: string;
		is_correct?: boolean;
		explanation?: string | null;
	};

	/* -------------------- helpers -------------------- */
	const toFloatOrNull = (v: string) => {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	};

	const normalizeHex = (v: string | null | undefined) => {
		if (typeof v !== 'string') return '#ffffff';
		const s = v.trim();
		const hex = s.startsWith('#') ? s.slice(1) : s;
		if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
		if (/^[0-9a-fA-F]{3}$/.test(hex)) {
			const [r, g, b] = hex.toLowerCase().split('');
			return `#${r}${r}${g}${g}${b}${b}`;
		}
		return '#ffffff';
	};

	/* -------------------- local reactive state -------------------- */
	// Keep a local MCQ list so the UI updates immediately when clicking "Add option"
	let mcq: McqOption[] = Array.isArray(scene?.mcq_options) ? [...scene.mcq_options] : [];

	// If parent swaps the scene (e.g., navigation), refresh local mcq once.
	// We don't deep-diff constantly to avoid churn; this covers the common case.
	$: if (!Array.isArray(scene?.mcq_options) && mcq.length !== 0) {
		mcq = [];
	}
	$: if (Array.isArray(scene?.mcq_options) && scene.mcq_options !== mcq) {
		// Only adopt if lengths differ (cheap guard against feedback loops)
		if (scene.mcq_options.length !== mcq.length) {
			mcq = [...scene.mcq_options];
		}
	}

	// Color derived value
	$: colorHex = normalizeHex(scene?.background_color ?? '#ffffff');

	function handleColorInput(hex: string) {
		onChange({ background_color: normalizeHex(hex) });
	}
	function handleColorTextInput(text: string) {
		onChange({ background_color: normalizeHex(text) });
	}

	/* -------------------- MCQ mutations -------------------- */
	function pushMcqUpdate(next: McqOption[]) {
		mcq = next; // update local view immediately
		// Clean and send to parent for persistence
		const cleaned = next
			.map((o) => ({
				text: String(o.text ?? '').trim(),
				is_correct: Boolean(o.is_correct),
				explanation:
					o.explanation === undefined || o.explanation === null
						? null
						: String(o.explanation).trim()
			}))
			// keep rows that have any signal (text or explanation or marked correct)
			.filter((o) => o.text.length > 0 || o.explanation !== null || o.is_correct);
		onChange({ mcq_options: cleaned });
	}

	function addOption() {
		pushMcqUpdate([...mcq, { text: '', is_correct: false, explanation: '' }]);
	}

	function deleteOption(idx: number) {
		const next = mcq.filter((_, i) => i !== idx);
		pushMcqUpdate(next);
	}

	function updateOption(idx: number, patch: Partial<McqOption>) {
		const next = mcq.map((o, i) => (i === idx ? { ...o, ...patch } : o));
		pushMcqUpdate(next);
	}

	function toggleCorrect(idx: number) {
		const item = mcq[idx];
		updateOption(idx, { is_correct: !Boolean(item?.is_correct) });
	}

	function move(idx: number, dir: -1 | 1) {
		const j = idx + dir;
		if (j < 0 || j >= mcq.length) return;
		const next = [...mcq];
		[next[idx], next[j]] = [next[j], next[idx]];
		pushMcqUpdate(next);
	}
</script>

<!-- Hidden (optional) -->
<input type="hidden" value={scene?.scene_type} />

<div class="flex flex-col gap-3 font-mono">
	<!-- Title -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Title</span>
		<textarea
			class="w-full border p-2"
			value={scene?.title ?? ''}
			on:input={(e) => onChange({ title: (e.target as HTMLTextAreaElement).value })}
		></textarea>
	</label>

	<!-- Description -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Description</span>
		<textarea
			class="w-full border p-2"
			rows="2"
			value={scene?.description ?? ''}
			on:input={(e) => onChange({ description: (e.target as HTMLTextAreaElement).value })}
		></textarea>
	</label>

	<!-- Explanation -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Explanation</span>
		<textarea
			class="w-full border p-2"
			rows="3"
			value={scene?.explanation ?? ''}
			on:input={(e) => onChange({ explanation: (e.target as HTMLTextAreaElement).value })}
		></textarea>
	</label>

	<!-- Access tier -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Access tier</span>
		<select
			class="w-full border p-2"
			value={scene?.access_tier ?? ''}
			on:input={(e) => onChange({ access_tier: (e.target as HTMLSelectElement).value || null })}
		>
			<option value="">—</option>
			<option value="free">free</option>
			<option value="paid">paid</option>
		</select>
	</label>

	<!-- Thumbnail URL -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Thumbnail URL</span>
		<input
			class="w-full border p-2"
			type="url"
			value={scene?.thumbnail_src ?? ''}
			on:input={(e) => onChange({ thumbnail_src: (e.target as HTMLInputElement).value || null })}
			placeholder="https://..."
		/>
	</label>

	<!-- Background color (color picker + hex) -->
	<div class="flex flex-col gap-1">
		<span class="text-xs">Background color</span>
		<div class="flex items-center gap-2">
			<input
				class="h-9 w-12 cursor-pointer rounded border"
				type="color"
				value={colorHex}
				on:input={(e) => handleColorInput((e.target as HTMLInputElement).value)}
			/>
			<input
				disabled
				class="w-full border p-2"
				type="text"
				value={colorHex}
				on:input={(e) => handleColorTextInput((e.target as HTMLInputElement).value)}
				placeholder="#ffffff"
			/>
		</div>
	</div>

	{#if scene?.scene_type === 'slider'}
		<!-- Slider config (only for slider scenes) -->
		<div class="grid gap-3 sm:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span class="text-xs">Slider min</span>
				<input
					class="w-full border p-2"
					type="number"
					step="any"
					value={scene?.slider_min ?? ''}
					on:input={(e) =>
						onChange({ slider_min: toFloatOrNull((e.target as HTMLInputElement).value) })}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-xs">Slider max</span>
				<input
					class="w-full border p-2"
					type="number"
					step="any"
					value={scene?.slider_max ?? ''}
					on:input={(e) =>
						onChange({ slider_max: toFloatOrNull((e.target as HTMLInputElement).value) })}
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-xs">Slider step</span>
				<input
					class="w-full border p-2"
					type="number"
					step="any"
					value={scene?.slider_step ?? ''}
					on:input={(e) =>
						onChange({ slider_step: toFloatOrNull((e.target as HTMLInputElement).value) })}
				/>
			</label>
		</div>
	{/if}

	<!-- Tags -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Tags (comma separated)</span>
		<input
			class="w-full border p-2"
			value={(scene?.tags ?? []).join(', ')}
			on:input={(e) => {
				const csv = (e.target as HTMLInputElement).value;
				onChange({
					tags: csv
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				});
			}}
		/>
	</label>

	<!-- Subjects -->
	<label class="flex flex-col gap-1">
		<span class="text-xs">Subjects (comma separated)</span>
		<input
			class="w-full border p-2"
			value={(scene?.subjects ?? []).join(', ')}
			on:input={(e) => {
				const csv = (e.target as HTMLInputElement).value;
				onChange({
					subjects: csv
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				});
			}}
		/>
	</label>

	<!-- ====================== MCQ OPTIONS ====================== -->
	<div class="mt-2 rounded border p-3">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-xs font-semibold">MCQ options</span>
			<button
				type="button"
				class="rounded border px-2 py-1 text-xs hover:bg-gray-100"
				on:click={addOption}
			>
				+ Add option
			</button>
		</div>

		{#if mcq.length === 0}
			<p class="text-xs text-gray-500">No options yet. Click “Add option”.</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each mcq as opt, i}
					<div class="rounded border p-2">
						<div class="flex items-center gap-2">
							<input
								class="h-4 w-4"
								type="checkbox"
								checked={!!opt.is_correct}
								on:input={() => toggleCorrect(i)}
								title="Mark as correct"
							/>
							<input
								class="w-full border p-2 text-sm"
								type="text"
								placeholder="Option text"
								value={opt.text}
								on:input={(e) => updateOption(i, { text: (e.target as HTMLInputElement).value })}
							/>
						</div>

						<div class="mt-2 flex items-center gap-2">
							<textarea
								class="w-full border p-2 text-xs"
								rows="2"
								placeholder="Explanation (optional)"
								value={opt.explanation ?? ''}
								on:input={(e) =>
									updateOption(i, {
										explanation: (e.target as HTMLTextAreaElement).value
									})}
							></textarea>

							<div class="flex shrink-0 flex-col gap-1">
								<button
									type="button"
									class="rounded border px-2 py-1 text-xs hover:bg-gray-100"
									on:click={() => move(i, -1)}
									disabled={i === 0}
									title="Move up"
								>
									↑
								</button>
								<button
									type="button"
									class="rounded border px-2 py-1 text-xs hover:bg-gray-100"
									on:click={() => move(i, 1)}
									disabled={i === mcq.length - 1}
									title="Move down"
								>
									↓
								</button>
								<button
									type="button"
									class="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
									on:click={() => deleteOption(i)}
									title="Delete option"
								>
									Delete
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<!-- ==================== / MCQ OPTIONS ===================== -->
</div>
