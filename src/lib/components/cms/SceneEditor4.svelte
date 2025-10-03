<script lang="ts">
	// SceneEditor.svelte — paste, select, drag, resize, rotate, deselect, reorder, delete, undo,
	// role menu, target menu, save; FINAL POSITION mode (draggable only) + GLOBAL FINAL KEYFRAME mode (all items)
	import { onMount, onDestroy, tick } from 'svelte';
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
		Settings2
	} from '@lucide/svelte';

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

		// 🔹 Base opacity stored in UI as 0–100 (percent). We convert to 0–1 before API.
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

		// 🔹 FK opacity stored in UI as 0–100 (percent). We convert to 0–1 and send as anim_opacity_to.
		anim_opacity?: number | null;

		is_scene_trigger?: boolean | null;

		// 🔹 Slider scene controls
		moveable?: boolean | null;
		resizeable?: boolean | null;
		move_dir?: string | null;
		scale_factor?: number | null;

		title?: string | null;
	};

	/* ---------- state ---------- */
	let items = $state<SceneItem[]>([]);
	let currentAsset: { id: string; title: string; url: string } | null = $state(null);
	let selectedId: string | null = $state(null);
	let statusMsg = $state('');
	let lastCreatedId: string | null = null;

	// asset picker popover
	let showAssetPicker = $state(false);

	/* ---------- canvas metrics ---------- */
	let canvasEl: HTMLDivElement | null = null;
	let canvasW = $state(0);
	let canvasH = $state(0);
	let roCanvas: ResizeObserver | null = null;

	/* holder refs */
	const holderMap: Record<string, HTMLDivElement | null> = $state({});

	/* live size of selected item (for readout only) */
	let selW = $state(0);
	let selH = $state(0);
	let roSel: ResizeObserver | null = null;

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
		finalKeyframeMode = typeof force === 'boolean' ? force : !finalKeyframeMode;
		if (finalKeyframeMode) {
			ensureAnimDefaultsForAll();
			statusMsg =
				'Final Keyframe mode ON — drag/resize/rotate to set final values. Use ⚙️ to edit timing/easing/opacity.';
		} else {
			statusMsg = 'Final Keyframe mode OFF.';
		}
		measureSoon();
	}

	// If scene_type becomes 'slider', hard-disable FK & FinalPos modes
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

	/* ---------- builders ---------- */
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
			title: ''
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
			title: a.title ?? ''
		};
		pushHistory('add');
		items = [...items, it];
		selectedId = it.id;
		statusMsg = 'Asset added to canvas.';
		measureSoon();
	}
	$effect(() => {
		if (currentAsset) {
			addItemFromAsset(currentAsset);
			currentAsset = null;
			showAssetPicker = false;
		}
	});

	/* ---------- measures ---------- */
	async function measureSoon() {
		await tick();
		updateCanvasDims();
		updateSelectedDims();
	}
	function updateCanvasDims() {
		if (!canvasEl) return;
		const r = canvasEl.getBoundingClientRect();
		canvasW = Math.round(r.width);
		canvasH = Math.round(r.height);
	}
	function updateSelectedDims() {
		if (!selectedId) {
			selW = 0;
			selH = 0;
			return;
		}
		const el = holderMap[selectedId];
		if (!el) return;
		const svg = el.querySelector('svg') as SVGSVGElement | null;
		const target = svg ?? el;
		const r = target.getBoundingClientRect();
		selW = Math.round(r.width);
		selH = Math.round(r.height);
	}

	/* ---------- global events ---------- */
	function globalPasteHandler(e: ClipboardEvent) {
		const dt = e.clipboardData;
		const text = (dt?.getData('text/plain') || dt?.getData('text/html') || '').trim();
		if (text && /<svg[\s\S]*?<\/svg>/i.test(text)) {
			e.preventDefault();
			addItemFromText(text);
		}
	}
	function globalKeyHandler(e: KeyboardEvent) {
		// Undo
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo();
			return;
		}
		// Delete
		if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			deleteSelected(false);
			return;
		}
		// Exit Final position mode
		if (finalPosMode && e.key === 'Escape') {
			e.preventDefault();
			toggleFinalPosMode(false);
			return;
		}
	}

	onMount(() => {
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
		window.removeEventListener('paste', globalPasteHandler, true);
		window.removeEventListener('pointermove', onGlobalPointerMove);
		window.removeEventListener('pointerup', onGlobalPointerUp);
		window.removeEventListener('keydown', globalKeyHandler, true);
	});

	// Reactively observe the selected element's size
	$effect(() => {
		roSel?.disconnect?.();
		if (!selectedId) return;
		const el = holderMap[selectedId];
		if (!el) return;
		roSel = new ResizeObserver(updateSelectedDims);
		roSel.observe(el);
		updateSelectedDims();
	});

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

	function selectItem(id: string) {
		selectedId = id;
		measureSoon();
	}
	function onCanvasPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		if (target.closest('.overlay-strip')) return; // ignore overlay clicks
		if (!target.closest('.svg-holder')) {
			selectedId = null;
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
		if (finalKeyframeMode) return it.anim_move_cx_pct ?? it.cx_pct;
		if (finalPosMode && selectedId === it.id && it.role === 'draggable')
			return it.final_cx_pct ?? it.cx_pct;
		return it.cx_pct;
	}
	function displayCyPct(it: SceneItem): number {
		if (finalKeyframeMode) return it.anim_move_cy_pct ?? it.cy_pct;
		if (finalPosMode && selectedId === it.id && it.role === 'draggable')
			return it.final_cy_pct ?? it.cy_pct;
		return it.cy_pct;
	}
	function displayWidthPct(it: SceneItem): number {
		if (finalKeyframeMode) return it.anim_scale_w_pct ?? it.w_pct;
		return it.w_pct;
	}
	function displayRotRad(it: SceneItem): number {
		if (finalKeyframeMode) return normAngle((it.rot ?? 0) + (it.anim_rotate_by ?? 0));
		return it.rot ?? 0;
	}
	// 🔹 Opacity for rendering is in percent in UI; convert to 0..1 here.
	function displayOpacityPct(it: SceneItem): number {
		if (finalKeyframeMode)
			return clampPercent(
				it.anim_opacity ?? (isFinite(it.opacity as number) ? (it.opacity as number) : 100)
			);
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

	/* ---------- pointer interactions (drag/resize/rotate) ---------- */
	function onPointerDownItem(e: PointerEvent, id: string) {
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

	/* ---------- editing helpers ---------- */
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

	/* ---------- DELETE ITEM ---------- */
	function deleteSelected(confirmPrompt = true) {
		if (!selectedId) return;
		const it = items.find((i) => i.id === selectedId);
		if (!it) return;
		if (confirmPrompt) {
			const ok = window.confirm(`Delete "${it.title || it.id}" from canvas?`);
			if (!ok) return;
		}
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
		measureSoon();
	}

	/* ---------- SAVE ---------- */
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

			const body: Record<string, any> = {
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

				// ✅ Match backend contract:
				anim_opacity_to: fkOpacity01, // fraction or null
				is_scene_trigger: it.is_scene_trigger ?? false,
				moveable: it.moveable ?? true,
				resizeable: it.resizeable ?? true,
				move_dir: it.move_dir ?? null,
				scale_factor: it.scale_factor ?? null,

				// ✅ Base opacity as fraction (0..1)
				opacity: baseOpacity01,

				title: typeof it.title === 'string' ? it.title : null
			};

			const saveRes = await fetch('/api/scene-items', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const saveData = await saveRes.json();
			if (!saveRes.ok || !saveData?.ok)
				throw new Error(saveData?.error || `Scene item save failed (HTTP ${saveRes.status})`);
			lastCreatedId = saveData.id ?? null;
			statusMsg += `Saved scene item. Scene item id: ${lastCreatedId ?? '(unknown)'}`;
		} catch (err: any) {
			statusMsg = `Failed: ${err?.message || err}`;
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
		finalPosMode = typeof force === 'boolean' ? force : !finalPosMode;
		if (finalPosMode) {
			const it = getSelected()!;
			if (it.final_cx_pct == null) it.final_cx_pct = it.cx_pct;
			if (it.final_cy_pct == null) it.final_cy_pct = it.cy_pct;
			statusMsg = 'Final Position mode ON — drag to set final center (Esc to exit).';
		} else {
			statusMsg = 'Final Position mode OFF.';
		}
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

	function saveSettingsFromForm(fd: FormData) {
		if (!selectedId) return;

		const sel = getSelected();
		if (!sel) return;

		const title = (fd.get('title') as string) ?? '';

		// Build a single update object; push one history entry
		const update: Partial<SceneItem> = { title };

		// 🔹 Base Opacity (ALWAYS available) — UI percent
		const baseOpacityStr = fd.get('opacity');
		const baseOpacity =
			baseOpacityStr !== null && `${baseOpacityStr}` !== ''
				? clampPercent(Number(baseOpacityStr))
				: 100;
		Object.assign(update, { opacity: baseOpacity });

		// 🔹 Animation settings (ONLY when not a slider scene and FK mode is on) — includes FK opacity in UI percent
		if (scene_type !== 'slider' && finalKeyframeMode) {
			const anim_type = (fd.get('anim_type') as AnimType) || 'none';
			const durationStr = fd.get('anim_duration_ms');
			const delayStr = fd.get('anim_delay_ms');
			const anim_duration_ms =
				durationStr !== null && `${durationStr}` !== '' ? Number(durationStr) : null;
			const anim_delay_ms = delayStr !== null && `${delayStr}` !== '' ? Number(delayStr) : null;
			const anim_easing = (fd.get('anim_easing') as EasingKind) || null;

			const animOpacityStr = fd.get('anim_opacity');
			const anim_opacity =
				animOpacityStr !== null && `${animOpacityStr}` !== ''
					? clampPercent(Number(animOpacityStr))
					: null;

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
			const scale_factor_str = fd.get('scale_factor');
			const scale_factor =
				scale_factor_str !== null && `${scale_factor_str}` !== '' ? Number(scale_factor_str) : null;

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
</script>

<!-- Canvas -->
<div
	class="relative aspect-[9/16] w-full max-w-[360px] overflow-hidden border bg-white"
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

		<button
			class="p-1.5 disabled:opacity-40"
			on:click={saveItem}
			disabled={!selectedId}
			title="Save selected item"
		>
			<Save strokeWidth={1.5} size={18} />
		</button>

		<!-- Global Final Keyframe mode toggle — HIDDEN for slider scenes -->
		{#if scene_type !== 'slider'}
			<button
				class={`rounded p-1.5 ${finalKeyframeMode ? 'bg-purple-50 ring-1 ring-purple-600' : ''}`}
				on:click={() => toggleFinalKeyframeMode()}
				title="Final Keyframe mode (edit final transform/opacity for ALL items)"
				aria-pressed={finalKeyframeMode}
			>
				<DiamondPlus size={16} strokeWidth={1.5} />
			</button>
		{/if}
	</div>

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
						<ChevronsUp size={16} strokeWidth={1.5} /><span class="font-mono">Bring to front</span>
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
						<ChevronsDown size={16} strokeWidth={1.5} /><span class="font-mono">Send to back</span>
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
							No target items in scene. Set <span class="font-mono">role = target</span> on an item first.
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
				disabled={!selectedId}
				title="Delete selected"
			>
				<Trash2 strokeWidth={1.5} size={18} />
			</button>
		</div>
	</div>
</div>

<!-- Readout -->
<div class="mt-1 space-y-0.5 font-mono text-[11px] text-gray-700">
	<div>Scene type: {scene_type}</div>
	<div>Canvas: {canvasW} × {canvasH}px</div>
	{#if selectedId}
		{#key selectedId}
			<div>Selected: {selectedId}</div>
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
	{#if statusMsg}<div class="text-gray-600">{statusMsg}</div>{/if}
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
