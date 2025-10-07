<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { tick } from 'svelte';

	let sending = false;
	$: message = $page.form?.message ?? null;
	$: error = $page.form?.error ?? null;

	const handleEnhance = async ({
		action,
		formData,
		formElement,
		controller,
		submitter,
		cancel
	}: {
		action: URL;
		formData: FormData;
		formElement: HTMLFormElement;
		controller: AbortController;
		submitter: HTMLElement | null;
		cancel: () => void;
	}) => {
		sending = true;
		message = 'Sending link...';
		error = null;

		// Let the default enhance behavior handle the submission
		// No need to call update, as enhance will handle it

		// Wait for the next tick after submission
		await tick();
		sending = false;

		// If successful, override message briefly
		if ($page.form?.message && !$page.form?.error) {
			message = 'Magic link sent! Check your email.';
			await tick();
		}
	};
</script>

<div class="mx-auto max-w-sm space-y-4 p-4">
	<h1 class="text-xl font-medium">Sign in</h1>

	<form method="POST" action="?/login" use:enhance={handleEnhance} class="space-y-3">
		<label class="block space-y-1">
			<span class="text-sm text-neutral-600">Email</span>
			<input
				class="w-full rounded border p-2"
				name="email"
				type="email"
				required
				autocomplete="email"
				placeholder="you@example.com"
			/>
		</label>

		<button
			class="mt-3 w-full rounded bg-black p-2 text-white disabled:opacity-60"
			disabled={sending}
		>
			{sending ? 'Sending...' : 'Send magic link'}
		</button>
	</form>

	{#if message}<p class="text-sm text-green-700">{message}</p>{/if}
	{#if error}<p class="text-sm text-red-700">{error}</p>{/if}
</div>
