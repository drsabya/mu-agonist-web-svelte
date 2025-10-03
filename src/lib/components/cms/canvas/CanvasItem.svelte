<!-- src/lib/components/cms/canvas/CanvasItem.svelte -->
<script lang="ts">
	import type { SceneItem } from '$lib/types/scene';
	import type { createCanvasState } from '$lib/stores/canvas.svelte';

	let { item, canvas } = $props<{
		item: SceneItem;
		canvas: ReturnType<typeof createCanvasState>;
	}>();

	function onPointerDown(e: PointerEvent) {
		e.stopPropagation(); // don’t trigger stage deselect
		canvas.select(item.id);
	}
</script>

<div
	class="absolute"
	onpointerdown={onPointerDown}
	style="
		left: {item.cxPct * canvas.state.canvasSize.w - (item.wPct * canvas.state.canvasSize.w) / 2}px;
		top: {item.cyPct * canvas.state.canvasSize.h - (item.wPct * canvas.state.canvasSize.w) / 2}px;
		width: {item.wPct * canvas.state.canvasSize.w}px;
		height: {item.wPct * canvas.state.canvasSize.w}px;
		transform: rotate({item.rot}rad);
	"
>
	{#if item.kind === 'svg' && item.svg}
		<div class="h-full w-full">{@html item.svg}</div>
	{:else if item.kind === 'image' && item.src}
		<img src={item.src} alt="" class="h-full w-full object-contain" />
	{/if}
</div>
