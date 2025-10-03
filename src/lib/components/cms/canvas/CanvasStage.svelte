<!-- src/lib/components/cms/canvas/CanvasStage.svelte -->
<script lang="ts">
	/**
	 * A thin, reusable stage wrapper for the canvas area.
	 * Responsibilities:
	 * - Keep a 9:16 box (max 360x640 by default)
	 * - Measure & push live size into the central canvas state
	 * - Paint background from state (state.canvasBg)
	 * - Clear selection when user clicks empty space (edit mode)
	 * - Provide a slot for items/overlays (keeps Stage logic simple)
	 */

	import type { createCanvasState } from '$lib/stores/canvas.svelte';

	// Props
	let {
		canvas, // required: instance returned by createCanvasState(sceneId)
		maxWidth = 360, // cap the canvas width (height follows 9:16)
		showDims = true // show W×H badge
	}: {
		canvas: ReturnType<typeof createCanvasState>;
		maxWidth?: number;
		showDims?: boolean;
	} = $props();

	// Local: DOM ref for the stage container
	let el: HTMLDivElement;

	// Keep canvasSize in sync with element size
	$effect.pre(() => {
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				// Use borderBox if available for precision
				const { width, height } =
					(Array.isArray((e as any).borderBoxSize) && (e as any).borderBoxSize[0]) || e.contentRect;
				canvas.setCanvasSize(Math.round(width), Math.round(height));
			}
		});
		ro.observe(el, { box: 'border-box' as any });
		return () => ro.disconnect();
	});

	// Click on empty canvas area clears selection (only in edit mode)
	function onStagePointerDown() {
		if (!canvas.state.previewMode) canvas.select(null);
	}
</script>

<div
	bind:this={el}
	class="relative mx-auto border border-gray-300 shadow-sm"
	style="
		width: 100%;
		max-width: {maxWidth}px;
		aspect-ratio: 9 / 16;
		overflow: hidden;
		user-select: none;
		touch-action: none;
		background: {canvas.state.canvasBg};
	"
	onpointerdown={onStagePointerDown}
	aria-label="Canvas stage"
>
	<!-- Optional: live dimensions badge -->
	{#if showDims}
		<div
			class="pointer-events-none absolute top-1 left-1 z-20 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white/90"
		>
			{canvas.state.canvasSize.w}×{canvas.state.canvasSize.h}
		</div>
	{/if}

	<!-- Slot: render items, selection boxes, edit ghosts, HUD, etc. -->
	<slot />
</div>
