<script lang="ts">
	import { commandSandboxTest } from '$lib/remote/daytona.remote';
	import { isHttpError } from '@sveltejs/kit';

	const handleSandboxTest = async () => {
		try {
			const result = await commandSandboxTest();
			console.log(result);
		} catch (e) {
			if (isHttpError(e)) {
				console.error(e.body.message);
			} else {
				console.error(e);
			}
		}
	};
</script>

<div>
	<h2>daytona sandbox stuff</h2>

	<button onclick={handleSandboxTest}>Test sandbox</button>
</div>
