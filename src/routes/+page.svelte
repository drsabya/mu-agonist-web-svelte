<script lang="ts">
	import { page } from '$app/state';

	// We use `$derived` to create reactive values directly from the `$page` store.
	// The auto-subscription `$` prefix for stores works inside runes to get the current value reactively.
	const session = $derived(page.data.session);
	const role = $derived(page.data.role);
	const user = $derived(session?.user);
</script>

<main class="flex flex-col items-center justify-center gap-8 bg-white p-12 font-mono text-gray-900">
	<div class="px-6 text-center">
		{#if user}
			<h1 class="mb-2 text-2xl font-bold tracking-tight">
				Hi, {user.user_metadata?.full_name ?? user.email} 👋!
			</h1>

			{#if role === 'admin'}
				<p class="text-gray-600">
					Go to
					<a
						href="/cms/scenes"
						class="border-b border-gray-900 transition-colors hover:border-black hover:text-black"
					>
						Scenes list
					</a>
				</p>
			{/if}
		{:else}
			<h1 class="mb-4 text-2xl font-bold tracking-tight">Welcome</h1>
			<p class="mb-6 text-gray-600">You are not signed in.</p>

			<a
				href="/auth?next=/"
				class="rounded border border-gray-900 px-4 py-2 font-semibold text-gray-900 transition-colors hover:bg-gray-900 hover:text-white"
			>
				Sign in
			</a>
		{/if}
	</div>
</main>
