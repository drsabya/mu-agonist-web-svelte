<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	/** Public API: background color */
	const { bg = '#ffffff' } = $props<{ bg?: string }>();

	/** Local size readout (kept from your original) */
	let w = $state(0),
		h = $state(0);
	let boxEl: HTMLDivElement;

	/* ===== Minimal item model for pasted content ===== */
	type ItemKind = 'svg' | 'image';
	type Item = { id: string; kind: ItemKind; svg?: string; src?: string };
	let items = $state<Item[]>([]);

	/* ===== Utils (lightly adapted from your Next.js reference) ===== */
	function uid() {
		return Math.random().toString(36).slice(2, 10);
	}
	function canonicalize(s: string) {
		return s.replace(/\s+/g, ' ').trim();
	}
	function stripXmlDoctype(s: string) {
		return s.replace(/<\?xml[^>]*\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '');
	}
	function namespaceSvgIds(svg: string, ns: string) {
		let out = stripXmlDoctype(svg);
		out = out.replace(/\bid="([\w:-]+)"/g, (_m, id) => `id="${id}_${ns}"`);
		out = out.replace(/\burl\(#([\w:-]+)\)/g, (_m, id) => `url(#${id}_${ns})`);
		out = out.replace(
			/\b(xlink:href|href)="#([\w:-]+)"/g,
			(_m, attr, id) => `${attr}="#${id}_${ns}"`
		);
		out = out.replace(/\baria-labelledby="([^"]+)"/g, (_m, ids) => {
			const replaced = ids
				.split(/\s+/)
				.map((id: string) => `${id}_${ns}`)
				.join(' ');
			return `aria-labelledby="${replaced}"`;
		});
		return out;
	}
	function extractFromSvgXml(xml: string): string[] {
		const cleaned = stripXmlDoctype(xml);
		const p = new DOMParser();
		const doc = p.parseFromString(cleaned, 'image/svg+xml');
		const svgs = Array.from(doc.querySelectorAll('svg')).map((n) => n.outerHTML);
		const seen = new Set<string>();
		const out: string[] = [];
		for (const s of svgs) {
			const c = canonicalize(s);
			if (!seen.has(c)) {
				seen.add(c);
				out.push(s);
			}
		}
		if (out.length === 0 && cleaned.toLowerCase().includes('<svg')) out.push(cleaned);
		return out;
	}
	function extractFromHtml(html: string): string[] {
		const p = new DOMParser();
		const doc = p.parseFromString(html, 'text/html');
		const svgs = Array.from(doc.querySelectorAll('svg')).map((n) => n.outerHTML);
		const seen = new Set<string>();
		const out: string[] = [];
		for (const s of svgs) {
			const c = canonicalize(s);
			if (!seen.has(c)) {
				seen.add(c);
				out.push(s);
			}
		}
		return out;
	}
	function extractFromPlain(text: string): string[] {
		const cleaned = stripXmlDoctype(text);
		const matches = cleaned.match(/<svg[\s\S]*?<\/svg>/gi) ?? [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const m of matches) {
			const c = canonicalize(m);
			if (!seen.has(c)) {
				seen.add(c);
				out.push(m);
			}
		}
		if (out.length === 0 && cleaned.toLowerCase().includes('<svg')) out.push(cleaned);
		return out;
	}
	function blobToDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const fr = new FileReader();
			fr.onload = () => resolve(String(fr.result));
			fr.onerror = reject;
			fr.readAsDataURL(blob);
		});
	}

	/* ===== Paste handlers ===== */
	async function addSvgItems(svgs: string[]) {
		if (!svgs.length) return;
		const nss = svgs.map((s) => namespaceSvgIds(s, uid()));
		const newItems: Item[] = nss.map((svg) => ({ id: uid(), kind: 'svg', svg }));
		items = [...items, ...newItems];
	}
	async function addImageItems(srcs: string[]) {
		if (!srcs.length) return;
		const newItems: Item[] = srcs.map((src) => ({ id: uid(), kind: 'image', src }));
		items = [...items, ...newItems];
	}

	async function applyPastedPayload(
		payload: string,
		flavor: 'image/svg+xml' | 'text/html' | 'text/plain'
	) {
		let svgs: string[] = [];
		if (flavor === 'image/svg+xml') svgs = extractFromSvgXml(payload);
		else if (flavor === 'text/html') svgs = extractFromHtml(payload);
		else svgs = extractFromPlain(payload);
		if (svgs.length) await addSvgItems(svgs);
	}

	async function handlePasteEvent(e: ClipboardEvent) {
		if (!e.clipboardData) return;

		// Don’t intercept when typing in inputs/contenteditable
		const ae = document.activeElement as HTMLElement | null;
		if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

		// Image blobs first
		const itemsArr = Array.from(e.clipboardData.items || []);
		const imageMimes = ['image/png', 'image/jpeg', 'image/webp'];
		const imageSrcs: string[] = [];
		for (const it of itemsArr) {
			if (imageMimes.includes(it.type)) {
				const f = it.getAsFile();
				if (f) imageSrcs.push(await blobToDataUrl(f));
			}
		}
		if (imageSrcs.length) {
			await addImageItems(imageSrcs);
			e.preventDefault();
			return;
		}

		// Text payloads (svg/html/plain)
		const readItemsByType = async (mime: string): Promise<string | null> => {
			for (const it of itemsArr) {
				if (it.type === mime) {
					const f = it.getAsFile();
					if (f) return await f.text();
				}
			}
			return null;
		};

		let flavor: 'image/svg+xml' | 'text/html' | 'text/plain' | null = null;
		let payload: string | null = null;

		payload = await readItemsByType('image/svg+xml');
		if (payload) {
			flavor = 'image/svg+xml';
		} else {
			payload = (await readItemsByType('text/html')) ?? e.clipboardData.getData('text/html');
			if (payload) flavor = 'text/html';
			else {
				payload = (await readItemsByType('text/plain')) ?? e.clipboardData.getData('text/plain');
				if (payload) flavor = 'text/plain';
			}
		}

		if (payload && flavor) {
			await applyPastedPayload(payload, flavor);
			e.preventDefault();
		}
	}

	/** Mobile-friendly explicit paste button */
	async function pasteFromClipboardButton() {
		try {
			const nav = navigator as Navigator & {
				clipboard?: { read?: () => Promise<ClipboardItem[]>; readText?: () => Promise<string> };
			};
			if (nav.clipboard?.read) {
				const itemsC = await nav.clipboard.read();

				// Try image blobs
				const imageSrcs: string[] = [];
				for (const ci of itemsC) {
					const mime = ci.types.find((t) => ['image/png', 'image/jpeg', 'image/webp'].includes(t));
					if (mime) {
						const blob = await ci.getType(mime);
						imageSrcs.push(await blobToDataUrl(blob));
					}
				}
				if (imageSrcs.length) {
					await addImageItems(imageSrcs);
					return;
				}

				// Try SVG
				for (const ci of itemsC) {
					if (ci.types?.includes('image/svg+xml')) {
						const blob = await ci.getType('image/svg+xml');
						const payload = await blob.text();
						await applyPastedPayload(payload, 'image/svg+xml');
						return;
					}
				}
				// Try HTML
				for (const ci of itemsC) {
					if (ci.types?.includes('text/html')) {
						const blob = await ci.getType('text/html');
						const payload = await blob.text();
						await applyPastedPayload(payload, 'text/html');
						return;
					}
				}
				// Fallback: plain text
				for (const ci of itemsC) {
					if (ci.types?.includes('text/plain')) {
						const blob = await ci.getType('text/plain');
						const payload = await blob.text();
						await applyPastedPayload(payload, 'text/plain');
						return;
					}
				}
			}
			if (navigator.clipboard && 'readText' in navigator.clipboard) {
				const text = await navigator.clipboard.readText();
				if (text) {
					await applyPastedPayload(text, 'text/plain');
					return;
				}
			}
			alert('Clipboard read not available. Try copy again, then press Cmd/Ctrl+V.');
		} catch (err) {
			console.error(err);
			alert('Could not access clipboard (permissions?).');
		}
	}

	/* ===== Size tracking (your original logic kept) ===== */
	onMount(() => {
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const b = Array.isArray(entry.borderBoxSize)
					? entry.borderBoxSize[0]
					: (entry as any).borderBoxSize;
				if (b?.inlineSize && b?.blockSize) {
					w = Math.round(b.inlineSize);
					h = Math.round(b.blockSize);
				} else {
					w = Math.round(entry.contentRect.width);
					h = Math.round(entry.contentRect.height);
				}
			}
		});
		ro.observe(boxEl, { box: 'border-box' as any });

		window.addEventListener('paste', handlePasteEvent);
		onDestroy(() => {
			ro.disconnect();
			window.removeEventListener('paste', handlePasteEvent);
		});
	});
</script>

<div class="flex w-full flex-col items-center">
	<!-- Aspect box: ratio is exact; height derives from width -->
	<div bind:this={boxEl} class="relative m-4 aspect-[9/16] w-full max-w-[360px] min-w-[180px]">
		<!-- Visual layer -->
		<div class="absolute inset-0 border shadow-lg" style="background-color: {bg};">
			<!-- Toolbar (minimal) -->
			<div class="absolute top-1 left-1 z-20 flex items-center gap-2">
				<div
					class="pointer-events-none rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white/90"
				>
					{w} × {h}
				</div>
			</div>

			<button
				type="button"
				class="absolute right-1 bottom-1 z-20 rounded border border-gray-300 bg-white/90 p-1 text-gray-700 hover:bg-gray-100 active:bg-gray-200"
				title="Paste from clipboard (SVG / PNG / JPG / WebP)"
				onclick={pasteFromClipboardButton}
			>
				<!-- tiny paste icon -->
				<svg class="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true"
					><path
						d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 00-2 2v12a2 2 0 002 2h6v-2H5V5h2v2h10V5h2v5h2V5a2 2 0 00-2-2zM12 3a1 1 0 110 2 1 1 0 010-2zm5 10l-5 5-3-3-1.5 1.5 4.5 4.5 6.5-6.5L17 13z"
						fill="currentColor"
					/></svg
				>
			</button>

			<!-- Pasted content layer -->
			<div class="relative box-border h-full w-full overflow-hidden p-3">
				{#if items.length === 0}
					<div class="absolute inset-0 flex items-center justify-center">
						<div class="px-2 text-center text-xs leading-relaxed text-gray-500">
							Paste SVG or Image (PNG/JPG/WebP): use
							<span class="ml-1 rounded border border-gray-300 px-1">Cmd/Ctrl+V</span>
							or tap
							<span class="ml-1 rounded border border-gray-300 px-1">Paste</span>.
						</div>
					</div>
				{/if}

				{#each items as it (it.id)}
					<!-- Very simple layout: center each item at ~60% canvas width -->
					<div class="absolute top-1/2 left-1/2 w-[60%] -translate-x-1/2 -translate-y-1/2">
						{#if it.kind === 'svg'}
							<div class="w-full">{@html it.svg || ''}</div>
						{:else}
							<img src={it.src} alt="" class="block h-auto w-full select-none" draggable="false" />
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
