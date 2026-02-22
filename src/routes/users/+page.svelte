<script lang="ts">
	import { commandDeleteUser, formCreateUser, queryGetAllUsers } from '$lib/remote/users.remote';
	import { isHttpError } from '@sveltejs/kit';

	const users = queryGetAllUsers();

	let deleteError = $state<string | null>(null);

	const handleDelete = async (id: string) => {
		deleteError = null;
		try {
			await commandDeleteUser({ id });
		} catch (e) {
			deleteError = isHttpError(e) ? e.body.message : 'Failed to delete user';
		}
	};
</script>

<div class="mx-auto max-w-2xl px-6 py-16">
	<h1 class="mb-10 text-2xl font-semibold tracking-tight text-neutral-100">Users</h1>

	<div class="mb-10">
		{#if users.loading}
			<p class="text-sm text-neutral-500">Loading...</p>
		{:else if users.error}
			<p class="text-sm text-red-400">{users.error.message}</p>
		{:else if users.current?.length === 0}
			<p class="text-sm text-neutral-500">No users yet.</p>
		{:else}
			<ul class="divide-y divide-neutral-800">
				{#each users.current ?? [] as user (user.id)}
					<li class="flex items-center justify-between py-3">
						<div>
							<span class="text-sm font-medium text-neutral-200">{user.name}</span>
							<span class="ml-3 text-xs text-neutral-500">{user.favorite_color}</span>
						</div>
						<button
							onclick={() => handleDelete(user.id)}
							disabled={commandDeleteUser.pending > 0}
							class="text-xs text-neutral-500 transition hover:text-red-400 disabled:opacity-40"
						>
							Delete
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if deleteError}
			<p class="mt-2 text-xs text-red-400">{deleteError}</p>
		{/if}
	</div>

	<div class="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
		<h2 class="mb-4 text-sm font-semibold text-neutral-300">New user</h2>

		<form {...formCreateUser} class="flex flex-col gap-3">
			<div class="flex gap-3">
				<div class="flex flex-1 flex-col gap-1">
					<input
						{...formCreateUser.fields.name.as('text')}
						placeholder="Name"
						class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-primary focus:ring-2 focus:ring-primary/20 aria-invalid:border-red-400 aria-invalid:focus:border-red-400 aria-invalid:focus:ring-red-400/20"
					/>
					{#each formCreateUser.fields.name.issues() as issue}
						<p class="text-xs text-red-400">{issue.message}</p>
					{/each}
				</div>

				<div class="flex flex-1 flex-col gap-1">
					<input
						{...formCreateUser.fields.favorite_color.as('text')}
						placeholder="Favorite color"
						class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-500 focus:border-primary focus:ring-2 focus:ring-primary/20 aria-invalid:border-red-400 aria-invalid:focus:border-red-400 aria-invalid:focus:ring-red-400/20"
					/>
					{#each formCreateUser.fields.favorite_color.issues() as issue}
						<p class="text-xs text-red-400">{issue.message}</p>
					{/each}
				</div>
			</div>

			<button
				type="submit"
				disabled={formCreateUser.pending > 0}
				class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
			>
				{formCreateUser.pending > 0 ? 'Creating...' : 'Create user'}
			</button>
		</form>

		{#if formCreateUser.result}
			<p class="mt-3 text-xs text-neutral-500">Created user {formCreateUser.result.id}</p>
		{/if}
	</div>
</div>
