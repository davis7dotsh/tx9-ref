import { Effect, Layer, Schema, ServiceMap } from 'effect';

export class DbError extends Schema.ErrorClass<DbError>('DbError')({
	message: Schema.String,
	code: Schema.Number,
	cause: Schema.optional(Schema.Defect)
}) {}

type User = {
	id: string;
	name: string;
	favorite_color: string;
};

const dbServiceEffect = Effect.gen(function* () {
	// imagine this is connecting to a real database
	let db = new Map<string, Omit<User, 'id'>>([['user1', { name: 'Ben', favorite_color: 'blue' }]]);

	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			// imagine this is closing the connection to the real database
			yield* Effect.logInfo('Closing database connection');
			db = new Map<string, Omit<User, 'id'>>();
		})
	);

	const getUser = (id: string) =>
		Effect.gen(function* () {
			const user = db.get(id);

			if (!user) {
				return yield* Effect.fail(
					new DbError({
						message: `User with id ${id} not found`,
						code: 404
					})
				);
			}

			return user;
		});

	const createUser = (data: { id: string; name: string; favorite_color: string }) =>
		Effect.gen(function* () {
			const { id, name, favorite_color } = data;
			db.set(id, { name, favorite_color: favorite_color });
			return { id };
		});

	const getAllUsers = () =>
		Effect.gen(function* () {
			return Array.from(db.entries()).map(([id, user]) => ({ id, ...user }));
		});

	const deleteUser = (id: string) =>
		Effect.gen(function* () {
			db.delete(id);
			return { id };
		});

	return {
		getUser,
		createUser,
		getAllUsers,
		deleteUser
	};
});

export class DbService extends ServiceMap.Service<
	DbService,
	Effect.Success<typeof dbServiceEffect>
>()('DbService') {}

export const dbServiceLayer = Layer.effect(DbService)(dbServiceEffect);
