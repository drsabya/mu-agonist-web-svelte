<script lang="ts">
	// SceneEditor.svelte — paste, select, drag, resize, rotate, deselect, reorder, delete, undo, set role + role badge
	import { onMount, onDestroy, tick } from 'svelte';
	import { PUBLIC_BUNNY_PUBLIC_HOST } from '$env/static/public';
	import AssetSearch from './AssetSearch.svelte';
	import {
		ClipboardPaste,
		Undo2,
		Save,
		Plus,
		SendToBack,
		ArrowDownToLine,
		ArrowUpToLine,
		BringToFront,
		Trash2
	} from '@lucide/svelte';

	let { id } = $props(); // scene_id (uuid from parent)

	type Kind = 'svg' | 'image';
	type Role = 'none' | 'draggable' | 'target' | 'tappable';
	type AnimType = 'none' | 'move' | 'scale' | 'rotate' | 'opacity' | 'jitter' | 'pulse';
	type EasingKind = 'linear' | 'easeInOut';

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
		anim_opacity_to?: number | null;
		is_scene_trigger?: boolean | null;
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
	let showAssetSearch = $state(false);

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

	/* drag state */
	let dragging = false;
	let dragStartCanvasX = 0;
	let dragStartCanvasY = 0;
	let startCxPct = 0;
	let startCyPct = 0;

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
			anim_opacity_to: null,
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
			anim_opacity_to: null,
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
			showAssetSearch = false; // Close modal on selection
		}
	});

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
	function globalPasteHandler(e: ClipboardEvent) {
		const dt = e.clipboardData;
		const text = (dt?.getData('text/plain') || dt?.getData('text/html') || '').trim();
		if (text && /<svg[\s\S]*?<\/svg>/i.test(text)) {
			e.preventDefault();
			addItemFromText(text);
		}
	}
	function globalKeyHandler(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo();
			return;
		}
		if (selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			deleteSelected(false);
		}
	}

	onMount(() => {
		if (canvasEl) {
			roCanvas = new ResizeObserver(updateCanvasDims);
			roCanvas.observe(canvasEl);
			updateCanvasDims();
		}
		const observeSel = () => {
			roSel?.disconnect?.();
			if (!selectedId) return;
			const el = holderMap[selectedId];
			if (!el) return;
			roSel = new ResizeObserver(updateSelectedDims);
			roSel.observe(el);
		};
		observeSel();
		$: {
			selectedId;
			observeSel();
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
		if (!target.closest('.svg-holder') && !target.closest('.canvas-toolbar')) {
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
		return { x: it.cx_pct * canvasW, y: it.cy_pct * canvasH };
	}

	/* ---------- drag / resize / rotate ---------- */
	function onPointerDownItem(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		pushHistory('drag');
		selectItem(id);
		const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
		dragging = true;
		dragStartCanvasX = x;
		dragStartCanvasY = y;
		const it = items.find((i) => i.id === id)!;
		startCxPct = it.cx_pct;
		startCyPct = it.cy_pct;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}
	function onGlobalPointerMove(e: PointerEvent) {
		if (dragging && selectedId) {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const dx = x - dragStartCanvasX,
				dy = y - dragStartCanvasY;
			const dCxPct = canvasW > 0 ? dx / canvasW : 0;
			const dCyPct = canvasH > 0 ? dy / canvasH : 0;
			items = items.map((it) =>
				it.id === selectedId
					? { ...it, cx_pct: startCxPct + dCxPct, cy_pct: startCyPct + dCyPct }
					: it
			);
			updateSelectedDims();
		}
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
			items = items.map((it) => (it.id === selectedId ? { ...it, w_pct: next } : it));
			updateSelectedDims();
		}
		if (rotating && selectedId) {
			const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
			const ang = Math.atan2(y - rotateCenterY, x - rotateCenterX);
			const delta = normAngle(ang - rotateStartAngle);
			items = items.map((it) =>
				it.id === selectedId ? { ...it, rot: normAngle(rotateInitial + delta) } : it
			);
		}
	}
	function onGlobalPointerUp(e: PointerEvent) {
		if (dragging && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		dragging = false;
		if (resizing && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		resizing = false;
		if (rotating && selectedId) holderMap[selectedId!]?.releasePointerCapture?.(e.pointerId);
		rotating = false;
	}
	function onPointerDownResize(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		pushHistory('resize');
		selectItem(id);
		const { x, y } = clientToCanvasXY(e.clientX, e.clientY);
		resizing = true;
		resizeStartCanvasX = x;
		resizeStartCanvasY = y;
		const it = items.find((i) => i.id === id)!;
		resizeStartWPct = it.w_pct;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}
	function onPointerDownRotate(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		pushHistory('rotate');
		selectItem(id);
		const it = items.find((i) => i.id === id)!;
		const { x: cx, y: cy } = centerPxOf(it);
		rotateCenterX = cx;
		rotateCenterY = cy;
		const p = clientToCanvasXY(e.clientX, e.clientY);
		rotateStartAngle = Math.atan2(p.y - rotateCenterY, p.x - rotateCenterX);
		rotateInitial = it.rot || 0;
		rotating = true;
		holderMap[id]?.setPointerCapture?.(e.pointerId);
		e.stopPropagation();
		e.preventDefault();
	}

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
		const remaining = items.filter((i) => i.id !== selectedId);
		const arr = [...remaining].sort(byZ);
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
				anim_opacity_to: it.anim_opacity_to ?? null,
				is_scene_trigger: it.is_scene_trigger ?? false,
				moveable: it.moveable ?? true,
				resizeable: it.resizeable ?? true,
				move_dir: it.move_dir ?? null,
				scale_factor: it.scale_factor ?? null
			};
			if (typeof it.title === 'string') body.title = it.title;
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
		// Subtle distinct colors; border for visibility on any bg
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
</script>

<div class="mb-2 h-5 text-xs text-gray-600">{statusMsg}</div>

<br />

<div
	class="relative aspect-[9/16] w-full max-w-[360px] overflow-hidden border bg-white"
	bind:this={canvasEl}
	on:pointerdown={onCanvasPointerDown}
>
	<div
		class="canvas-toolbar absolute top-4 left-4 z-50 flex items-center gap-2 rounded-md border bg-white p-1 shadow-lg"
	>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={handlePasteButton}
			title="Paste SVG from clipboard (Cmd/Ctrl+V)"
		>
			<ClipboardPaste strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={() => (showAssetSearch = true)}
			title="Add asset from library"
		>
			<Plus strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={undo}
			disabled={history.length === 0}
			title="Undo (Cmd/Ctrl+Z)"
		>
			<Undo2 strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-black text-white hover:bg-gray-800 disabled:opacity-40"
			on:click={saveItem}
			disabled={!selectedId}
			title="Save selected item"
		>
			<Save strokeWidth={1.5} class="h-4 w-4" />
		</button>
	</div>

	<div
		class="canvas-toolbar absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-white p-1 shadow-lg"
	>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={sendToBack}
			disabled={!selectedId}
			title="Send to Back"
		>
			<SendToBack strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={sendBackward}
			disabled={!selectedId}
			title="Send Backward"
		>
			<ArrowDownToLine strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={bringForward}
			disabled={!selectedId}
			title="Bring Forward"
		>
			<ArrowUpToLine strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white hover:bg-gray-100 disabled:opacity-40"
			on:click={bringToFront}
			disabled={!selectedId}
			title="Bring to Front"
		>
			<BringToFront strokeWidth={1.5} class="h-4 w-4" />
		</button>
		<div class="mx-1 h-5 w-[1px] bg-gray-200"></div>
		<button
			class="flex h-7 w-7 items-center justify-center rounded border bg-white text-red-600 hover:bg-red-50 disabled:text-red-600/40 disabled:opacity-100"
			on:click={() => deleteSelected(true)}
			disabled={!selectedId}
			title="Delete"
		>
			<Trash2 strokeWidth={1.5} class="h-4 w-4" />
		</button>
	</div>

	{#if items.length === 0}
		<div
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-xs leading-snug text-gray-400"
		>
			Press <kbd class="rounded border px-1">Ctrl</kbd>+<kbd class="rounded border px-1">V</kbd> (or
			Cmd+V) to paste SVGs, or pick an asset above.
		</div>
	{/if}

	{#each items as it (it.id)}
		<div
			class="svg-holder absolute -translate-x-1/2 -translate-y-1/2 touch-none"
			bind:this={holderMap[it.id]}
			on:pointerdown={(e) => onPointerDownItem(e, it.id)}
			style="
				left: {it.cx_pct * 100}%;
				top: {it.cy_pct * 100}%;
				width: {it.w_pct * 100}%;
				z-index: {it.z_index};
				outline: {selectedId === it.id ? '1px dashed #000' : 'none'};
			"
		>
			{#if it.role !== 'none'}
				<div
					class="pointer-events-none absolute top-0 left-0 z-20 translate-x-[-4px] translate-y-[-4px]"
					aria-label={`role: ${it.role}`}
				>
					<span
						class={`inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none shadow-sm ${roleBadgeClass(
							it.role
						)}`}
					>
						{roleBadgeText(it.role)}
					</span>
				</div>
			{/if}

			<div
				class="relative z-10 w-full"
				style="transform: rotate({it.rot}rad); transform-origin: 50% 50%;"
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
				<div
					class="absolute right-0 bottom-0 z-20 h-6 w-6 rounded-md border border-black bg-white"
					style="transform: translate(50%, 50%); touch-action:none"
					on:pointerdown={(e) => onPointerDownResize(e, it.id)}
					title="Resize"
				>
					<div class="pointer-events-none absolute top-0 left-0 h-full w-full">
						<svg viewBox="0 0 10 10" class="block h-full w-full">
							<path d="M2 8 L8 2" stroke="black" stroke-width="1" fill="none" />
						</svg>
					</div>
				</div>
			{/if}
		</div>
	{/each}
</div>

{#if showAssetSearch}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
		on:click={() => (showAssetSearch = false)}
	>
		<div class="w-full max-w-md rounded-lg bg-white p-4 shadow-2xl" on:click|stopPropagation>
			<h3 class="mb-3 text-sm font-semibold">Select an asset</h3>
			<AssetSearch bind:selected={currentAsset} />
		</div>
	</div>
{/if}

{#if selectedId}
	{#key selectedId}
		<div class="mt-2 grid w-full max-w-[360px] grid-cols-1 gap-2">
			<input
				class="w-full rounded-md border px-2 py-1 font-mono text-[12px] text-black placeholder-gray-400 focus:outline-none"
				type="text"
				placeholder="Title"
				value={(items.find((i) => i.id === selectedId)?.title ?? '') as string}
				on:input={(e: Event) => setSelectedTitle((e.target as HTMLInputElement).value)}
			/>
			<div class="flex items-center gap-2">
				<label class="font-mono text-[11px] text-gray-700" for="roleSelect">Role</label>
				<select
					id="roleSelect"
					class="rounded-md border px-2 py-1 font-mono text-[12px] text-black"
					on:change={(e: Event) => setSelectedRole((e.target as HTMLSelectElement).value as Role)}
					{...{
						value: (items.find((i) => i.id === selectedId)?.role ?? 'none') as Role
					}}
				>
					<option value="none">none</option>
					<option value="draggable">draggable</option>
					<option value="target">target</option>
					<option value="tappable">tappable</option>
				</select>
			</div>
		</div>
	{/key}
{:else}
	<div class="mt-2 h-0"></div>
{/if}

<div class="mt-1 space-y-0.5 font-mono text-[11px] text-gray-700">
	<div>Canvas: {canvasW} × {canvasH}px</div>
	{#if selectedId}
		{#key selectedId}
			<div>Selected: {selectedId}</div>
			<div>
				Item size: {selW} × {selH}px &nbsp;|&nbsp; width = {(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? (it.w_pct * 100).toFixed(1) : '—';
				})()}% &nbsp;|&nbsp; z-index = {(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? it.z_index : '—';
				})()} &nbsp;|&nbsp; rot = {(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? `${((it.rot * 180) / Math.PI).toFixed(1)}°` : '—';
				})()} &nbsp;|&nbsp; role = {(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? it.role : '—';
				})()}
			</div>
			<div>Title: {(items.find((i) => i.id === selectedId)?.title ?? '') as string}</div>
			<div>
				Center:
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it
						? `${Math.round(it.cx_pct * canvasW)}px, ${Math.round(it.cy_pct * canvasH)}px`
						: '—';
				})()}
				&nbsp;|&nbsp;
				{(() => {
					const it = items.find((i) => i.id === selectedId);
					return it ? `(${(it.cx_pct * 100).toFixed(2)}%, ${(it.cy_pct * 100).toFixed(2)}%)` : '—';
				})()}
			</div>
		{/key}
	{:else}
		<div>No selection</div>
	{/if}
</div>

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
