<script lang="ts">
	// SceneEditor.svelte — paste, select, drag, resize, rotate, deselect, reorder, delete, undo,
	// role menu, target menu, save; FINAL POSITION mode (draggable only) + GLOBAL FINAL KEYFRAME mode (all items)
	import { onMount, onDestroy, tick } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { linear, cubicInOut } from 'svelte/easing';
	import { PUBLIC_BUNNY_PUBLIC_HOST } from '$env/static/public';
	import AssetSearch from './AssetSearch.svelte';

	// 🔹 Icons
	import {
		ClipboardPaste,
		Plus,
		Save,
		Undo2,
		ChevronsUp,
		ChevronUp,
		ChevronDown,
		ChevronsDown,
		Trash2,
		ArrowDownUp,
		WandSparkles,
		MapPinPlus,
		DiamondPlus,
		Crosshair,
		Settings2,
		Play,
		RotateCcw
	} from '@lucide/svelte';

	/* -------------------------------------------------------
	   PROPS
	------------------------------------------------------- */
	let { id, scene_type, data } = $props(); // scene_id (uuid from parent)

	type Kind = 'svg' | 'image';
	type Role = 'none' | 'draggable' | 'target' | 'tappable';
	type AnimType = 'none' | 'move' | 'scale' | 'rotate' | 'opacity' | 'jitter' | 'pulse';
	type EasingKind = 'linear' | 'easeInOut';
	type MoveDir =
		| 'horizontal'
		| 'horizontalRev'
		| 'vertical'
		| 'verticalRev'
		| 'diag1'
		| 'diag1Rev'
		| 'diag2'
		| 'diag2Rev';

	const moveDirs: MoveDir[] = [
		'horizontal',
		'horizontalRev',
		'vertical',
		'verticalRev',
		'diag1',
		'diag1Rev',
		'diag2',
		'diag2Rev'
	];

	type SceneItem = {
		id: string;
		scene_id?: string;
		kind: Kind;
		src?: string;
		cx_pct: number;
		cy_pct: number;
		w_pct: number;
		rot: number; // radians
		z_index: number;

		// 🔹 Base opacity in UI as 0–100 (percent). We convert to 0–1 before API.
		opacity?: number | null;

		role: Role;
		correct_target_id?: string | null;
		tap_message?: string | null;
		final_cx_pct?: number | null;
		final_cy_pct?: number | null;

		anim_type: AnimType;
		anim_duration_ms?: number | null;
		anim_delay_ms?: number | null;
		anim_easing?: EasingKind | null;
		anim_move_cx_pct?: number | null; // FINAL KEYFRAME absolute center X (pct of canvas width)
		anim_move_cy_pct?: number | null; // FINAL KEYFRAME absolute center Y (pct of canvas height)
		anim_scale_w_pct?: number | null; // FINAL KEYFRAME absolute width (pct of canvas width)
		anim_rotate_by?: number | null; // FINAL KEYFRAME delta (radians) added to base rot

		// 🔹 FK opacity in UI as 0–100 (percent). We convert to 0–1 on save.
		anim_opacity?: number | null;

		is_scene_trigger?: boolean | null;

		// 🔹 Slider scene controls
		moveable?: boolean | null;
		resizeable?: boolean | null;
		move_dir?: string | null;
		scale_factor?: number | null;

		title?: string | null;

		// ✅ Persistence marker: true when this item exists in DB (hydrated or created once)
		persisted?: boolean;
	};
	/* ---------- TAP PREVIEW RUNTIME (per-item tweened) ---------- */
	type TweenNum = ReturnType<typeof tweened<number>>;
	type RuntimeAnim = { x: TweenNum; y: TweenNum; w: TweenNum; r: TweenNum; o: TweenNum };
	type RuntimeVals = { x: number; y: number; w: number; r: number; o: number };
	type RuntimeUnsubs = {
		x: () => void;
		y: () => void;
		w: () => void;
		r: () => void;
		o: () => void;
	};
	/* -------------------------------------------------------
	   STATE
	------------------------------------------------------- */
	let items = $state<SceneItem[]>([]);
	let currentAsset: { id: string; title: string; url: string } | null = $state(null);
	let selectedId: string | null = $state(null);
	let statusMsg = $state('');
	let lastCreatedId: string | null = null;

	// 🔹 Save status indicator
	type SaveState = 'idle' | 'saving' | 'success' | 'error';
	let saveState: SaveState = $state('idle');
	let saveToast = $state('');
	let saveToastTimer: any = null;

	// 🔹 Deleting state (disable UI while deleting)
	let deleting = $state(false);

	function showToast(kind: 'success' | 'error', msg: string, ms = 2200) {
		saveState = kind;
		saveToast = msg;
		clearTimeout(saveToastTimer);
		saveToastTimer = setTimeout(() => {
			saveState = 'idle';
			saveToast = '';
		}, ms);
	}
	// Toast that doesn't touch saveState (useful for delete)
	function showGlobalToast(msg: string, ms = 2200) {
		saveToast = msg;
		clearTimeout(saveToastTimer);
		saveToastTimer = setTimeout(() => {
			saveToast = '';
		}, ms);
	}

	// asset picker popover
	let showAssetPicker = $state(false);

	/* ---------- canvas metrics ---------- */
	let canvasEl: HTMLDivElement | null = null;
	let canvasW = $state(0);
	let canvasH = $state(0);
	let roCanvas: ResizeObserver | null = null;

	/* ---------- TAP PREVIEW / PLAY RUNTIME ---------- */
	let tapDialogMsg = $state<string | null>(null); // simple modal text

	let playActive = $state(false); // a tween is running
	let playStartedAt = 0; // ms timestamp
	let playNow = $state(0); // changes every rAF to drive reactivity
	let playRaf: number | null = null; // rAF handle
	let playLatchedFinal = $state(false); // when true, stay at final keyframe state (even after tween ends)

	/* holder refs */
	/* live rendered size for all items (px); updated on measureSoon() */
	const itemSizePx: Record<string, { w: number; h: number }> = $state({});
	function updateAllItemSizes() {
		for (const it of items) {
			const el = holderMap[it.id];
			if (!el) continue;
			const svg = el.querySelector('svg') as SVGSVGElement | null;
			const target = svg ?? el;
			const r = target.getBoundingClientRect();
			itemSizePx[it.id] = { w: Math.round(r.width), h: Math.round(r.height) };
		}
	}
	function halfSizePct(it: SceneItem) {
		const s = itemSizePx[it.id];
		// Use measured px when available; otherwise fall back to the BASE width (it.w_pct).
		// IMPORTANT: do NOT call displayWidthPct() here to avoid recursion during preview.
		const halfW = s && canvasW > 0 ? s.w / canvasW / 2 : it.w_pct / 2;
		const halfH = s && canvasH > 0 ? s.h / canvasH / 2 : it.w_pct / 2; // best-effort fallback
		return { halfW, halfH };
	}

	const holderMap: Record<string, HTMLDivElement | null> = $state({});

	/* live size of selected item (for readout only) */
	let selW = $state(0);
	let selH = $state(0);
	let roSel: ResizeObserver | null = null;
	let roSelObservedEl: Element | null = null; // guard to stop churn

	/* drag state (normal / modes) */
	let dragging = false;
	let dragStartCanvasX = 0;
	let dragStartCanvasY = 0;
	let startCxPct = 0;
	let startCyPct = 0;

	/* drag state (final position mode for draggables) */
	let finalPosMode = $state(false); // per-selection helper mode (draggable only)
	let draggingFinal = false;
	let startFinalCxPct = 0;
	let startFinalCyPct = 0;

	/* resize state */
	let resizing = false;
	let resizeStartCanvasX = 0;
	let resizeStartCanvasY = 0;
	let resizeStartWPct = 0;

	/* rotate state */
	let rotating = false;
	let rotateStartAngle = 0;
	let rotateInitial = 0;
	let rotateCenterX = 0;
	let rotateCenterY = 0;

	let tapRuntimeActive = $state(false); // are runtime tweens driving preview?
	const runtime = new Map<string, RuntimeAnim>(); // item.id -> tween stores
	const runtimeVals: Record<string, RuntimeVals> = $state({}); // latest numbers for each item
	const runtimeUnsubs = new Map<string, RuntimeUnsubs>(); // unsubscribes for cleanup

	/* ---------- PREVIEW / PLAY MODE (slider scenes) ---------- */
	let previewMode = $state(false); // global toggle for preview/play
	let previewT = $state(0); // slider position as a percent in [-100..100]
	function t01() {
		// map previewT [-100..100] -> [0..1]
		return Math.min(1, Math.max(0, (previewT + 100) / 200));
	}
	function tSym() {
		// map previewT [-100..100] -> [-1..1]
		return Math.min(1, Math.max(-1, previewT / 100));
	}

	/* ---------- GLOBAL FINAL KEYFRAME MODE (all items) ---------- */
	let finalKeyframeMode = $state(false); // global toggle (diamond icon)
	function ensureAnimDefaultsForAll() {
		items = items.map((it) => ({
			...it,
			anim_move_cx_pct: it.anim_move_cx_pct ?? it.cx_pct,
			anim_move_cy_pct: it.anim_move_cy_pct ?? it.cy_pct,
			anim_scale_w_pct: it.anim_scale_w_pct ?? it.w_pct,
			anim_rotate_by: it.anim_rotate_by ?? 0,
			// 🔹 Default FK opacity to current displayed (base) opacity (still in 0–100 here)
			anim_opacity:
				it.anim_opacity ?? (isFinite(it.opacity as number) ? (it.opacity as number) : 100)
		}));
	}
	function toggleFinalKeyframeMode(force?: boolean) {
		// 🚫 No FK mode in slider scenes
		if (scene_type === 'slider') {
			finalKeyframeMode = false;
			statusMsg = 'Final Keyframe mode is disabled for slider scenes.';
			return;
		}
		const next = typeof force === 'boolean' ? force : !finalKeyframeMode;
		if (next && !finalKeyframeMode) ensureAnimDefaultsForAll();
		finalKeyframeMode = next;
		statusMsg = finalKeyframeMode
			? 'Final Keyframe mode ON — drag/resize/rotate to set final values. Use ⚙️ to edit timing/easing/opacity.'
			: 'Final Keyframe mode OFF.';
		measureSoon();
	}

	// If scene_type becomes 'slider', hard-disable FK & FinalPos modes (don’t spam updates if already false)
	$effect(() => {
		if (scene_type === 'slider') {
			if (finalKeyframeMode) finalKeyframeMode = false;
			if (finalPosMode) finalPosMode = false;
		}
	});

	/* ---------- UNDO HISTORY ---------- */
	type HistoryEntry = { items: SceneItem[]; selectedId: string | null; tag?: string };
	const HISTORY_LIMIT = 100;
	let history: HistoryEntry[] = $state([]);
	let lastUndoTag: string | undefined = undefined;

	function deepCloneItems(src: SceneItem[]): SceneItem[] {
		return src.map((it) => ({ ...it }));
	}
	function snapshot(tag?: string): HistoryEntry {
		return { items: deepCloneItems(items), selectedId, tag };
	}
	function pushHistory(tag?: string) {
		history = [...history, snapshot(tag)];
		if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
	}
	function undo() {
		if (history.length === 0) return;
		const prev = history[history.length - 1];
		history = history.slice(0, -1);
		items = deepCloneItems(prev.items);
		selectedId = prev.selectedId;
		lastUndoTag = prev.tag;
		statusMsg = `Undid: ${lastUndoTag ?? 'last action'}.`;
		measureSoon();
	}

	/* ---------- utils ---------- */
	function uid() {
		return Math.random().toString(36).slice(2, 10);
	}
	function getSelected() {
		return selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;
	}
	function getItemLabelById(id: string) {
		const t = items.find((i) => i.id === id);
		return t ? t.title?.trim() || t.id : id;
	}

	function generateSvgKey(prefix = '') {
		const id = crypto.randomUUID();
		const p = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
		return `${p}${id}.svg`;
	}
	function isInlineSvg(s?: string) {
		return !!s && /^\s*<svg[\s\S]*<\/svg>\s*$/i.test(s);
	}
	function preclean(text: string): string {
		return text
			.replace(/<\?xml[\s\S]*?\?>/gi, '')
			.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.trim();
	}
	function extractSvgBlock(text: string): string {
		const m = text.match(/<svg[\s\S]*?<\/svg>/i);
		return m ? m[0] : '';
	}
	function namespaceSvgIds(svg: string, ns: string) {
		let out = svg;
		out = out.replace(/\bid="([\w:-]+)"/g, (_m, id) => `id="${id}_${ns}"`);
		out = out.replace(/\burl\(#([\w:-]+)\)/g, (_m, id) => `url(#${id}_${ns})`);
		out = out.replace(
			/\b(xlink:href|href)="#([\w:-]+)"/g,
			(_m, attr, id) => `${attr}="#${id}_${ns}"`
		);
		out = out.replace(/\baria-labelledby="([^"]+)"/g, (_m, ids) =>
			ids
				.split(/\s+/)
				.map((id: string) => `${id}_${ns}`)
				.join(' ')
		);
		return out;
	}
	function sanitizeSvgDom(svgString: string): string {
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgString, 'image/svg+xml');
		if (doc.querySelector('parsererror')) return '';
		const svg = doc.documentElement;
		for (const el of Array.from(doc.querySelectorAll('script, foreignObject'))) el.remove();
		const scrub = (el: Element) => {
			for (const attr of Array.from(el.attributes)) {
				const name = attr.name,
					value = attr.value;
				if (/^on/i.test(name)) {
					el.removeAttribute(name);
					continue;
				}
				if ((name === 'href' || name === 'xlink:href') && /^javascript:/i.test(value)) {
					el.removeAttribute(name);
					continue;
				}
				if (name.startsWith('xmlns:')) {
					el.removeAttribute(name);
					continue;
				}
				if (name.includes(':')) {
					const prefix = name.split(':')[0];
					if (/(vectornator|sodipodi|inkscape|xml)/i.test(prefix)) {
						el.removeAttribute(name);
						continue;
					}
				}
				// 🧹 Avoid invalid color attribute values that trigger hydration warnings
				if (/^(fill|stroke|stop-color)$/i.test(name) && (value === '' || value == null)) {
					el.removeAttribute(name);
					continue;
				}
				if (name === 'version') {
					el.removeAttribute(name);
					continue;
				}
			}
		};
		scrub(svg);
		for (const el of Array.from(svg.querySelectorAll('*'))) scrub(el);
		if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		const hasViewBox = svg.hasAttribute('viewBox');
		const wAttr = svg.getAttribute('width');
		const hAttr = svg.getAttribute('height');
		if (!hasViewBox && wAttr && hAttr) {
			const w = parseFloat(wAttr),
				h = parseFloat(hAttr);
			if (isFinite(w) && isFinite(h) && w > 0 && h > 0)
				svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
		}
		if (!svg.hasAttribute('viewBox') && !wAttr && !hAttr)
			svg.setAttribute('viewBox', '0 0 1000 1000');
		return new XMLSerializer().serializeToString(svg).trim();
	}
	function normAngle(a: number) {
		while (a <= -Math.PI) a += 2 * Math.PI;
		while (a > Math.PI) a -= 2 * Math.PI;
		return a;
	}
	function clamp01(x: number) {
		return Math.min(1, Math.max(0, x));
	}
	function clampPercent(x: number, min = 0, max = 100) {
		return Math.min(max, Math.max(min, x));
	}
	function pctToFrac(pct: number) {
		return clamp01((isFinite(pct) ? pct : 100) / 100);
	}
	function isTypingTarget(node: EventTarget | null) {
		const el = node as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName?.toLowerCase();
		if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return true;
		// If a selection exists in the page, don't treat backspace as delete
		const sel = window.getSelection?.();
		if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) return true;
		return false;
	}
	function clampPct(x: number) {
		return Math.min(1, Math.max(0, x));
	}
	function lerp(a: number, b: number, t: number) {
		return a + (b - a) * t;
	}

	/* ---------- EASING / PROGRESS ---------- */
	function easeLinear(t: number) {
		return t;
	}
	function easeInOutCubic(t: number) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 1, 3) / 2;
	}

	function itemProgress(it: SceneItem): number {
		if (!playActive) return 0;
		const delay = Number.isFinite(it.anim_delay_ms as number) ? (it.anim_delay_ms as number) : 0;
		const dur = Math.max(
			1,
			Number.isFinite(it.anim_duration_ms as number) ? (it.anim_duration_ms as number) : 700
		);
		const raw = (playNow - playStartedAt - delay) / dur;
		const clamped = Math.min(1, Math.max(0, raw));
		const easing = it.anim_easing === 'linear' ? easeLinear : easeInOutCubic;
		return easing(clamped);
	}

	function startPlayTween() {
		// We latch the scene to final state immediately; tween will animate into it.
		playLatchedFinal = true;

		playActive = true;
		playStartedAt = performance.now();

		const loop = () => {
			if (!playActive) return;
			playNow = performance.now();

			const allDone = items.every((it) => itemProgress(it) >= 1);
			if (allDone) {
				playActive = false;
				playRaf = null;
				return;
			}

			playRaf = requestAnimationFrame(loop);
		};

		if (playRaf) cancelAnimationFrame(playRaf);
		playRaf = requestAnimationFrame(loop);
	}

	function stopPlayTween() {
		playActive = false;
		if (playRaf) cancelAnimationFrame(playRaf);
		playRaf = null;
		// NOTE: we DO NOT clear playLatchedFinal here; that’s what keeps things at FK.
	}

	// Given base center (cx, cy) and half sizes, build edge-to-edge endpoints for a direction.
	function edgeEndpointsForDir(
		dir: string | null | undefined,
		baseCx: number,
		baseCy: number,
		halfW: number,
		halfH: number
	) {
		// Allowed center limits so the item stays fully inside the canvas
		const minCx = halfW;
		const maxCx = 1 - halfW;
		const minCy = halfH;
		const maxCy = 1 - halfH;

		// Default: no movement
		let A = { x: baseCx, y: baseCy }; // t = -1
		let B = { x: baseCx, y: baseCy }; // t = +1

		switch (dir) {
			case 'horizontal':
				A = { x: minCx, y: baseCy };
				B = { x: maxCx, y: baseCy };
				break;
			case 'horizontalRev':
				A = { x: maxCx, y: baseCy };
				B = { x: minCx, y: baseCy };
				break;
			case 'vertical':
				A = { x: baseCx, y: minCy };
				B = { x: baseCx, y: maxCy };
				break;
			case 'verticalRev':
				A = { x: baseCx, y: maxCy };
				B = { x: baseCx, y: minCy };
				break;
			case 'diag1': // top-left  -> bottom-right
				A = { x: minCx, y: minCy };
				B = { x: maxCx, y: maxCy };
				break;
			case 'diag1Rev': // bottom-right -> top-left
				A = { x: maxCx, y: maxCy };
				B = { x: minCx, y: minCy };
				break;
			case 'diag2': // top-right -> bottom-left
				A = { x: maxCx, y: minCy };
				B = { x: minCx, y: maxCy };
				break;
			case 'diag2Rev': // bottom-left -> top-right
				A = { x: minCx, y: maxCy };
				B = { x: maxCx, y: minCy };
				break;
			default:
				// no movement
				break;
		}
		return { A, B, minCx, maxCx, minCy, maxCy };
	}
	function widthAtPreview(it: SceneItem) {
		// Only apply when previewing a slider scene AND the item is marked resizeable.
		// IMPORTANT: do NOT call displayWidthPct() from here (causes recursion).
		if (!(previewMode && scene_type === 'slider' && (it.resizeable ?? true))) {
			return it.w_pct; // base width
		}

		const t = tSym(); // [-1..1]
		const w0 = it.w_pct; // base width (0..n)
		const minW = 0.05; // same MIN as editor
		const rawMax = (it.scale_factor ?? 1) * 1.0; // target at +100 (1.0 = 100% of canvas)
		const maxW = Math.max(minW, Math.min(3.0, rawMax));

		if (t >= 0) {
			// grow from base -> max
			return lerp(w0, maxW, t);
		} else {
			// shrink from base -> min
			return lerp(w0, minW, -t);
		}
	}
	function easingOf(it: SceneItem) {
		return it.anim_easing === 'linear' ? linear : cubicInOut;
	}
	function hasAnyFK(it: SceneItem): boolean {
		return (
			it.anim_move_cx_pct != null ||
			it.anim_move_cy_pct != null ||
			it.anim_scale_w_pct != null ||
			it.anim_rotate_by != null ||
			it.anim_opacity != null
		);
	}

	// Base (start) and Dest (final keyframe) per property
	function baseX(it: SceneItem) {
		return it.cx_pct;
	}
	function baseY(it: SceneItem) {
		return it.cy_pct;
	}
	function baseW(it: SceneItem) {
		return it.w_pct;
	}
	function baseR(it: SceneItem) {
		return it.rot ?? 0;
	}
	function baseO(it: SceneItem) {
		return clampPercent(isFinite(it.opacity as number) ? (it.opacity as number) : 100);
	}

	function destX(it: SceneItem) {
		return it.anim_move_cx_pct ?? it.cx_pct;
	}
	function destY(it: SceneItem) {
		return it.anim_move_cy_pct ?? it.cy_pct;
	}
	function destW(it: SceneItem) {
		return it.anim_scale_w_pct ?? it.w_pct;
	}
	function destR(it: SceneItem) {
		return normAngle((it.rot ?? 0) + (it.anim_rotate_by ?? 0));
	}
	function destO(it: SceneItem) {
		const fk = isFinite(it.anim_opacity as number) ? (it.anim_opacity as number) : null;
		return clampPercent(fk == null ? baseO(it) : fk);
	}

	/* -------------------------------------------------------
	   DATA → EDITOR ITEMS (hydrate from data.items)
	------------------------------------------------------- */
	type BackendItem = {
		id: string;
		scene_id?: string;
		kind: Kind;
		src?: string;

		cx_pct: number;
		cy_pct: number;
		w_pct: number;
		rot: number;
		z_index: number;

		opacity?: number | null; // 0..1 on backend

		role: Role;
		correct_target_id?: string | null;
		tap_message?: string | null;
		final_cx_pct?: number | null;
		final_cy_pct?: number | null;

		anim_type: AnimType;
		anim_duration_ms?: number | null;
		anim_delay_ms?: number | null;
		anim_easing?: EasingKind | null;
		anim_move_cx_pct?: number | null;
		anim_move_cy_pct?: number | null;
		anim_scale_w_pct?: number | null;
		anim_rotate_by?: number | null;
		anim_opacity_to?: number | null; // 0..1 on backend

		is_scene_trigger?: boolean | null;

		moveable?: boolean | null;
		resizeable?: boolean | null;
		move_dir?: string | null;
		scale_factor?: number | null;

		title?: string | null;
	};

	function fromBackend(b: BackendItem): SceneItem {
		return {
			id: b.id || uid(),
			scene_id: b.scene_id,
			kind: b.kind,
			src: b.src,
			cx_pct: b.cx_pct,
			cy_pct: b.cy_pct,
			w_pct: b.w_pct,
			rot: b.rot ?? 0,
			z_index: b.z_index ?? 1,
			// convert 0..1 → 0..100 (default 100%)
			opacity: isFinite(b.opacity as number) ? Math.round((b.opacity as number) * 100) : 100,
			role: b.role ?? 'none',
			correct_target_id: b.correct_target_id ?? null,
			tap_message: b.tap_message ?? null,
			final_cx_pct: b.final_cx_pct ?? null,
			final_cy_pct: b.final_cy_pct ?? null,
			anim_type: b.anim_type ?? 'none',
			anim_duration_ms: b.anim_duration_ms ?? 700,
			anim_delay_ms: b.anim_delay_ms ?? 0,
			anim_easing: b.anim_easing ?? 'easeInOut',
			anim_move_cx_pct: b.anim_move_cx_pct ?? null,
			anim_move_cy_pct: b.anim_move_cy_pct ?? null,
			anim_scale_w_pct: b.anim_scale_w_pct ?? null,
			anim_rotate_by: b.anim_rotate_by ?? null,
			// convert 0..1 → 0..100 but keep null when absent
			anim_opacity: b.anim_opacity_to == null ? null : Math.round(b.anim_opacity_to * 100),
			is_scene_trigger: !!b.is_scene_trigger,
			moveable: b.moveable ?? true,
			resizeable: b.resizeable ?? true,
			move_dir: b.move_dir ?? null,
			scale_factor: b.scale_factor ?? null,
			title: b.title ?? '',
			persisted: true // ✅ hydrated from DB
		};
	}

	// One-time hydration (and whenever new data.items array identity comes in)
	let lastHydratedVersion = 0;
	function hydrateFromData() {
		const srcItems: BackendItem[] = (data?.items ?? []) as BackendItem[];
		const version = Array.isArray(srcItems) ? srcItems.length : 0;
		if (version === lastHydratedVersion) return; // simple guard
		lastHydratedVersion = version;

		const mapped = srcItems.map(fromBackend).sort((a, b) => a.z_index - b.z_index);
		items = mapped;
		selectedId = null;
		statusMsg = mapped.length ? `Loaded ${mapped.length} item(s) from scene.` : 'No items.';
		measureSoon();
	}

	onMount(() => {
		hydrateFromData();

		if (canvasEl) {
			roCanvas = new ResizeObserver(updateCanvasDims);
			roCanvas.observe(canvasEl);
			updateCanvasDims();
		}
		window.addEventListener('paste', globalPasteHandler, true);
		window.addEventListener('pointermove', onGlobalPointerMove);
		window.addEventListener('pointerup', onGlobalPointerUp);
		window.addEventListener('keydown', globalKeyHandler, true);
	});

	onDestroy(() => {
		if (roCanvas && canvasEl) roCanvas.unobserve(canvasEl);
		roCanvas = null;
		roSel?.disconnect?.();
		roSel = null;
		roSelObservedEl = null;
		window.removeEventListener('paste', globalPasteHandler, true);
		window.removeEventListener('pointermove', onGlobalPointerMove);
		window.removeEventListener('pointerup', onGlobalPointerUp);
		window.removeEventListener('keydown', globalKeyHandler, true);
	});

	/* -------------------------------------------------------
	   BUILDERS (paste/asset)
	------------------------------------------------------- */
	function buildItemFromText(text: string): SceneItem | null {
		const pre = preclean(text ?? '');
		const raw = extractSvgBlock(pre);
		const clean = raw ? sanitizeSvgDom(raw) : '';
		if (!clean) return null;
		const ns = uid();
		const namespaced = namespaceSvgIds(clean, ns);
		const topZ = items.reduce((m, it) => Math.max(m, it.z_index), 0);
		return {
			id: uid(),
			kind: 'svg',
			src: namespaced,
			cx_pct: 0.5,
			cy_pct: 0.5,
			w_pct: 0.5,
			rot: 0,
			z_index: topZ + 1,
			opacity: 100, // UI percent
			role: 'none',
			correct_target_id: null,
			tap_message: null,
			final_cx_pct: null,
			final_cy_pct: null,
			anim_type: 'none',
			anim_duration_ms: 700,
			anim_delay_ms: 0,
			anim_easing: 'easeInOut',
			anim_move_cx_pct: null,
			anim_move_cy_pct: null,
			anim_scale_w_pct: null,
			anim_rotate_by: null,
			anim_opacity: null, // UI percent
			is_scene_trigger: false,
			moveable: true,
			resizeable: true,
			move_dir: null,
			scale_factor: null,
			title: '',
			persisted: false // ✅ new item, not in DB yet
		};
	}
	function addItemFromText(text: string) {
		const it = buildItemFromText(text);
		if (!it) {
			statusMsg = 'No valid <svg>…</svg> found in clipboard.';
			return;
		}
		pushHistory('add');
		items = [...items, it];
		selectedId = it.id;
		statusMsg = 'SVG added.';
		measureSoon();
	}
	function addItemFromAsset(a: { id: string; title: string; url: string }) {
		const topZ = items.reduce((m, it) => Math.max(m, it.z_index), 0);
		const it: SceneItem = {
			id: uid(),
			kind: 'image',
			src: a.url,
			cx_pct: 0.5,
			cy_pct: 0.5,
			w_pct: 0.5,
			rot: 0,
			z_index: topZ + 1,
			opacity: 100, // UI percent
			role: 'none',
			correct_target_id: null,
			tap_message: null,
			final_cx_pct: null,
			final_cy_pct: null,
			anim_type: 'none',
			anim_duration_ms: 700,
			anim_delay_ms: 0,
			anim_easing: 'easeInOut',
			anim_move_cx_pct: null,
			anim_move_cy_pct: null,
			anim_scale_w_pct: null,
			anim_rotate_by: null,
			anim_opacity: null, // UI percent
			is_scene_trigger: false,
			moveable: true,
			resizeable: true,
			move_dir: null,
			scale_factor: null,
			title: a.title ?? '',
			persisted: false // ✅ new item
		};
		pushHistory('add');
		items = [...items, it];
		selectedId = it.id;
		statusMsg = 'Asset added to canvas.';
		measureSoon();
	}
	$effect(() => {
		// only act when currentAsset is truthy (prevent loops)
		if (!currentAsset) return;
		addItemFromAsset(currentAsset);
		currentAsset = null;
		showAssetPicker = false;
	});

	/* -------------------------------------------------------
	   MEASURE / OBSERVERS (guarded to avoid loops)
	------------------------------------------------------- */
	async function measureSoon() {
		await tick();
		updateCanvasDims();
		updateSelectedDims();
		updateAllItemSizes(); // <-- NEW
	}

	function updateCanvasDims() {
		if (!canvasEl) return;
		const r = canvasEl.getBoundingClientRect();
		const w = Math.round(r.width);
		const h = Math.round(r.height);
		if (w !== canvasW) canvasW = w;
		if (h !== canvasH) canvasH = h;
	}
	function updateSelectedDims() {
		if (!selectedId) {
			if (selW !== 0) selW = 0;
			if (selH !== 0) selH = 0;
			return;
		}
		const el = holderMap[selectedId];
		if (!el) return;
		const svg = el.querySelector('svg') as SVGSVGElement | null;
		const target = svg ?? el;
		const r = target.getBoundingClientRect();
		const w = Math.round(r.width);
		const h = Math.round(r.height);
		if (w !== selW) selW = w;
		if (h !== selH) selH = h;
	}

	function ensureRuntimeForItem(it: SceneItem) {
		if (runtime.has(it.id)) return;

		const anim: RuntimeAnim = {
			x: tweened<number>(baseX(it), { duration: 0 }),
			y: tweened<number>(baseY(it), { duration: 0 }),
			w: tweened<number>(baseW(it), { duration: 0 }),
			r: tweened<number>(baseR(it), { duration: 0 }),
			o: tweened<number>(baseO(it), { duration: 0 })
		};
		runtime.set(it.id, anim);

		// init snapshot + subscriptions
		runtimeVals[it.id] = { x: baseX(it), y: baseY(it), w: baseW(it), r: baseR(it), o: baseO(it) };
		const unsubs: RuntimeUnsubs = {
			x: anim.x.subscribe((v) => (runtimeVals[it.id] = { ...runtimeVals[it.id], x: v })),
			y: anim.y.subscribe((v) => (runtimeVals[it.id] = { ...runtimeVals[it.id], y: v })),
			w: anim.w.subscribe((v) => (runtimeVals[it.id] = { ...runtimeVals[it.id], w: v })),
			r: anim.r.subscribe((v) => (runtimeVals[it.id] = { ...runtimeVals[it.id], r: v })),
			o: anim.o.subscribe((v) => (runtimeVals[it.id] = { ...runtimeVals[it.id], o: v }))
		};
		runtimeUnsubs.set(it.id, unsubs);
	}

	function clearRuntime() {
		// stop & cleanup
		for (const [id, un] of runtimeUnsubs) {
			un.x();
			un.y();
			un.w();
			un.r();
			un.o();
		}
		runtimeUnsubs.clear();
		runtime.clear();
		for (const k of Object.keys(runtimeVals)) delete runtimeVals[k];
		tapRuntimeActive = false;
	}
	/* ---------- DRAG PREVIEW (drag scenes) ---------- */
	// We reuse the same runtime tween infra (runtime / runtimeVals / tapRuntimeActive).
	// These are *preview-only* positions/flags and do not mutate saved item data.

	// live preview center positions for items in drag preview (cx, cy as fractions 0..1)
	let dragPreviewPositions: Record<string, { x: number; y: number }> = $state({});
	// original centers captured at preview start (to snap back on wrong drop)
	let dragOriginalPositions: Record<string, { x: number; y: number }> = $state({});
	// draggable ids correctly placed (regardless of fade-out)
	const dragPlaced = new Set<string>();
	// draggable ids that should be hidden (no final position; fade out)
	const dragHidden = new Set<string>();

	// pointer state for drag preview
	let previewDraggingId: string | null = null;
	let previewDragStartX = 0;
	let previewDragStartY = 0;
	let previewItemStartCx = 0;
	let previewItemStartCy = 0;

	// guard to start FK tween once
	let dragSceneFKPlayed = false;

	function draggables(): SceneItem[] {
		return items.filter((i) => i.role === 'draggable');
	}
	function targets(): SceneItem[] {
		return items.filter((i) => i.role === 'target');
	}
	function getItemById(id: string | null | undefined) {
		return id ? (items.find((i) => i.id === id) ?? null) : null;
	}

	function initDragPreview() {
		// capture original centers for all items, and seed preview positions
		dragPreviewPositions = {};
		dragOriginalPositions = {};
		dragPlaced.clear();
		dragHidden.clear();
		dragSceneFKPlayed = false;

		for (const it of items) {
			const cx = clampPct(it.cx_pct);
			const cy = clampPct(it.cy_pct);
			dragOriginalPositions[it.id] = { x: cx, y: cy };
			dragPreviewPositions[it.id] = { x: cx, y: cy };
		}
		clearRuntime(); // start clean
		tapDialogMsg = null;
		measureSoon();
	}

	function resetDragPreview() {
		dragPreviewPositions = {};
		dragOriginalPositions = {};
		dragPlaced.clear();
		dragHidden.clear();
		dragSceneFKPlayed = false;
		clearRuntime();
		tapDialogMsg = null;
		measureSoon();
	}

	// DOM helpers for hit-testing
	function rectOf(el: Element | null): DOMRect | null {
		if (!el) return null;
		try {
			return el.getBoundingClientRect();
		} catch {
			return null;
		}
	}
	function rectsOverlap(a: DOMRect | null, b: DOMRect | null) {
		if (!a || !b) return false;
		return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
	}
	function centerOfRect(r: DOMRect | null) {
		if (!r) return { x: 0, y: 0 };
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}
	function pointInsideRect(pt: { x: number; y: number }, r: DOMRect | null) {
		if (!r) return false;
		return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
	}

	function isOverCorrectTarget(dragId: string): 'correct' | 'wrong' | 'none' {
		const dragHolder = holderMap[dragId];
		const dragRect = rectOf(dragHolder);
		const dragCenter = centerOfRect(dragRect);

		const dragItem = getItemById(dragId);
		if (!dragItem) return 'none';

		const correctId = dragItem.correct_target_id ?? null;
		const corrItem = getItemById(correctId);
		const corrRect = rectOf(corrItem ? holderMap[corrItem.id] : null);

		if (corrRect && pointInsideRect(dragCenter, corrRect)) return 'correct';

		// If overlapping any other target => "wrong"
		for (const t of targets()) {
			if (!corrItem || t.id !== corrItem.id) {
				const tRect = rectOf(holderMap[t.id]);
				if (rectsOverlap(dragRect, tRect)) return 'wrong';
			}
		}
		return 'none';
	}

	// Animate a single draggable to its final position (if provided), else fade out.
	function settleDraggableAfterCorrectDrop(it: SceneItem) {
		ensureRuntimeForItem(it);
		const anim = runtime.get(it.id)!;
		const ease = easingOf(it);
		const dur = Math.max(
			1,
			Number.isFinite(it.anim_duration_ms as number) ? (it.anim_duration_ms as number) : 400
		);

		// If final position provided → move there; else fade out and mark hidden.
		if (isFinite(it.final_cx_pct as number) && isFinite(it.final_cy_pct as number)) {
			const fx = clampPct(it.final_cx_pct as number);
			const fy = clampPct(it.final_cy_pct as number);
			// Start from current displayed (preview) center: seed runtime to current
			const pos = dragPreviewPositions[it.id] ?? { x: it.cx_pct, y: it.cy_pct };
			anim.x.set(pos.x, { duration: 0 });
			anim.y.set(pos.y, { duration: 0 });
			anim.x.set(fx, { duration: dur, easing: ease });
			anim.y.set(fy, { duration: dur, easing: ease });
			// update preview position to final when done (best-effort)
			setTimeout(() => {
				dragPreviewPositions[it.id] = { x: fx, y: fy };
			}, dur + 10);
		} else {
			// No final -> fade out to 0 opacity
			const curO = displayOpacityPct(it);
			anim.o.set(curO, { duration: 0 });
			anim.o.set(0, { duration: dur, easing: ease });
			setTimeout(() => {
				dragHidden.add(it.id);
			}, dur + 10);
		}
		tapRuntimeActive = true;
		dragPlaced.add(it.id);
	}

	function allDragsResolved(): boolean {
		const ds = draggables();
		if (!ds.length) return false;
		return ds.every((d) => dragPlaced.has(d.id) || dragHidden.has(d.id));
	}

	// Start FK tweens for all items *from current visual state* (don’t rewind to base).
	function startFinalKeyframeTweensFromCurrent() {
		for (const it of items) ensureRuntimeForItem(it);

		for (const it of items) {
			if (!hasAnyFK(it)) continue;
			const anim = runtime.get(it.id)!;
			const delay = Math.max(
				0,
				Number.isFinite(it.anim_delay_ms as number) ? (it.anim_delay_ms as number) : 0
			);
			const duration = Math.max(
				1,
				Number.isFinite(it.anim_duration_ms as number) ? (it.anim_duration_ms as number) : 700
			);
			const ease = easingOf(it);

			// Don't reset to base — go wherever we are now → FK dest
			anim.x.set(destX(it), { delay, duration, easing: ease });
			anim.y.set(destY(it), { delay, duration, easing: ease });
			anim.w.set(destW(it), { delay, duration, easing: ease });
			anim.r.set(destR(it), { delay, duration, easing: ease });
			anim.o.set(destO(it), { delay, duration, easing: ease });
		}
		tapRuntimeActive = true;
	}

	function startTapTweens() {
		// Prepare runtime stores for current items
		for (const it of items) ensureRuntimeForItem(it);

		// Rewind to base instantly so replay feels consistent
		for (const it of items) {
			const anim = runtime.get(it.id)!;
			anim.x.set(baseX(it), { duration: 0 });
			anim.y.set(baseY(it), { duration: 0 });
			anim.w.set(baseW(it), { duration: 0 });
			anim.r.set(baseR(it), { duration: 0 });
			anim.o.set(baseO(it), { duration: 0 });
		}

		// Launch per-item tweens only if FK values are defined
		for (const it of items) {
			if (!hasAnyFK(it)) continue;
			const anim = runtime.get(it.id)!;
			const delay = Math.max(
				0,
				Number.isFinite(it.anim_delay_ms as number) ? (it.anim_delay_ms as number) : 0
			);
			const duration = Math.max(
				1,
				Number.isFinite(it.anim_duration_ms as number) ? (it.anim_duration_ms as number) : 700
			);
			const ease = easingOf(it);

			// Set each property independently (simultaneous start; each with same delay/duration/ease per item)
			anim.x.set(destX(it), { delay, duration, easing: ease });
			anim.y.set(destY(it), { delay, duration, easing: ease });
			anim.w.set(destW(it), { delay, duration, easing: ease });
			anim.r.set(destR(it), { delay, duration, easing: ease });
			anim.o.set(destO(it), { delay, duration, easing: ease });
		}

		tapRuntimeActive = true;
	}
	const DEBUG_TWEENS = false;
	if (DEBUG_TWEENS) {
		console.group('[TapPreview] start');
		for (const it of items) {
			if (!hasAnyFK(it)) continue;
			console.table({
				id: it.id,
				delay: it.anim_delay_ms ?? 0,
				duration: it.anim_duration_ms ?? 700,
				easing: it.anim_easing ?? 'easeInOut',
				base: { x: baseX(it), y: baseY(it), w: baseW(it), r: baseR(it), o: baseO(it) },
				dest: { x: destX(it), y: destY(it), w: destW(it), r: destR(it), o: destO(it) }
			});
		}
		console.groupEnd();
	}

	// Reactively observe the selected element's size (idempotent)
	$effect(() => {
		const el = selectedId ? holderMap[selectedId] : null;
		if (roSelObservedEl === el) return; // already observing this element
		roSel?.disconnect?.();
		roSel = null;
		roSelObservedEl = null;
		if (!el) return;
		roSel = new ResizeObserver(updateSelectedDims);
		roSel.observe(el);
		roSelObservedEl = el;
		updateSelectedDims();
	});

	// Leave preview => stop animation & close any tap dialog
	$effect(() => {
		if (!previewMode) {
			clearRuntime();
			tapDialogMsg = null;
		}
	});

	// Clean up rAF on destroy
	onDestroy(() => {
		stopPlayTween();
	});

	/* -------------------------------------------------------
	   GLOBAL EVENTS
	------------------------------------------------------- */
	function globalPasteHandler(e: ClipboardEvent) {
		const dt = e.clipboardData;
		const text = (dt?.getData('text/plain') || dt?.getData('text/html') || '').trim();
		if (text && /<svg[\s\S]*?<\/svg>/i.test(text)) {
			e.preventDefault();
			addItemFromText(text);
		}
	}
	function globalKeyHandler(e: KeyboardEvent) {
		// ✅ Don't treat Backspace/Delete as delete when typing or selecting text
		if (isTypingTarget(e.target)) return;

		// Undo
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo();
			return;
		}
		// Delete
		if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			if (!deleting) deleteSelected(false);
			return;
		}
		// Exit Final position mode
		if (finalPosMode && e.key === 'Escape') {
			e.preventDefault();
			toggleFinalPosMode(false);
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			if (saveState !== 'saving') saveAllItems();
			return;
		}
	}

	/* -------------------------------------------------------
	   POINTER INTERACTIONS (drag/resize/rotate)
	------------------------------------------------------- */
	function selectItem(id: string) {
		if (selectedId !== id) selectedId = id;
		measureSoon();
	}
	function onCanvasPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.overlay-strip')) return; // ignore overlay clicks
		if (!target.closest('.svg-holder')) {
			if (selectedId !== null) selectedId = null;
			statusMsg = '';
		}
	}
	function clientToCanvasXY(clientX: number, clientY: number) {
		if (!canvasEl) return { x: 0, y: 0 };
		const r = canvasEl.getBoundingClientRect();
		return { x: clientX - r.left, y: clientY - r.top };
	}
	function centerPxOf(it: SceneItem) {
		return { x: displayCxPct(it) * canvasW, y: displayCyPct(it) * canvasH };
	}

	/* ---------- display helpers (modes) ---------- */
	function displayCxPct(it: SceneItem): number {
		// runtime tweens (tap OR dragdrop)
		if (
			previewMode &&
			(scene_type === 'tap' || scene_type === 'dragdrop') &&
			tapRuntimeActive &&
			runtimeVals[it.id]
		) {
			return clampPct(runtimeVals[it.id].x);
		}
		// dragdrop preview manual position
		if (previewMode && scene_type === 'dragdrop') {
			const p = dragPreviewPositions[it.id];
			if (p) return clampPct(p.x);
		}

		if (finalKeyframeMode) return it.anim_move_cx_pct ?? it.cx_pct;
		if (finalPosMode && selectedId === it.id && it.role === 'draggable')
			return it.final_cx_pct ?? it.cx_pct;

		// slider preview motion
		if (previewMode && scene_type === 'slider' && (it.moveable ?? true) && it.move_dir) {
			const { halfW, halfH } = halfSizePct(it);
			const { A, B } = edgeEndpointsForDir(it.move_dir, it.cx_pct, it.cy_pct, halfW, halfH);
			const ts = tSym();
			const tt = (ts + 1) / 2;
			return clampPct(lerp(A.x, B.x, tt));
		}
		return it.cx_pct;
	}

	function displayCyPct(it: SceneItem): number {
		// runtime tweens (tap OR dragdrop)
		if (
			previewMode &&
			(scene_type === 'tap' || scene_type === 'dragdrop') &&
			tapRuntimeActive &&
			runtimeVals[it.id]
		) {
			return clampPct(runtimeVals[it.id].y);
		}
		// dragdrop preview manual position
		if (previewMode && scene_type === 'dragdrop') {
			const p = dragPreviewPositions[it.id];
			if (p) return clampPct(p.y);
		}

		if (finalKeyframeMode) return it.anim_move_cy_pct ?? it.cy_pct;
		if (finalPosMode && selectedId === it.id && it.role === 'draggable')
			return it.final_cy_pct ?? it.cy_pct;

		// slider preview motion
		if (previewMode && scene_type === 'slider' && (it.moveable ?? true) && it.move_dir) {
			const { halfW, halfH } = halfSizePct(it);
			const { A, B } = edgeEndpointsForDir(it.move_dir, it.cx_pct, it.cy_pct, halfW, halfH);
			const ts = tSym();
			const tt = (ts + 1) / 2;
			return clampPct(lerp(A.y, B.y, tt));
		}
		return it.cy_pct;
	}

	function displayWidthPct(it: SceneItem): number {
		if (
			previewMode &&
			(scene_type === 'tap' || scene_type === 'dragdrop') &&
			tapRuntimeActive &&
			runtimeVals[it.id]
		) {
			return Math.max(0.05, Math.min(3.0, runtimeVals[it.id].w));
		}

		if (finalKeyframeMode) return it.anim_scale_w_pct ?? it.w_pct;
		if (previewMode && scene_type === 'slider') return widthAtPreview(it);
		return it.w_pct;
	}

	function displayRotRad(it: SceneItem): number {
		if (
			previewMode &&
			(scene_type === 'tap' || scene_type === 'dragdrop') &&
			tapRuntimeActive &&
			runtimeVals[it.id]
		) {
			return normAngle(runtimeVals[it.id].r);
		}

		if (finalKeyframeMode) return normAngle((it.rot ?? 0) + (it.anim_rotate_by ?? 0));
		return it.rot ?? 0;
	}

	function displayOpacityPct(it: SceneItem): number {
		// runtime tweens (tap OR dragdrop)
		if (
			previewMode &&
			(scene_type === 'tap' || scene_type === 'dragdrop') &&
			tapRuntimeActive &&
			runtimeVals[it.id]
		) {
			return clampPercent(runtimeVals[it.id].o);
		}
		// dragdrop preview hidden-after-correct (no final position)
		if (previewMode && scene_type === 'dragdrop' && dragHidden.has(it.id)) {
			return 0;
		}

		if (finalKeyframeMode) {
			return clampPercent(
				isFinite(it.anim_opacity as number)
					? (it.anim_opacity as number)
					: isFinite(it.opacity as number)
						? (it.opacity as number)
						: 100
			);
		}
		return clampPercent(isFinite(it.opacity as number) ? (it.opacity as number) : 100);
	}

	function holderOutline(it: SceneItem): string {
		if (selectedId === it.id) {
			if (finalKeyframeMode) return '1px dashed #7C3AED'; // purple in FK mode
			if (finalPosMode && it.role === 'draggable') return '1px dashed #7C3AED';
			return '1px dashed #000';
		}
		return 'none';
	}

	function onPointerDownItem(e: PointerEvent, id: string) {
		// In preview mode, block interactions
		// In preview: block normal editing interactions
		if (previewMode) {
			// SLIDER stays as-is
			if (scene_type === 'slider') {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			// TAP PREVIEW
			if (scene_type === 'tap') {
				e.preventDefault();
				e.stopPropagation();
				const it = items.find((i) => i.id === id);
				if (!it) return;

				if (it.role === 'tappable') {
					if (it.tap_message && it.tap_message.trim()) {
						tapDialogMsg = it.tap_message.trim();
					}
					if (it.is_scene_trigger) {
						// (Re)start smooth per-item tweens
						startTapTweens();
						measureSoon();
					}
				}
				return;
			}
			// DRAG PREVIEW
			// DRAGDROP PREVIEW
			if (scene_type === 'dragdrop') {
				e.preventDefault();
				e.stopPropagation();
				const it = items.find((i) => i.id === id);
				if (!it) return;

				// Only draggable and not already resolved/hidden
				if (it.role === 'draggable' && !dragPlaced.has(it.id) && !dragHidden.has(it.id)) {
					selectItem(id); // optional highlight
					const p = dragPreviewPositions[id] ?? { x: it.cx_pct, y: it.cy_pct };
					const c = clientToCanvasXY(e.clientX, e.clientY);
					previewDraggingId = id;
					previewDragStartX = c.x;
					previewDragStartY = c.y;
					previewItemStartCx = p.x;
					previewItemStartCy = p.y;
					holderMap[id]?.setPointerCapture?.(e.pointerId);
				}
				return;
			}
		}

		if (e.button !== 0) return;
		selectItem(id);
		const it = items.find((i) => i.id === id)!;

		// Final Position mode (draggable only): update final_* center (disabled for slider scenes)
		if (!finalKeyframeMode && finalPosMode && it.role === 'draggable' && scene_type !== 'slider') {
			pushHistory('final-drag');
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			draggingFinal = true;
			dragStartCanvasX = x;
			dragStartCanvasY = y;
			startFinalCxPct = it.final_cx_pct ?? it.cx_pct;
			startFinalCyPct = it.final_cy_pct ?? it.cy_pct;
			holderMap[id]?.setPointerCapture?.(e.pointerId);
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		// GLOBAL Final Keyframe mode: drag moves anim_move_* for any item (not for slider scenes)
		if (finalKeyframeMode && scene_type !== 'slider') {
			pushHistory('fk-drag');
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			dragging = true;
			dragStartCanvasX = x;
			dragStartCanvasY = y;
			// start from displayed (anim or base)
			startCxPct = it.anim_move_cx_pct ?? it.cx_pct;
			startCyPct = it.anim_move_cy_pct ?? it.cy_pct;
			holderMap[id]?.setPointerCapture?.(e.pointerId);
			e.stopPropagation();
			e.preventDefault();
			return;
		}

		// Normal drag (base cx/cy)
		pushHistory('drag');
		const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
		dragging = true;
		dragStartCanvasX = x;
		dragStartCanvasY = y;
		startCxPct = it.cx_pct;
		startCyPct = it.cy_pct;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}

	function onGlobalPointerMove(e: PointerEvent) {
		// Normal drag / FK drag
		// DRAG PREVIEW move
		if (previewMode && scene_type === 'dragdrop' && previewDraggingId) {
			const c = clientToCanvasXY(e.clientX, e.clientY);
			const dCx = canvasW > 0 ? (c.x - previewDragStartX) / canvasW : 0;
			const dCy = canvasH > 0 ? (c.y - previewDragStartY) / canvasH : 0;

			let nx = clampPct(previewItemStartCx + dCx);
			let ny = clampPct(previewItemStartCy + dCy);

			dragPreviewPositions[previewDraggingId] = { x: nx, y: ny };
			updateSelectedDims();
			return; // don't fall through to editor interactions
		}

		if (dragging && selectedId) {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const dx = x - dragStartCanvasX,
				dy = y - dragStartCanvasY;
			const dCxPct = canvasW > 0 ? dx / canvasW : 0;
			const dCyPct = canvasH > 0 ? dy / canvasH : 0;

			if (finalKeyframeMode && scene_type !== 'slider') {
				items = items.map((it) =>
					it.id === selectedId
						? {
								...it,
								anim_move_cx_pct: startCxPct + dCxPct,
								anim_move_cy_pct: startCyPct + dCyPct
							}
						: it
				);
			} else {
				items = items.map((it) =>
					it.id === selectedId
						? { ...it, cx_pct: startCxPct + dCxPct, cy_pct: startCyPct + dCyPct }
						: it
				);
			}
			updateSelectedDims();
		}

		// Final position drag (draggable only, not for slider scenes)
		if (draggingFinal && selectedId && scene_type !== 'slider') {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const dx = x - dragStartCanvasX,
				dy = y - dragStartCanvasY;
			const dCxPct = canvasW > 0 ? dx / canvasW : 0;
			const dCyPct = canvasH > 0 ? dy / canvasH : 0;
			items = items.map((it) =>
				it.id === selectedId
					? {
							...it,
							final_cx_pct: startFinalCxPct + dCxPct,
							final_cy_pct: startFinalCyPct + dCyPct
						}
					: it
			);
			updateSelectedDims();
		}

		// Resize (base or FK)
		if (resizing && selectedId) {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const dx = x - resizeStartCanvasX,
				dy = y - resizeStartCanvasY;
			const avgDeltaPx = (dx + dy) / 2;
			const dWPct = canvasW > 0 ? avgDeltaPx / canvasW : 0;
			const MIN = 0.05,
				MAX = 3.0;
			let next = resizeStartWPct + dWPct;
			if (!isFinite(next)) next = resizeStartWPct;
			next = Math.max(MIN, Math.min(MAX, next));

			if (finalKeyframeMode && scene_type !== 'slider') {
				items = items.map((it) => (it.id === selectedId ? { ...it, anim_scale_w_pct: next } : it));
			} else {
				items = items.map((it) => (it.id === selectedId ? { ...it, w_pct: next } : it));
			}
			updateSelectedDims();
		}

		// Rotate (base or FK)
		if (rotating && selectedId) {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const ang = Math.atan2(y - rotateCenterY, x - rotateCenterX);
			const delta = normAngle(ang - rotateStartAngle);

			if (finalKeyframeMode && scene_type !== 'slider') {
				// We rotate the FINAL angle; convert to rotate_by relative to base rot
				const baseRot = items.find((i) => i.id === selectedId)?.rot ?? 0;
				const newFinal = normAngle(rotateInitial + delta); // rotateInitial was set to displayed angle
				const by = normAngle(newFinal - baseRot);
				items = items.map((it) => (it.id === selectedId ? { ...it, anim_rotate_by: by } : it));
			} else {
				items = items.map((it) =>
					it.id === selectedId ? { ...it, rot: normAngle(rotateInitial + delta) } : it
				);
			}
		}
	}

	function onGlobalPointerUp(e: PointerEvent) {
		// DRAG PREVIEW drop
		if (previewMode && scene_type === 'dragdrop' && previewDraggingId) {
			const dropId = previewDraggingId;
			holderMap[dropId]?.releasePointerCapture?.(e.pointerId);
			previewDraggingId = null;

			const it = getItemById(dropId);
			if (it && it.role === 'draggable') {
				const verdict = isOverCorrectTarget(dropId);
				if (verdict === 'correct') {
					// success → animate to final OR fade out
					settleDraggableAfterCorrectDrop(it);
					// all done? trigger FK animation (from current)
					if (!dragSceneFKPlayed && allDragsResolved()) {
						dragSceneFKPlayed = true;
						startFinalKeyframeTweensFromCurrent();
					}
				} else if (verdict === 'wrong') {
					// snap back to original and show message
					const orig = dragOriginalPositions[dropId] ?? { x: it.cx_pct, y: it.cy_pct };
					dragPreviewPositions[dropId] = { ...orig };
					tapDialogMsg = 'Not the correct target. Try again.';
					setTimeout(() => (tapDialogMsg = null), 1400);
				} else {
					// none — just leave it where it is (no message)
				}
			}
			measureSoon();
			return;
		}

		if (dragging && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		dragging = false;

		if (draggingFinal && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		draggingFinal = false;

		if (resizing && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		resizing = false;

		if (rotating && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		rotating = false;
	}

	function onPointerDownResize(e: PointerEvent, id: string) {
		if (previewMode && scene_type === 'slider') {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		if (e.button !== 0) return;
		pushHistory(finalKeyframeMode && scene_type !== 'slider' ? 'fk-resize' : 'resize');
		selectItem(id);
		const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
		resizing = true;
		resizeStartCanvasX = x;
		resizeStartCanvasY = y;
		const it = items.find((i) => i.id === id)!;
		resizeStartWPct =
			finalKeyframeMode && scene_type !== 'slider' ? (it.anim_scale_w_pct ?? it.w_pct) : it.w_pct;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}

	function onPointerDownRotate(e: PointerEvent, id: string) {
		if (previewMode && scene_type === 'slider') {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		if (e.button !== 0) return;
		pushHistory(finalKeyframeMode && scene_type !== 'slider' ? 'fk-rotate' : 'rotate');
		selectItem(id);
		const it = items.find((i) => i.id === id)!;
		const { x: cx, y: cy } = centerPxOf(it);
		rotateCenterX = cx;
		rotateCenterY = cy;
		const p = clientToCanvasXY(e.clientX, e.clientY);
		rotateStartAngle = Math.atan2(p.y - rotateCenterY, p.x - rotateCenterX);

		// rotateInitial = displayed angle in current mode
		rotateInitial =
			finalKeyframeMode && scene_type !== 'slider' ? displayRotRad(it) : (it.rot ?? 0);

		rotating = true;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}

	/* -------------------------------------------------------
	   EDITING HELPERS
	------------------------------------------------------- */
	function setSelectedTitle(v: string) {
		if (!selectedId) return;
		pushHistory('title');
		items = items.map((it) => (it.id === selectedId ? { ...it, title: v } : it));
	}
	function setSelectedRole(v: Role) {
		if (!selectedId) return;
		pushHistory('role');
		items = items.map((it) => (it.id === selectedId ? { ...it, role: v } : it));
	}
	function setSelectedTarget(targetId: string | null) {
		if (!selectedId) return;
		const sel = getSelected();
		if (!sel || sel.role !== 'draggable') return;
		pushHistory('set-target');
		items = items.map((it) => (it.id === selectedId ? { ...it, correct_target_id: targetId } : it));
		statusMsg = targetId ? `Target set to "${getItemLabelById(targetId)}".` : 'Target cleared.';
	}

	/* ---------- Z-ORDER HELPERS ---------- */
	function byZ(a: SceneItem, b: SceneItem) {
		return a.z_index - b.z_index;
	}
	function ordered(): SceneItem[] {
		return [...items].sort(byZ);
	} // bottom → top
	function setOrder(newOrder: SceneItem[]) {
		items = newOrder.map((it, i) => ({ ...it, z_index: i + 1 }));
	}

	function bringToFront() {
		if (!selectedId) return;
		pushHistory('reorder-front');
		const arr = ordered();
		const idx = arr.findIndex((i) => i.id === selectedId);
		if (idx < 0) return;
		const [sel] = arr.splice(idx, 1);
		arr.push(sel);
		setOrder(arr);
		measureSoon();
	}
	function sendToBack() {
		if (!selectedId) return;
		pushHistory('reorder-back');
		const arr = ordered();
		const idx = arr.findIndex((i) => i.id === selectedId);
		if (idx < 0) return;
		const [sel] = arr.splice(idx, 1);
		arr.unshift(sel);
		setOrder(arr);
		measureSoon();
	}
	function bringForward() {
		if (!selectedId) return;
		const arr = ordered();
		const idx = arr.findIndex((i) => i.id === selectedId);
		if (idx < 0 || idx === arr.length - 1) return;
		pushHistory('reorder-forward');
		[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
		setOrder(arr);
		measureSoon();
	}
	function sendBackward() {
		if (!selectedId) return;
		const arr = ordered();
		const idx = arr.findIndex((i) => i.id === selectedId);
		if (idx <= 0) return;
		pushHistory('reorder-backward');
		[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
		setOrder(arr);
		measureSoon();
	}

	/* ---------- DELETE ITEM (now deletes from DB if persisted) ---------- */
	async function deleteSelected(confirmPrompt = true) {
		if (!selectedId || deleting) return;
		const it = items.find((i) => i.id === selectedId);
		if (!it) return;

		if (confirmPrompt) {
			const ok = window.confirm(`Delete "${it.title || it.id}" from canvas?`);
			if (!ok) return;
		}

		deleting = true;
		statusMsg = 'Deleting…';

		try {
			// If the item exists in DB, delete it there first
			if (it.persisted) {
				const res = await fetch(`/api/scene-items/${encodeURIComponent(it.id)}`, {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' }
				});
				let data: any = {};
				try {
					data = await res.json();
				} catch {
					/* no-op if response has no JSON */
				}
				if (!res.ok || data?.ok === false) {
					throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
				}
			}

			// Remove locally + clean references
			pushHistory('delete');
			const deletedId = selectedId;
			const remaining = items.filter((i) => i.id !== deletedId);
			const cleaned = remaining.map((i) =>
				i.correct_target_id === deletedId ? { ...i, correct_target_id: null } : i
			);
			const arr = [...cleaned].sort(byZ);
			setOrder(arr);
			holderMap[selectedId] = null;
			selectedId = null;

			statusMsg = 'Item deleted.';
			showGlobalToast('Deleted ✓');
		} catch (err: any) {
			const msg = err?.message || String(err);
			statusMsg = `Delete failed: ${msg}`;
			showGlobalToast('Delete failed ✕');
		} finally {
			deleting = false;
			measureSoon();
		}
	}
	// Upload inline SVG if needed and return a public URL for the item
	async function ensureUploadAndUrl(it: SceneItem): Promise<string> {
		const inline = isInlineSvg(it.src);
		if (!inline) return it.src!;

		const objectKey = generateSvgKey();
		const uploadRes = await fetch('/api/assets/upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ svg: it.src, object_key: objectKey })
		});
		const uploadData = await uploadRes.json();
		if (!uploadRes.ok || !uploadData?.ok) {
			const extra = uploadData?.detail ? ` — ${uploadData.detail}` : '';
			throw new Error(uploadData?.error || `Upload failed (HTTP ${uploadRes.status})${extra}`);
		}
		const finalObjectKey: string = uploadData.object_key ?? objectKey;
		const base = (PUBLIC_BUNNY_PUBLIC_HOST || '').replace(/\/+$/, '');
		const publicUrl = base ? `${base}/${finalObjectKey}` : `/${finalObjectKey}`;

		// Optional: also insert as asset record so it appears in library
		const insertRes = await fetch('/api/assets', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: it.title || 'Untitled',
				provider: 'bunny',
				bucket_or_zone: 'mu-agonist-app',
				object_key: finalObjectKey,
				public_url: publicUrl,
				content_type: 'image/svg+xml'
			})
		});
		const insertData = await insertRes.json();
		if (!insertRes.ok || !insertData?.ok)
			throw new Error(insertData?.error || `Insert failed (HTTP ${insertRes.status})`);

		return publicUrl;
	}

	// Build backend payload for an item; let the caller pass a mapped target id (if any)
	function buildPayload(
		it: SceneItem,
		publicUrl: string,
		mappedTargetId: string | null
	): Record<string, any> {
		const baseOpacity01 =
			it.opacity == null
				? 1
				: Math.min(1, Math.max(0, (isFinite(it.opacity) ? it.opacity : 100) / 100));
		const fkOpacity01 =
			it.anim_opacity == null
				? null
				: Math.min(1, Math.max(0, (isFinite(it.anim_opacity) ? it.anim_opacity : 100) / 100));

		return {
			scene_id: id,
			kind: it.kind,
			src: publicUrl,
			cx_pct: Number(it.cx_pct.toFixed(6)),
			cy_pct: Number(it.cy_pct.toFixed(6)),
			w_pct: Number(it.w_pct.toFixed(6)),
			rot: Number((it.rot ?? 0).toFixed(6)),
			z_index: it.z_index,
			role: it.role,
			correct_target_id: mappedTargetId, // <-- already mapped
			tap_message: it.tap_message ?? null,
			final_cx_pct: it.final_cx_pct ?? null,
			final_cy_pct: it.final_cy_pct ?? null,
			anim_type: it.anim_type,
			anim_duration_ms: it.anim_duration_ms ?? null,
			anim_delay_ms: it.anim_delay_ms ?? null,
			anim_easing: it.anim_easing ?? null,
			anim_move_cx_pct: it.anim_move_cx_pct ?? null,
			anim_move_cy_pct: it.anim_move_cy_pct ?? null,
			anim_scale_w_pct: it.anim_scale_w_pct ?? null,
			anim_rotate_by: it.anim_rotate_by ?? null,
			anim_opacity_to: fkOpacity01, // 0..1 or null
			is_scene_trigger: it.is_scene_trigger ?? false,
			moveable: it.moveable ?? true,
			resizeable: it.resizeable ?? true,
			move_dir: it.move_dir ?? null,
			scale_factor: it.scale_factor ?? null,
			opacity: baseOpacity01, // 0..1
			title: typeof it.title === 'string' ? it.title : null
		};
	}
	// Save ALL items in one go (create new, update existing, and fix cross-references)
	async function saveAllItems() {
		if (!items.length) {
			statusMsg = 'Nothing to save.';
			showToast('success', 'Nothing to save');
			return;
		}

		saveState = 'saving';
		saveToast = 'Saving…';
		statusMsg = 'Saving all items…';

		try {
			// Work on a snapshot to avoid racing state changes mid-save
			const snapshotItems = items.map((x) => ({ ...x }));

			// 1) Upload inline SVGs (only once per item) and cache URLs
			const urlCache = new Map<string, string>(); // localId -> publicUrl
			for (const it of snapshotItems) {
				const url = await ensureUploadAndUrl(it);
				urlCache.set(it.id, url);
			}

			// 2) First pass: CREATE all non-persisted items WITHOUT cross refs to other new items.
			// Collect mapping oldId -> newId
			const idMap = new Map<string, string>();
			for (const it of snapshotItems.filter((x) => !x.persisted)) {
				const publicUrl = urlCache.get(it.id)!;

				// If target points to a NEW item, set null for now; we will patch later.
				const targetIsNew =
					!!it.correct_target_id &&
					snapshotItems.some((x) => x.id === it.correct_target_id && !x.persisted);
				const payload = buildPayload(
					it,
					publicUrl,
					targetIsNew ? null : (it.correct_target_id ?? null)
				);

				const res = await fetch('/api/scene-items', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				const data = await res.json();
				if (!res.ok || !data?.ok) {
					throw new Error(data?.error || `Create failed (HTTP ${res.status})`);
				}
				const newId = data.id as string;
				if (newId && newId !== it.id) idMap.set(it.id, newId);
			}

			// 3) Update local state IDs + persisted flags using the idMap
			if (idMap.size > 0) {
				items = items.map((x) => {
					if (idMap.has(x.id)) {
						return { ...x, id: idMap.get(x.id)!, persisted: true };
					}
					return x;
				});
				// Also fix local correct_target_id references
				items = items.map((x) => {
					if (!x.correct_target_id) return x;
					const mapped = idMap.get(x.correct_target_id);
					return mapped ? { ...x, correct_target_id: mapped } : x;
				});
				// If selection pointed to an old id, remap it too
				if (selectedId && idMap.has(selectedId)) selectedId = idMap.get(selectedId)!;
			}

			// Recompute a fresh snapshot (with updated ids/refs) for the PATCH pass
			const afterCreate = items.map((x) => ({ ...x }));

			// 4) Second pass: PATCH everything with final, fully-mapped payloads (ensures refs are correct for all)
			for (const it of afterCreate) {
				const publicUrl = urlCache.get(idMap.get(it.id) ?? it.id) || urlCache.get(it.id) || it.src!;
				const mappedTarget =
					it.correct_target_id && idMap.has(it.correct_target_id)
						? idMap.get(it.correct_target_id)!
						: (it.correct_target_id ?? null);

				const payload = buildPayload(it, publicUrl, mappedTarget);

				const res = await fetch(`/api/scene-items/${encodeURIComponent(it.id)}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				const data = await res.json();
				if (!res.ok || !data?.ok) {
					throw new Error(data?.error || `Update failed (HTTP ${res.status})`);
				}
			}

			statusMsg = `Saved ${afterCreate.length} item(s).`;
			showToast('success', 'Saved all ✓');
			saveState = 'success';
		} catch (err: any) {
			statusMsg = `Failed: ${err?.message || err}`;
			showToast('error', 'Error ✕');
			saveState = 'error';
		} finally {
			// No need to mutate selection; just re-measure
			measureSoon();
		}
	}

	/* ---------- SAVE (create OR update) ---------- */
	async function saveItem() {
		statusMsg = '';
		lastCreatedId = null;
		if (!selectedId) {
			statusMsg = 'Select an item first.';
			return;
		}
		const it = items.find((i) => i.id === selectedId)!;
		if (!it?.src) {
			statusMsg = 'Selected item has no source.';
			return;
		}
		saveState = 'saving';
		saveToast = 'Saving…';

		const inline = isInlineSvg(it.src);
		try {
			let publicUrl = it.src;
			if (inline) {
				const objectKey = generateSvgKey();
				const uploadRes = await fetch('/api/assets/upload', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ svg: it.src, object_key: objectKey })
				});
				const uploadData = await uploadRes.json();
				if (!uploadRes.ok || !uploadData?.ok) {
					const extra = uploadData?.detail ? ` — ${uploadData.detail}` : '';
					throw new Error(uploadData?.error || `Upload failed (HTTP ${uploadRes.status})${extra}`);
				}
				const finalObjectKey: string = uploadData.object_key ?? objectKey;
				const base = (PUBLIC_BUNNY_PUBLIC_HOST || '').replace(/\/+$/, '');
				publicUrl = base ? `${base}/${finalObjectKey}` : `/${finalObjectKey}`;

				const insertRes = await fetch('/api/assets', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						title: it.title || 'Untitled',
						provider: 'bunny',
						bucket_or_zone: 'mu-agonist-app',
						object_key: finalObjectKey,
						public_url: publicUrl,
						content_type: 'image/svg+xml'
					})
				});
				const insertData = await insertRes.json();
				if (!insertRes.ok || !insertData?.ok)
					throw new Error(insertData?.error || `Insert failed (HTTP ${insertRes.status})`);
				statusMsg = `Uploaded & added to assets. `;
			} else {
				statusMsg = `Using existing asset URL. `;
			}

			// 🔹 Convert opacities for backend:
			// - Base opacity: 0..1
			// - FK opacity: 0..1 -> send as anim_opacity_to
			const baseOpacity01 = pctToFrac(
				isFinite(it.opacity as number) ? (it.opacity as number) : 100
			);
			const fkOpacity01 =
				it.anim_opacity == null
					? null
					: pctToFrac(isFinite(it.anim_opacity) ? it.anim_opacity! : 100);

			const payload: Record<string, any> = {
				scene_id: id,
				kind: it.kind,
				src: publicUrl,
				cx_pct: Number(it.cx_pct.toFixed(6)),
				cy_pct: Number(it.cy_pct.toFixed(6)),
				w_pct: Number(it.w_pct.toFixed(6)),
				rot: Number((it.rot ?? 0).toFixed(6)),
				z_index: it.z_index,
				role: it.role,
				correct_target_id: it.correct_target_id ?? null,
				tap_message: it.tap_message ?? null,
				final_cx_pct: it.final_cx_pct ?? null,
				final_cy_pct: it.final_cy_pct ?? null,
				anim_type: it.anim_type,
				anim_duration_ms: it.anim_duration_ms ?? null,
				anim_delay_ms: it.anim_delay_ms ?? null,
				anim_easing: it.anim_easing ?? null,
				anim_move_cx_pct: it.anim_move_cx_pct ?? null,
				anim_move_cy_pct: it.anim_move_cy_pct ?? null,
				anim_scale_w_pct: it.anim_scale_w_pct ?? null,
				anim_rotate_by: it.anim_rotate_by ?? null,
				anim_opacity_to: fkOpacity01, // fraction or null
				is_scene_trigger: it.is_scene_trigger ?? false,
				moveable: it.moveable ?? true,
				resizeable: it.resizeable ?? true,
				move_dir: it.move_dir ?? null,
				scale_factor: it.scale_factor ?? null,
				opacity: baseOpacity01, // base opacity 0..1
				title: typeof it.title === 'string' ? it.title : null
			};

			let saveRes: Response;
			let saveData: any;

			if (it.persisted) {
				// ✅ UPDATE existing
				saveRes = await fetch(`/api/scene-items/${encodeURIComponent(it.id)}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				saveData = await saveRes.json();
				if (!saveRes.ok || !saveData?.ok) {
					throw new Error(saveData?.error || `Update failed (HTTP ${saveRes.status})`);
				}
				statusMsg += `Updated scene item.`;
				showToast('success', 'Saved ✓');
			} else {
				// ✅ CREATE new
				saveRes = await fetch('/api/scene-items', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				saveData = await saveRes.json();
				if (!saveRes.ok || !saveData?.ok) {
					throw new Error(saveData?.error || `Create failed (HTTP ${saveRes.status})`);
				}
				lastCreatedId = saveData.id ?? null;

				// Mark this item as persisted and adopt the DB id (so future saves PATCH)
				if (lastCreatedId) {
					items = items.map((x) =>
						x.id === it.id ? { ...x, id: lastCreatedId!, persisted: true } : x
					);
					selectedId = lastCreatedId;
				} else {
					items = items.map((x) => (x.id === it.id ? { ...x, persisted: true } : x));
				}
				statusMsg += ` Saved scene item. Scene item id: ${lastCreatedId ?? '(unknown)'}`;
				showToast('success', 'Created ✓');
			}

			saveState = 'success';
		} catch (err: any) {
			const msg = `Failed: ${err?.message || err}`;
			statusMsg = msg;
			saveState = 'error';
			showToast('error', 'Error ✕');
		}
	}

	/* ---------- UI helpers ---------- */
	function roleBadgeText(role: Role) {
		if (role === 'draggable') return 'DRAG';
		if (role === 'tappable') return 'TAP';
		if (role === 'target') return 'TARGET';
		return '';
	}
	function roleBadgeClass(role: Role) {
		switch (role) {
			case 'draggable':
				return 'bg-[#E6F2FF] text-[#0B66C3] border-[#0B66C3]';
			case 'tappable':
				return 'bg-[#FFF7E6] text-[#B26A00] border-[#B26A00]';
			case 'target':
				return 'bg-[#FCE7F3] text-[#9D174D] border-[#9D174D]';
			default:
				return '';
		}
	}

	/* ---------- Menus: Role + Order + Target ---------- */
	const roleOptions: Role[] = ['none', 'draggable', 'target', 'tappable'];
	let showRoleMenu = $state(false);
	let showOrderMenu = $state(false);
	let showTargetMenu = $state(false);

	let roleBtnEl: HTMLButtonElement | null = null;
	let roleMenuEl: HTMLDivElement | null = null;

	let orderBtnEl: HTMLButtonElement | null = null;
	let orderMenuEl: HTMLDivElement | null = null;

	let targetBtnEl: HTMLButtonElement | null = null;
	let targetMenuEl: HTMLDivElement | null = null;

	function targetCandidates(): SceneItem[] {
		return items.filter((i) => i.role === 'target').sort(byZ);
	}

	function toggleRoleMenu() {
		if (!selectedId) return;
		showRoleMenu = !showRoleMenu;
		if (showRoleMenu) {
			showOrderMenu = false;
			showTargetMenu = false;
		}
	}
	function toggleOrderMenu() {
		if (!selectedId) return;
		showOrderMenu = !showOrderMenu;
		if (showOrderMenu) {
			showRoleMenu = false;
			showTargetMenu = false;
		}
	}
	function toggleTargetMenu() {
		const sel = getSelected();
		if (!sel || sel.role !== 'draggable') return;
		showTargetMenu = !showTargetMenu;
		if (showTargetMenu) {
			showRoleMenu = false;
			showOrderMenu = false;
		}
	}
	function closeMenus() {
		showRoleMenu = false;
		showOrderMenu = false;
		showTargetMenu = false;
	}

	function onGlobalClick(e: MouseEvent) {
		const t = e.target as Node;
		if (showRoleMenu) {
			if (roleMenuEl?.contains(t)) return;
			if (roleBtnEl?.contains(t)) return;
		}
		if (showOrderMenu) {
			if (orderMenuEl?.contains(t)) return;
			if (orderBtnEl?.contains(t)) return;
		}
		if (showTargetMenu) {
			if (targetMenuEl?.contains(t)) return;
			if (targetBtnEl?.contains(t)) return;
		}
		if (showRoleMenu || showOrderMenu || showTargetMenu) closeMenus();
	}
	function onGlobalKeydown(e: KeyboardEvent) {
		if ((showRoleMenu || showOrderMenu || showTargetMenu) && e.key === 'Escape') {
			e.preventDefault();
			closeMenus();
		}
	}
	onMount(() => {
		document.addEventListener('mousedown', onGlobalClick, true);
		document.addEventListener('keydown', onGlobalKeydown, true);
	});
	onDestroy(() => {
		document.removeEventListener('mousedown', onGlobalClick, true);
		document.removeEventListener('keydown', onGlobalKeydown, true);
	});

	function chooseRole(r: Role) {
		setSelectedRole(r);
		closeMenus();
	}
	function chooseTarget(tid: string | null) {
		setSelectedTarget(tid);
		closeMenus();
	}
	function actAndClose(fn: () => void) {
		fn();
		closeMenus();
	}

	/* ---------- Final Position Mode (draggable only, per selection) ---------- */
	function canSetFinalForSelected(): boolean {
		const it = getSelected();
		return !!(it && it.role === 'draggable' && scene_type !== 'slider');
	}
	function toggleFinalPosMode(force?: boolean) {
		if (!canSetFinalForSelected()) {
			finalPosMode = false;
			statusMsg =
				scene_type === 'slider'
					? 'Final position is disabled for slider scenes.'
					: 'Final position is only applicable for draggable items.';
			return;
		}
		const next = typeof force === 'boolean' ? force : !finalPosMode;
		if (next && !finalPosMode) {
			const it = getSelected()!;
			if (it.final_cx_pct == null) it.final_cx_pct = it.cx_pct;
			if (it.final_cy_pct == null) it.final_cy_pct = it.cy_pct;
			statusMsg = 'Final Position mode ON — drag to set final center (Esc to exit).';
		} else if (!next && finalPosMode) {
			statusMsg = 'Final Position mode OFF.';
		}
		finalPosMode = next;
	}

	/* ---------- Settings dialog (anim / tap / title / slider / opacity) ---------- */
	const animTypes: AnimType[] = ['none', 'move', 'scale', 'rotate', 'opacity', 'jitter', 'pulse'];
	let showAnimDialog = $state(false); // reused as "settings" dialog
	function openAnimSettingsForSelected() {
		if (!selectedId) return;
		showAnimDialog = true;
	}
	function closeAnimDialog() {
		showAnimDialog = false;
	}

	function safeNumber(v: any, fallback: number): number {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	}
	async function checkAssetTitleExists(title: string): Promise<boolean> {
		if (!title?.trim()) return false;
		const res = await fetch(`/api/assets/search?q=${encodeURIComponent(title.trim())}&limit=1`);
		if (!res.ok) return false;
		const out = await res.json();
		return out?.count > 0;
	}

	async function saveSettingsFromForm(fd: FormData) {
		if (!selectedId) return;

		const sel = getSelected();
		if (!sel) return;

		const title = (fd.get('title') as string) ?? '';
		if (!getSelected()?.persisted && title) {
			const exists = await checkAssetTitleExists(title);
			if (exists) {
				statusMsg = `⚠️ Title "${title}" already exists in assets. Pick a unique name.`;
				showGlobalToast('Duplicate title warning');
				return; // stop save
			}
		}

		// Build a single update object; push one history entry
		const update: Partial<SceneItem> = { title };

		// 🔹 Base Opacity (ALWAYS available) — UI percent
		const baseOpacityStr = fd.get('opacity');
		const baseOpacity =
			baseOpacityStr !== null && `${baseOpacityStr}` !== ''
				? clampPercent(Number(baseOpacityStr))
				: clampPercent(sel.opacity ?? 100);
		Object.assign(update, { opacity: baseOpacity });

		// 🔹 Animation settings (ONLY when not a slider scene and FK mode is on) — includes FK opacity in UI percent
		if (scene_type !== 'slider' && finalKeyframeMode) {
			const anim_type = ((fd.get('anim_type') as AnimType) || sel.anim_type || 'none') as AnimType;
			const anim_duration_ms = safeNumber(fd.get('anim_duration_ms'), sel.anim_duration_ms ?? 700);
			const anim_delay_ms = safeNumber(fd.get('anim_delay_ms'), sel.anim_delay_ms ?? 0);
			const easingRaw = (fd.get('anim_easing') as EasingKind) || (sel.anim_easing ?? 'easeInOut');
			const anim_easing: EasingKind = easingRaw === 'linear' ? 'linear' : 'easeInOut';

			const animOpacityStr = fd.get('anim_opacity');
			const anim_opacity =
				animOpacityStr !== null && `${animOpacityStr}` !== ''
					? clampPercent(Number(animOpacityStr))
					: isFinite(sel.anim_opacity as number)
						? (sel.anim_opacity as number)
						: clampPercent(sel.opacity ?? 100);

			Object.assign(update, {
				anim_type,
				anim_duration_ms,
				anim_delay_ms,
				anim_easing,
				anim_opacity // UI percent; converted to 0..1 on save
			});
		}

		// 🔹 Tap settings (ALWAYS available if tap scene + tappable item), even in FK mode
		const allowTapControls = scene_type === 'tap' && sel?.role === 'tappable';
		if (allowTapControls) {
			const tap_message_raw = (fd.get('tap_message') as string) ?? '';
			const tap_message = tap_message_raw.trim();
			const is_scene_trigger = !!fd.get('is_scene_trigger');
			Object.assign(update, {
				tap_message,
				is_scene_trigger
			});
		}

		// 🔹 Slider item constraints (ONLY for slider scenes)
		if (scene_type === 'slider') {
			const moveable = !!fd.get('moveable');
			const resizeable = !!fd.get('resizeable');
			const move_dir_val = (fd.get('move_dir') as string) || '';
			const scale_factor =
				fd.get('scale_factor') !== null && `${fd.get('scale_factor')}` !== ''
					? safeNumber(fd.get('scale_factor'), sel.scale_factor ?? 1)
					: (sel.scale_factor ?? null);

			Object.assign(update, {
				moveable,
				resizeable,
				move_dir: move_dir_val ? (move_dir_val as MoveDir) : null,
				scale_factor
			});
		}

		pushHistory('settings');
		items = items.map((it) => (it.id === selectedId ? { ...it, ...update } : it));

		if (scene_type === 'slider') {
			statusMsg = 'Updated title, opacity, and slider constraints.';
		} else if (allowTapControls && finalKeyframeMode) {
			statusMsg = 'Updated title, opacity, animation, and tap settings.';
		} else if (allowTapControls) {
			statusMsg = 'Updated title, opacity, and tap settings.';
		} else if (finalKeyframeMode) {
			statusMsg = 'Updated title, opacity, and animation settings.';
		} else {
			statusMsg = 'Updated title and opacity.';
		}
	}

	async function handlePasteButton() {
		statusMsg = '';
		try {
			const text = await navigator.clipboard.readText();
			if (!text) {
				statusMsg = 'Clipboard is empty or unreadable.';
				return;
			}
			addItemFromText(text);
		} catch {
			statusMsg = 'Clipboard read blocked by browser permissions. Try Ctrl/Cmd+V.';
		}
	}
</script>

<!-- Canvas -->
<div
	style="background-color: {data.scene.background_color}"
	class="relative aspect-[9/16] w-full max-w-[360px] overflow-hidden border"
	bind:this={canvasEl}
	on:pointerdown={onCanvasPointerDown}
>
	{#if items.length === 0}
		<div
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-xs leading-snug text-gray-400"
		>
			Press <kbd class="rounded border px-1">Ctrl</kbd>+<kbd class="rounded border px-1">V</kbd> (or
			Cmd+V) to paste SVGs, or pick an asset (＋) above.
		</div>
	{/if}

	{#each items as it (it.id)}
		<!-- Holder defines position/size; NOT rotated -->
		<div
			class="svg-holder absolute -translate-x-1/2 -translate-y-1/2 touch-none"
			bind:this={holderMap[it.id]}
			on:pointerdown={(e) => onPointerDownItem(e, it.id)}
			style="
				left: {displayCxPct(it) * 100}%;
				top: {displayCyPct(it) * 100}%;
				width: {displayWidthPct(it) * 100}%;
				z-index: {it.z_index};
				outline: {holderOutline(it)};
			"
		>
			<!-- Role badge -->
			{#if it.role !== 'none'}
				<div
					class="pointer-events-none absolute top-0 left-0 z-20 translate-x-[-4px] translate-y-[-4px]"
					aria-label={`role: ${it.role}`}
				>
					<span
						class={`inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none shadow-sm ${roleBadgeClass(it.role)}`}
					>
						{roleBadgeText(it.role)}
					</span>
				</div>
			{/if}

			<!-- Mode badges -->
			{#if finalPosMode && selectedId === it.id && it.role === 'draggable' && scene_type !== 'slider'}
				<div class="pointer-events-none absolute -top-2 -right-2 z-20">
					<span
						class="rounded-sm border border-purple-600 bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] text-purple-700 shadow-sm"
						>FINAL</span
					>
				</div>
			{/if}
			{#if finalKeyframeMode && selectedId === it.id && scene_type !== 'slider'}
				<div class="pointer-events-none absolute -top-2 -right-2 z-20">
					<span
						class="rounded-sm border border-purple-600 bg-purple-50 px-1.5 py-0.5 font-mono text-[10px] text-purple-700 shadow-sm"
						>KEYFRAME</span
					>
				</div>
			{/if}

			<!-- Rotated inner wrapper (content sits under badges) -->
			<div
				class="relative z-10 w-full"
				style="
					transform: rotate({displayRotRad(it)}rad);
					transform-origin: 50% 50%;
					opacity: {clamp01(displayOpacityPct(it) / 100)};
				"
			>
				{#if isInlineSvg(it.src)}
					{@html it.src || ''}
				{:else}
					<img
						src={it.src}
						alt={it.title || 'asset'}
						class="block h-auto w-full select-none"
						draggable="false"
						decoding="async"
						loading="eager"
					/>
				{/if}

				{#if selectedId === it.id}
					<!-- ROTATE handle (top-center) inside rotated wrapper -->
					<div class="absolute left-1/2 -translate-x-1/2 -translate-y-full" style="top: -12px;">
						<div class="mx-auto h-3 w-[1px] bg-black opacity-70"></div>
						<div
							class="relative mt-1 h-6 w-6 rounded-full border border-black bg-white"
							on:pointerdown={(e) => onPointerDownRotate(e, it.id)}
							title="Rotate"
							style="touch-action:none"
						>
							<svg viewBox="0 0 24 24" class="pointer-events-none absolute inset-0 m-auto h-4 w-4">
								<path
									d="M12 5v-3l4 4-4 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"
									fill="none"
									stroke="black"
									stroke-width="1.5"
								/>
							</svg>
						</div>
					</div>
				{/if}
			</div>

			{#if selectedId === it.id}
				<!-- RESIZE handle anchored to holder's bottom-right (never rotates) -->
				<div
					class="absolute right-0 bottom-0 z-20 h-6 w-6 rounded-md border border-black bg-white"
					style="transform: translate(50%, 50%); touch-action:none"
					on:pointerdown={(e) => onPointerDownResize(e, it.id)}
					title="Resize"
				>
					<div class="pointer-events-none absolute top-0 left-0 h-full w-full">
						<svg viewBox="0 0 10 10" class="block h-full w-full"
							><path d="M2 8 L8 2" stroke="black" stroke-width="1" fill="none" /></svg
						>
					</div>
				</div>
			{/if}
		</div>
	{/each}

	<!-- 🔹 OVERLAY STRIP: Top-left controls (Paste / Create Asset / Undo / Save / Final Keyframe toggle*) -->
	<div
		class="overlay-strip pointer-events-auto absolute top-4 left-4 z-[9999] flex items-center gap-2 border bg-white/75 p-1 px-2 shadow-lg"
	>
		<button class="p-1.5" on:click={handlePasteButton} title="Paste (from clipboard)">
			<ClipboardPaste strokeWidth={1.5} size={18} />
		</button>

		<!-- Asset Picker toggle -->
		<div class="relative">
			<button
				class="p-1.5"
				title="Create asset (pick from library)"
				on:click={() => (showAssetPicker = !showAssetPicker)}
			>
				<Plus strokeWidth={1.5} size={18} />
			</button>
			{#if showAssetPicker}
				<div
					class="absolute top-10 left-0 z-[10000] w-[260px] rounded-md border bg-white p-2 shadow-md"
				>
					<AssetSearch bind:selected={currentAsset} />
				</div>
			{/if}
		</div>

		<button
			class="p-1.5 disabled:opacity-40"
			on:click={undo}
			disabled={history.length === 0}
			title="Undo (Cmd/Ctrl+Z)"
		>
			<Undo2 strokeWidth={1.5} size={18} />
		</button>

		<!-- Save with live state next to it -->
		<div class="relative flex items-center">
			<button
				class="p-1.5 disabled:opacity-40"
				on:click={saveAllItems}
				disabled={saveState === 'saving'}
				title="Save all items (create/update)"
				aria-busy={saveState === 'saving'}
			>
				<Save strokeWidth={1.5} size={18} />
			</button>
			{#if saveState !== 'idle'}
				<span
					class={`ml-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
						saveState === 'saving'
							? 'border border-gray-400 bg-white text-gray-700'
							: saveState === 'success'
								? 'border border-green-600 bg-green-50 text-green-700'
								: 'border border-red-600 bg-red-50 text-red-700'
					}`}
				>
					{saveState === 'saving' ? 'Saving…' : saveToast}
				</span>
			{/if}
		</div>

		<!-- Global Final Keyframe mode toggle — HIDDEN for slider scenes -->
		{#if scene_type !== 'slider'}
			<button
				class={`rounded p-1.5 ${finalKeyframeMode ? 'bg-purple-50 ring-1 ring-purple-600' : ''}`}
				on:click={() => toggleFinalKeyframeMode()}
				title="Final Keyframe mode (edit final transform/opacity for ALL items)"
				aria-pressed={finalKeyframeMode}
				disabled={previewMode}
			>
				<DiamondPlus size={16} strokeWidth={1.5} />
			</button>
		{/if}

		{#if scene_type === 'slider'}
			<!-- SLIDER -->
			<button
				class={`rounded p-1.5 ${previewMode ? 'bg-black text-white' : ''}`}
				on:click={() => {
					previewMode = !previewMode;
					// Optional: reset the slider scrubber on exit
					// if (!previewMode) previewT = 0;
					measureSoon();
				}}
				title={previewMode ? 'Exit preview' : 'Enter preview'}
				aria-pressed={previewMode}
			>
				<Play size={16} strokeWidth={1.5} />
			</button>
		{:else if scene_type === 'tap'}
			<!-- TAP -->
			<button
				class={`rounded p-1.5 ${previewMode ? 'bg-black text-white' : ''}`}
				on:click={() => {
					if (previewMode) {
						// exiting
						clearRuntime();
						tapDialogMsg = null;
					}
					previewMode = !previewMode;
					measureSoon();
				}}
				title={previewMode ? 'Exit preview' : 'Enter preview'}
				aria-pressed={previewMode}
			>
				<Play size={16} strokeWidth={1.5} />
			</button>
			{#if previewMode}
				<button
					class="p-1.5"
					on:click={() => {
						clearRuntime();
					}}
					title="Reset to initial state"
				>
					<RotateCcw size={16} strokeWidth={1.5} />
				</button>
			{/if}
		{:else if scene_type === 'dragdrop'}
			<!-- DRAGDROP -->
			<button
				class={`rounded p-1.5 ${previewMode ? 'bg-black text-white' : ''}`}
				on:click={() => {
					if (!previewMode) {
						initDragPreview();
					} else {
						resetDragPreview();
					}
					previewMode = !previewMode;
					measureSoon();
				}}
				title={previewMode ? 'Exit preview' : 'Enter preview'}
				aria-pressed={previewMode}
			>
				<Play size={16} strokeWidth={1.5} />
			</button>
			{#if previewMode}
				<button
					class="p-1.5"
					on:click={() => {
						resetDragPreview();
						initDragPreview();
						measureSoon();
					}}
					title="Reset to initial state"
				>
					<RotateCcw size={16} strokeWidth={1.5} />
				</button>
			{/if}
		{/if}
	</div>
	{#if previewMode && scene_type === 'slider'}
		<!-- Preview slider replaces the icon strip -->
		<div
			class="overlay-strip pointer-events-auto absolute bottom-4 left-1/2 z-[9999] w-[min(560px,92%)] -translate-x-1/2 rounded border bg-white/80 p-2 shadow-lg"
		>
			<div class="grid gap-1">
				<div class="flex items-center justify-between font-mono text-[10px] text-gray-700">
					<span>Preview</span>
					<span>{previewT}%</span>
				</div>
				<input
					type="range"
					min="-100"
					max="100"
					step="1"
					class="w-full"
					bind:value={previewT}
					on:input={() => measureSoon()}
					title="Preview time [-100..100]"
				/>
				<div class="flex items-center justify-between font-mono text-[10px] text-gray-500">
					<span>-100 (edge)</span>
					<span>0 (mid)</span>
					<span>+100 (edge)</span>
				</div>
			</div>
		</div>
	{:else if previewMode && scene_type === 'tap'}
		<!-- TAP preview hint bar -->
		<div
			class="overlay-strip pointer-events-none absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 rounded border bg-white/80 px-2 py-1.5 shadow-lg"
		>
			<div class="font-mono text-[11px] text-gray-700">
				Tap a <span class="font-semibold">tappable</span> item.
			</div>
		</div>
	{:else if previewMode && scene_type === 'dragdrop'}
		<!-- DRAG preview hint bar -->
		<div
			class="overlay-strip pointer-events-none absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 rounded border bg-white/80 px-2 py-1.5 shadow-lg"
		>
			<div class="font-mono text-[11px] text-gray-700">
				Drag each <span class="font-semibold">draggable</span> onto its correct target.
			</div>
		</div>
	{:else}
		<!-- 🔹 OVERLAY STRIP: Bottom-center (Role menu + Order menu + FinalPos* + Target + Settings + Delete) -->
		<div
			class="overlay-strip pointer-events-auto absolute bottom-4 left-1/2 z-[9999] -translate-x-1/2 border bg-white/75 p-1 px-2 shadow-lg"
		>
			<div class="relative flex items-center gap-2">
				<!-- Role menu trigger -->
				<button
					class="p-1.5 disabled:opacity-40"
					bind:this={roleBtnEl}
					on:click={toggleRoleMenu}
					disabled={!selectedId}
					title="Set role"
					aria-haspopup="true"
					aria-expanded={showRoleMenu}
				>
					<WandSparkles size={16} strokeWidth={1.5} />
				</button>

				{#if showRoleMenu}
					<div
						class="absolute bottom-[42px] left-0 z-[10000] w-[200px] rounded-md border bg-white shadow-md"
						role="menu"
						aria-label="Select role"
						bind:this={roleMenuEl}
					>
						{#each roleOptions as r}
							<button
								class="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] hover:bg-gray-100"
								role="menuitemradio"
								aria-checked={(getSelected()?.role ?? 'none') === r}
								on:click={() => chooseRole(r)}
								disabled={!selectedId}
							>
								<span class="font-mono">{r}</span>
								{#if (getSelected()?.role ?? 'none') === r}<span class="text-[10px] text-gray-700"
										>✓</span
									>{/if}
							</button>
						{/each}
					</div>
				{/if}

				<!-- Z-order menu trigger -->
				<button
					class="p-1.5 disabled:opacity-40"
					bind:this={orderBtnEl}
					on:click={toggleOrderMenu}
					disabled={!selectedId}
					title="Z-order options"
					aria-haspopup="true"
					aria-expanded={showOrderMenu}
				>
					<ArrowDownUp size={16} strokeWidth={1.5} />
				</button>

				{#if showOrderMenu}
					<div
						class="absolute bottom-[42px] left-1/2 z-[10000] w-[200px] -translate-x-1/2 rounded-md border bg-white shadow-md"
						role="menu"
						aria-label="Reorder"
						bind:this={orderMenuEl}
					>
						<button
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-gray-100 disabled:text-gray-400"
							role="menuitem"
							on:click={() => actAndClose(bringToFront)}
							disabled={!selectedId}
							title="Bring to front"
						>
							<ChevronsUp size={16} strokeWidth={1.5} /><span class="font-mono">Bring to front</span
							>
						</button>
						<button
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-gray-100 disabled:text-gray-400"
							role="menuitem"
							on:click={() => actAndClose(bringForward)}
							disabled={!selectedId}
							title="Forward"
						>
							<ChevronUp size={16} strokeWidth={1.5} /><span class="font-mono">Forward</span>
						</button>
						<button
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-gray-100 disabled:text-gray-400"
							role="menuitem"
							on:click={() => actAndClose(sendBackward)}
							disabled={!selectedId}
							title="Backward"
						>
							<ChevronDown size={16} strokeWidth={1.5} /><span class="font-mono">Backward</span>
						</button>
						<button
							class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-gray-100 disabled:text-gray-400"
							role="menuitem"
							on:click={() => actAndClose(sendToBack)}
							disabled={!selectedId}
							title="Send to back"
						>
							<ChevronsDown size={16} strokeWidth={1.5} /><span class="font-mono">Send to back</span
							>
						</button>
					</div>
				{/if}

				<!-- Target menu trigger (draggable only) -->
				<button
					class="p-1.5 disabled:opacity-40"
					bind:this={targetBtnEl}
					on:click={toggleTargetMenu}
					disabled={!selectedId || getSelected()?.role !== 'draggable'}
					title="Set target (for draggable only)"
					aria-haspopup="true"
					aria-expanded={showTargetMenu}
				>
					<Crosshair size={16} strokeWidth={1.5} />
				</button>

				{#if showTargetMenu}
					<div
						class="absolute bottom-[42px] left-[60%] z-[10000] w-[240px] -translate-x-1/2 rounded-md border bg-white shadow-md"
						role="menu"
						aria-label="Select target"
						bind:this={targetMenuEl}
					>
						<button
							class="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] hover:bg-gray-100"
							role="menuitemradio"
							aria-checked={!getSelected()?.correct_target_id}
							on:click={() => chooseTarget(null)}
						>
							<span class="font-mono">None</span>
							{#if !getSelected()?.correct_target_id}<span class="text-[10px] text-gray-700">✓</span
								>{/if}
						</button>
						<hr class="my-1 border-gray-200" />
						{#if targetCandidates().length === 0}
							<div class="px-2 py-2 text-[12px] text-gray-500">
								No target items in scene. Set <span class="font-mono">role = target</span> on an item
								first.
							</div>
						{:else}
							{#each targetCandidates() as t}
								<button
									class="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] hover:bg-gray-100"
									role="menuitemradio"
									aria-checked={(getSelected()?.correct_target_id ?? null) === t.id}
									on:click={() => chooseTarget(t.id)}
								>
									<span class="truncate"
										><span class="font-mono text-[11px] text-gray-500">#{t.z_index}</span
										>&nbsp;{t.title?.trim() || t.id}</span
									>
									{#if (getSelected()?.correct_target_id ?? null) === t.id}<span
											class="text-[10px] text-gray-700">✓</span
										>{/if}
								</button>
							{/each}
						{/if}
					</div>
				{/if}

				<!-- Final Position mode toggle (draggable only) — HIDDEN for slider scenes -->
				{#if scene_type !== 'slider'}
					<button
						class={`rounded p-1.5 ${finalPosMode && canSetFinalForSelected() ? 'bg-purple-50 ring-1 ring-purple-600' : ''} disabled:opacity-40`}
						on:click={() => toggleFinalPosMode()}
						disabled={!selectedId || !canSetFinalForSelected()}
						title="Set final position (draggable only)"
						aria-pressed={finalPosMode && canSetFinalForSelected()}
					>
						<MapPinPlus size={16} strokeWidth={1.5} />
					</button>
				{/if}

				<!-- Settings (always visible): anim settings in FK mode (unless slider), tap settings (if applicable), slider constraints (if slider), base opacity -->
				<button
					class="rounded p-1.5 disabled:opacity-40"
					on:click={openAnimSettingsForSelected}
					disabled={!selectedId}
					title={scene_type !== 'slider' && finalKeyframeMode
						? 'Animation & opacity settings'
						: 'Item settings'}
				>
					<Settings2 size={16} strokeWidth={1.5} />
				</button>

				<!-- Delete -->
				<button
					class="p-1.5 text-red-600 disabled:opacity-40"
					on:click={() => deleteSelected(true)}
					disabled={!selectedId || deleting}
					title={deleting ? 'Deleting…' : 'Delete selected'}
				>
					<Trash2 strokeWidth={1.5} size={18} />
				</button>
			</div>
		</div>
	{/if}
	<!-- Save/Delete toast (global, non-blocking) -->
	{#if saveToast}
		<div
			class="pointer-events-none absolute top-4 right-4 z-[10000] rounded border bg-white/90 px-2 py-1 font-mono text-[11px] shadow"
			role="status"
			aria-live="polite"
		>
			{saveToast}
		</div>
	{/if}
</div>

<!-- Readout -->
<div class="mt-1 space-y-0.5 font-mono text-[11px] text-gray-700">
	<div>Scene type: {scene_type}</div>
	<div>Canvas: {canvasW} × {canvasH}px</div>
	{#if selectedId}
		{#key selectedId}
			<div>
				Selected: {selectedId}
				{#if getSelected()?.persisted}<span class="text-green-700">(persisted)</span>{:else}<span
						class="text-amber-700">(new)</span
					>{/if}
			</div>
			<div>
				Item size: {selW} × {selH}px &nbsp;|&nbsp; width =
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? (displayWidthPct(it) * 100).toFixed(1) : '—';
				})()}% &nbsp;|&nbsp; z-index =
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? it.z_index : '—';
				})()}
				&nbsp;|&nbsp; rot =
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? `${((displayRotRad(it) * 180) / Math.PI).toFixed(1)}°` : '—';
				})()}
				&nbsp;|&nbsp; opacity =
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? `${displayOpacityPct(it)}%` : '—';
				})()}
				&nbsp;|&nbsp; role =
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? it.role : '—';
				})()}
				{#if items.find((i) => i.id === selectedId)?.role === 'draggable'}
					&nbsp;|&nbsp; target =
					{(() => {
						const it = items.find((i) => i.id === selectedId);
						if (!it) return '—';
						if (!it.correct_target_id) return 'none';
						return getItemLabelById(it.correct_target_id);
					})()}
				{/if}
			</div>

			<div>Title: {(items.find((i) => i.id === selectedId)?.title ?? '') as string}</div>

			<!-- live center (displayed) -->
			<div>
				Center (displayed):
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it
						? `${Math.round(displayCxPct(it) * canvasW)}px, ${Math.round(displayCyPct(it) * canvasH)}px`
						: '—';
				})()}
				&nbsp;|&nbsp;
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it
						? `(${(displayCxPct(it) * 100).toFixed(2)}%, ${(displayCyPct(it) * 100).toFixed(2)}%)`
						: '—';
				})()}
			</div>

			<!-- final center (stored for draggable) -->
			<div>
				Final center (stored for draggable):
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it) return '—';
					if (it.final_cx_pct == null || it.final_cy_pct == null) return '—';
					return `${Math.round(it.final_cx_pct * canvasW)}px, ${Math.round(it.final_cy_pct * canvasH)}px`;
				})()}
				&nbsp;|&nbsp;
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it || it.final_cx_pct == null || it.final_cy_pct == null) return '—';
					return `(${(it.final_cx_pct * 100).toFixed(2)}%, ${(it.final_cy_pct * 100).toFixed(2)}%)`;
				})()}
				{#if finalPosMode && scene_type !== 'slider'}<span
						class="ml-2 rounded bg-purple-50 px-1 py-0.5 text-purple-700">Final mode</span
					>{/if}
			</div>

			<!-- keyframe values (anim) -->
			<div>
				Keyframe: move= {(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it) return '—';
					return `(${((it.anim_move_cx_pct ?? it.cx_pct) * 100).toFixed(1)}%, ${((it.anim_move_cy_pct ?? it.cy_pct) * 100).toFixed(1)}%)`;
				})()}
				&nbsp;|&nbsp; scaleW= {(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it) return '—';
					return `${((it.anim_scale_w_pct ?? it.w_pct) * 100).toFixed(1)}%`;
				})()}
				&nbsp;|&nbsp; rotateBy= {(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it) return '—';
					const by = it.anim_rotate_by ?? 0;
					return `${((by * 180) / Math.PI).toFixed(1)}°`;
				})()}
				&nbsp;|&nbsp; opacity= {(() => {
					const it = items.find((i) => i.id === selectedId);
					if (!it) return '—';
					const fk =
						it.anim_opacity ?? (isFinite(it.opacity as number) ? (it.opacity as number) : 100);
					return `${fk}%`;
				})()}
			</div>
		{/key}
	{:else}
		<div>No selection</div>
	{/if}
	{#if statusMsg}<div class="text-gray-600" aria-live="polite">{statusMsg}</div>{/if}
</div>

<!-- SETTINGS DIALOG -->
{#if showAnimDialog && selectedId}
	{#key selectedId}
		<div
			class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40"
			on:keydown={(e: KeyboardEvent) => {
				if (e.key === 'Escape') closeAnimDialog();
			}}
		>
			<div class="w-[360px] rounded-md border bg-white p-3 shadow-xl">
				<div class="mb-2 font-mono text-[12px] text-gray-800">Item Settings</div>

				{#if (() => !!getSelected())()}
					<form
						on:submit|preventDefault={(e: SubmitEvent) => {
							const form = e.currentTarget as HTMLFormElement;
							const fd = new FormData(form);
							saveSettingsFromForm(fd);
							closeAnimDialog();
						}}
					>
						<div class="grid gap-2">
							<!-- Title (always visible) -->
							<label class="grid gap-1">
								<span class="font-mono text-[11px] text-gray-600">Title</span>
								<input
									name="title"
									type="text"
									class="rounded border px-2 py-1 font-mono text-[12px]"
									value={getSelected()?.title ?? ''}
									placeholder="Title"
								/>
							</label>

							<!-- 🔹 Base Opacity (always visible) -->
							<label class="grid gap-1">
								<span class="font-mono text-[11px] text-gray-600">Opacity (%)</span>
								<input
									name="opacity"
									type="range"
									min="0"
									max="100"
									step="1"
									class="w-full"
									value={clampPercent(
										isFinite(getSelected()?.opacity as number)
											? (getSelected()?.opacity as number)
											: 100
									)}
								/>
								<div class="text-right font-mono text-[10px] text-gray-500">
									{clampPercent(
										isFinite(getSelected()?.opacity as number)
											? (getSelected()?.opacity as number)
											: 100
									)}%
								</div>
							</label>

							<!-- 🔹 Animation settings (FK mode AND not slider scene) -->
							{#if scene_type !== 'slider' && finalKeyframeMode}
								<hr class="my-2 border-gray-200" />
								<div class="font-mono text-[11px] text-gray-600">Animation (Final Keyframe)</div>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Type</span>
									<select name="anim_type" class="rounded border px-2 py-1 font-mono text-[12px]">
										{#each animTypes as t}
											<option value={t} selected={getSelected()?.anim_type === t}>{t}</option>
										{/each}
									</select>
								</label>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Duration (ms)</span>
									<input
										name="anim_duration_ms"
										type="number"
										step="50"
										min="0"
										class="rounded border px-2 py-1 font-mono text-[12px]"
										value={getSelected()?.anim_duration_ms ?? 700}
									/>
								</label>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Delay (ms)</span>
									<input
										name="anim_delay_ms"
										type="number"
										step="50"
										min="0"
										class="rounded border px-2 py-1 font-mono text-[12px]"
										value={getSelected()?.anim_delay_ms ?? 0}
									/>
								</label>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Easing</span>
									<select name="anim_easing" class="rounded border px-2 py-1 font-mono text-[12px]">
										<option
											value="linear"
											selected={(getSelected()?.anim_easing ?? 'easeInOut') === 'linear'}
											>linear</option
										>
										<option
											value="easeInOut"
											selected={(getSelected()?.anim_easing ?? 'easeInOut') === 'easeInOut'}
											>easeInOut</option
										>
									</select>
								</label>

								<!-- 🔹 Final opacity (FK) — UI percent; converted on save -->
								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Final opacity (%)</span>
									<input
										name="anim_opacity"
										type="range"
										min="0"
										max="100"
										step="1"
										class="w-full"
										value={clampPercent(
											isFinite(getSelected()?.anim_opacity as number)
												? (getSelected()?.anim_opacity as number)
												: isFinite(getSelected()?.opacity as number)
													? (getSelected()?.opacity as number)
													: 100
										)}
									/>
									<div class="text-right font-mono text-[10px] text-gray-500">
										{clampPercent(
											isFinite(getSelected()?.anim_opacity as number)
												? (getSelected()?.anim_opacity as number)
												: isFinite(getSelected()?.opacity as number)
													? (getSelected()?.opacity as number)
													: 100
										)}%
									</div>
								</label>
							{/if}

							<!-- 🔹 Tap settings (tap scene + tappable) — visible EVEN in FK mode -->
							{#if scene_type === 'tap' && getSelected()?.role === 'tappable'}
								<hr class="my-2 border-gray-200" />
								<div class="font-mono text-[11px] text-gray-600">Tap Settings</div>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Tap message</span>
									<input
										name="tap_message"
										type="text"
										class="rounded border px-2 py-1 font-mono text-[12px]"
										placeholder="Shown on tap"
										value={getSelected()?.tap_message ?? ''}
									/>
								</label>

								<label class="mt-1 inline-flex items-center gap-2">
									<input
										type="checkbox"
										name="is_scene_trigger"
										checked={!!getSelected()?.is_scene_trigger}
									/>
									<span class="font-mono text-[12px] text-gray-700">Mark as scene trigger</span>
								</label>
							{/if}

							<!-- 🔹 Slider constraints (ONLY for slider scenes) -->
							{#if scene_type === 'slider'}
								<hr class="my-2 border-gray-200" />
								<div class="font-mono text-[11px] text-gray-600">Slider Constraints</div>

								<label class="inline-flex items-center gap-2">
									<input
										type="checkbox"
										name="moveable"
										checked={getSelected()?.moveable ?? true}
									/>
									<span class="font-mono text-[12px] text-gray-700">Moveable</span>
								</label>

								<label class="inline-flex items-center gap-2">
									<input
										type="checkbox"
										name="resizeable"
										checked={getSelected()?.resizeable ?? true}
									/>
									<span class="font-mono text-[12px] text-gray-700">Resizeable</span>
								</label>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Move direction</span>
									<select name="move_dir" class="rounded border px-2 py-1 font-mono text-[12px]">
										<option value="" selected={!getSelected()?.move_dir}>— none —</option>
										{#each moveDirs as md}
											<option value={md} selected={getSelected()?.move_dir === md}>{md}</option>
										{/each}
									</select>
								</label>

								<label class="grid gap-1">
									<span class="font-mono text-[11px] text-gray-600">Scale factor</span>
									<input
										name="scale_factor"
										type="number"
										step="0.05"
										class="rounded border px-2 py-1 font-mono text-[12px]"
										placeholder="e.g., 1.2"
										value={getSelected()?.scale_factor ?? ''}
									/>
								</label>
							{/if}
						</div>

						<div class="mt-3 flex justify-end gap-2">
							<button
								type="button"
								class="rounded border px-2 py-1 font-mono text-[12px]"
								on:click={closeAnimDialog}>Cancel</button
							>
							<button
								type="submit"
								class="rounded border bg-black px-2 py-1 font-mono text-[12px] text-white"
								>Save</button
							>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{/key}
{/if}

<!-- MESSAGE FOR TAPPED ITEMS -->
{#if tapDialogMsg}
	<div class="fixed inset-0 z-[10002] flex items-center justify-center bg-black/40">
		<div class="w-[320px] rounded-md border bg-white p-3 shadow-xl">
			<div class="mb-1 font-mono text-[12px] text-gray-800">Message</div>
			<div class="text-[13px] whitespace-pre-wrap text-gray-900">{tapDialogMsg}</div>
			<div class="mt-3 flex justify-end gap-2">
				<button
					class="rounded border px-2 py-1 font-mono text-[12px]"
					on:click={() => (tapDialogMsg = null)}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.svg-holder > svg),
	:global(.svg-holder svg) {
		display: block;
		width: 100%;
		height: auto;
		pointer-events: auto;
	}
	:global(.svg-holder) {
		cursor: grab;
	}
	:global(.svg-holder:active) {
		cursor: grabbing;
	}
	:global(.svg-holder [title='Rotate']),
	:global(.svg-holder [title='Resize']) {
		touch-action: none;
	}
</style>
