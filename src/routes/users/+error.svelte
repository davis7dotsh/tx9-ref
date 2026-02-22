<script lang="ts">
	import { page } from '$app/state';

	const message = page.status < 500 ? page.error?.message : 'Something went wrong';
</script>

<div class="mx-auto max-w-2xl px-6 py-16">
	<p class="mb-2 text-sm font-medium text-neutral-400">{page.status}</p>
	<h1 class="mb-1 text-2xl font-semibold tracking-tight text-neutral-900">{message}</h1>
	<p class="mb-6 text-sm text-neutral-400">There was a problem loading this page.</p>
	<a href="/" class="text-sm text-primary hover:underline">Go home</a>
</div>
