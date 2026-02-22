<script lang="ts">
	import { formCreateUser, queryGetAllUsers } from '$lib/remote/users.remote';

	const allUsers = $derived(await queryGetAllUsers());

	$inspect(allUsers);
</script>

<div>
	<h2>users page demo</h2>

	<form {...formCreateUser}>
		<label for="name">Name</label>
		<input type="text" id="name" name="name" />
		<label for="age">Age</label>
		<input type="number" id="age" name="age" />
		<button type="submit">Create User</button>
	</form>
</div>
