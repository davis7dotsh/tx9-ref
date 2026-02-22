<script lang="ts">
	import { commandDeleteUser, formCreateUser, queryGetAllUsers } from '$lib/remote/users.remote';

	const users = queryGetAllUsers();
</script>

<div class="mx-auto max-w-2xl px-6 py-16">
	<h1 class="mb-10 text-2xl font-semibold tracking-tight text-neutral-900">Users</h1>

	<!-- User list -->
	<div class="mb-10">
		{#if users.loading}
			<p class="text-sm text-neutral-400">Loading...</p>
		{:else if users.error}
			<p class="text-sm text-red-500">{users.error.message}</p>
		{:else if users.current?.length === 0}
			<p class="text-sm text-neutral-400">No users yet.</p>
		{:else}
			<ul class="divide-y divide-neutral-100">
				{#each users.current ?? [] as user (user.id)}
					<li class="flex items-center justify-between py-3">
						<div>
							<span class="text-sm font-medium text-neutral-900">{user.name}</span>
							<span class="ml-3 text-xs text-neutral-400">{user.favorite_color}</span>
						</div>
						<button
							onclick={() => commandDeleteUser({ id: user.id })}
							disabled={commandDeleteUser.pending > 0}
							class="text-xs text-neutral-400 transition hover:text-red-500 disabled:opacity-40"
						>
							Delete
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<!-- Create user form -->
	<div class="rounded-xl border border-neutral-200 p-6">
		<h2 class="mb-4 text-sm font-semibold text-neutral-700">New user</h2>
		<form {...formCreateUser} class="flex flex-col gap-3">
			<div class="flex gap-3">
				<input
					type="text"
					name="name"
					placeholder="Name"
					required
					class="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
				/>
				<input
					type="text"
					name="favorite_color"
					placeholder="Favorite color"
					required
					class="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
				/>
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
			<p class="mt-3 text-xs text-neutral-400">Created user {formCreateUser.result.id}</p>
		{/if}
	</div>
</div>
