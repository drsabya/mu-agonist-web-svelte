// src/lib/canvas/canvasState.ts
import type { SceneItem, Role, AnimType, MoveDir } from '$lib/types/scene';

export type Snapshot = {
	items: SceneItem[];
	selectedId: string | null;
	canvasBg: string;
	previewMode: boolean;
};

export function createCanvasState(sceneId: string) {
	// ───────────────────────────────────────────────
	// State (single source of truth)
	// ───────────────────────────────────────────────
	const state = $state({
		sceneId,
		canvasBg: '#ffffff',
		title: null as string | null,
		description: null as string | null,

		sliderMin: 0,
		sliderMax: 100,
		sliderStep: 1,

		items: [] as SceneItem[],

		selectedId: null as string | null,
		previewMode: false,
		hideNonZeroZ: false,

		finalEditId: null as string | null,
		animTargetEditId: null as string | null,
		animScaleEditId: null as string | null,

		canvasSize: { w: 0, h: 0 },

		undoStack: [] as Snapshot[],
		redoStack: [] as Snapshot[]
	});

	// ───────────────────────────────────────────────
	// Derived values (auto-updated)
	// ───────────────────────────────────────────────
	const selectedItem = $derived(
		state.selectedId ? (state.items.find((i) => i.id === state.selectedId) ?? null) : null
	);

	const visibleItems = $derived(
		state.hideNonZeroZ ? state.items.filter((_, idx) => idx === 0) : state.items
	);

	const totalMoveable = $derived(state.items.filter((i) => i.moveable).length);
	const totalResizeable = $derived(state.items.filter((i) => i.resizeable).length);

	// ───────────────────────────────────────────────
	// Mutations (centralized actions)
	// ───────────────────────────────────────────────
	function select(id: string | null) {
		state.selectedId = id;
	}

	function setCanvasBg(color: string) {
		state.canvasBg = color;
	}

	function setCanvasSize(w: number, h: number) {
		state.canvasSize = { w, h };
	}

	function setPreviewMode(v: boolean) {
		state.previewMode = v;
	}

	function setHideNonZeroZ(v: boolean) {
		state.hideNonZeroZ = v;
	}

	function createItems(newItems: SceneItem[]) {
		state.items = [...state.items, ...newItems];
	}

	function updateItem(id: string, patch: Partial<SceneItem>) {
		state.items = state.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
	}

	function deleteItem(id: string) {
		state.items = state.items.filter((it) => it.id !== id);
		if (state.selectedId === id) state.selectedId = null;
	}

	// Example role/tag setters
	function setRole(id: string, role: Role) {
		updateItem(id, { role });
	}
	function setMoveable(id: string, v: boolean) {
		updateItem(id, { moveable: v, resizeable: v ? false : undefined });
	}
	function setResizeable(id: string, v: boolean) {
		updateItem(id, { resizeable: v, moveable: v ? false : undefined });
	}
	function setMoveDir(id: string, dir: MoveDir) {
		updateItem(id, { move_dir: dir });
	}
	function setScaleFactor(id: string, f: number) {
		updateItem(id, { scale_factor: f });
	}
	function setAnimType(id: string, t: AnimType) {
		updateItem(id, { anim_type: t });
	}

	// Undo/redo
	function pushSnapshot() {
		state.undoStack = [
			...state.undoStack,
			{
				items: structuredClone(state.items),
				selectedId: state.selectedId,
				canvasBg: state.canvasBg,
				previewMode: state.previewMode
			}
		];
		state.redoStack = [];
	}

	function undo() {
		const prev = state.undoStack.pop();
		if (!prev) return;
		state.redoStack = [
			...state.redoStack,
			{
				items: structuredClone(state.items),
				selectedId: state.selectedId,
				canvasBg: state.canvasBg,
				previewMode: state.previewMode
			}
		];
		state.items = prev.items;
		state.selectedId = prev.selectedId;
		state.canvasBg = prev.canvasBg;
		state.previewMode = prev.previewMode;
	}

	function redo() {
		const next = state.redoStack.pop();
		if (!next) return;
		state.undoStack = [
			...state.undoStack,
			{
				items: structuredClone(state.items),
				selectedId: state.selectedId,
				canvasBg: state.canvasBg,
				previewMode: state.previewMode
			}
		];
		state.items = next.items;
		state.selectedId = next.selectedId;
		state.canvasBg = next.canvasBg;
		state.previewMode = next.previewMode;
	}

	// ───────────────────────────────────────────────
	// Return API (state + derived + actions)
	// ───────────────────────────────────────────────
	return {
		state,
		selectedItem,
		visibleItems,
		totalMoveable,
		totalResizeable,
		select,
		setCanvasBg,
		setCanvasSize,
		setPreviewMode,
		setHideNonZeroZ,
		createItems,
		updateItem,
		deleteItem,
		setRole,
		setMoveable,
		setResizeable,
		setMoveDir,
		setScaleFactor,
		setAnimType,
		pushSnapshot,
		undo,
		redo
	};
}
