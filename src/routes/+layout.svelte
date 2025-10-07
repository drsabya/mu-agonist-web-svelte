<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data, children } = $props();
	let { session, supabase } = $derived(data);

	onMount(() => {
		const { data: authSub } = supabase.auth.onAuthStateChange((_, newSession) => {
			if (newSession?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});
		return () => authSub.subscription.unsubscribe();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex min-h-screen flex-col bg-white font-mono text-black">
	<div class="flex-1">
		{@render children?.()}
	</div>

	{#if session}
		<footer class="border-t border-black/10">
			<div class="mx-auto flex max-w-4xl items-center justify-center p-6">
				<form method="POST" action="/auth/logout">
					<button
						class="px-4 py-2 text-sm tracking-tight underline
							   transition hover:bg-black
							   hover:text-white focus:ring-2 focus:ring-black/30 focus:outline-none disabled:opacity-60"
						aria-label="Sign out"
					>
						Sign out
					</button>
				</form>
			</div>
		</footer>
	{/if}
</div>
