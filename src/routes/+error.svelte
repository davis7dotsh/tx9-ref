<script lang="ts">
	import { page } from '$app/state';

	const message = page.status < 500 ? page.error?.message : 'Something went wrong';
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6">
	<p class="mb-2 text-sm font-medium text-neutral-400">{page.status}</p>
	<h1 class="mb-6 text-2xl font-semibold tracking-tight text-neutral-900">{message}</h1>
	<a href="/" class="text-sm text-primary hover:underline">Go home</a>
</div>
