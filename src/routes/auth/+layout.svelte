<script lang="ts">
	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col bg-white font-mono text-black">
	<!-- Page content -->
	<main class="flex-1">
		{@render children?.()}
	</main>

	<!-- Footer with centered Home link -->
	<footer class="border-t border-black/10">
		<div class="mx-auto flex max-w-4xl items-center justify-center p-6">
			<a
				href="/"
				class="rounded px-1 text-sm underline decoration-black/40 underline-offset-4 hover:decoration-black focus:ring-2 focus:ring-black/30 focus:outline-none"
				aria-label="Go to Home"
			>
				Home
			</a>
		</div>
	</footer>
</div>
