import { command, form, query } from '$app/server';
import { Effect, Random, Schema } from 'effect';
import { DbService } from '$lib/services/db.service';
import { effectRunner } from '$lib/runtime';

export const queryGetAllUsers = query(async () => {
	const getAllUsersEffect = Effect.gen(function* () {
		const dbService = yield* DbService;

		return yield* dbService.getAllUsers();
	});

	const result = await effectRunner(getAllUsersEffect);

	return result;
});

const queryGetUserSchema = Schema.Struct({
	id: Schema.String
}).pipe(Schema.toStandardSchemaV1);

export const queryGetUser = query(queryGetUserSchema, async ({ id }) => {
	const getUserEffect = Effect.gen(function* () {
		const dbService = yield* DbService;

		return yield* dbService.getUser(id);
	});

	const result = await effectRunner(getUserEffect);

	return result;
});

const formCreateUserSchema = Schema.Struct({
	name: Schema.String,
	age: Schema.Number
}).pipe(Schema.toStandardSchemaV1);

export const formCreateUser = form(formCreateUserSchema, async ({ name, age }) => {
	const createUserEffect = Effect.gen(function* () {
		const dbService = yield* DbService;

		const id = yield* Random.nextUUIDv4;

		const newId = yield* dbService.createUser({ id, name, age });

		// single flight mutation to refresh the users list
		yield* Effect.promise(() => queryGetAllUsers().refresh());

		return newId;
	});

	const result = await effectRunner(createUserEffect);

	return result;
});

const commandDeleteUserSchema = Schema.Struct({
	id: Schema.String
}).pipe(Schema.toStandardSchemaV1);

export const commandDeleteUser = command(commandDeleteUserSchema, async ({ id }) => {
	const deleteUserEffect = Effect.gen(function* () {
		const dbService = yield* DbService;

		const deletedId = yield* dbService.deleteUser(id);

		// single flight mutation to refresh the users list
		yield* Effect.promise(() => queryGetAllUsers().refresh());

		return deletedId;
	});

	const result = await effectRunner(deleteUserEffect);

	return result;
});
