// PROTOTYPE — throwaway domain wiring. Schemas are pure `Schema.Class` shape (one binding each,
// discovered by crawling the queries). Relationship fields are added as GLOBAL AUGMENTATIONS on
// the provider root via `createAugment(Type, rpc, impl)` — `self` and args fully inferred, the
// schema never wrapped/annotated, and recursion handled with no `Schema.suspend` (classes are
// nominal so an augment's `success` references the bare class directly).

import { Effect, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { createAugment, type FieldImpl, type Roots } from "./derive.ts";

// ---- in-memory store -----------------------------------------------------
interface PostRow {
  id: string;
  title: string;
  authorId: string;
}
const users = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Linus" }];
const posts: PostRow[] = [
  { id: "p1", title: "On Algorithms", authorId: "u1" },
  { id: "p2", title: "Notes on Engines", authorId: "u1" },
  { id: "p3", title: "Kernel Hacking", authorId: "u2" },
];
const postRow = (id: string) => posts.find((p) => p.id === id)!;

// ---- resolution trace (the thing we watch) -------------------------------
export const trace: string[] = [];
export const resetTrace = () => {
  trace.length = 0;
};
const log = (s: string) => {
  trace.push(s);
};

// ---- types: pure Schema.Class shape, ONE binding each ---------------------
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  title: Schema.String,
}) {}

// ---- root operations (same Rpc primitive; source = <root>) ----------------
const queryUser: FieldImpl = {
  rpc: Rpc.make("user", { payload: { id: Schema.String }, success: User }),
  resolve: ({ id }: { id: string }) =>
    Effect.sync(() => {
      log(`Query.user(id=${id})  source=<root>`);
      return users.find((u) => u.id === id);
    }),
};

const queryUsers: FieldImpl = {
  rpc: Rpc.make("users", { success: Schema.Array(User) }),
  resolve: () =>
    Effect.sync(() => {
      log(`Query.users  source=<root>`);
      return users;
    }),
};

const createPost: FieldImpl = {
  rpc: Rpc.make("createPost", {
    payload: { authorId: Schema.String, title: Schema.String },
    success: Post,
  }),
  resolve: ({ authorId, title }: { authorId: string; title: string }) =>
    Effect.sync(() => {
      const row: PostRow = { id: `p${posts.length + 1}`, title, authorId };
      posts.push(row);
      log(`Mutation.createPost(authorId=${authorId}, title=${JSON.stringify(title)}) -> ${row.id}`);
      return row;
    }),
};

// Schemas are inferred from the queries above. Relationship fields are layered on here:
// `self` is the target's decoded type, args come from the Rpc. `success` references the bare
// class (nominal) — no suspend, no cycle, and no annotation/wrapper on the schemas themselves.
export const roots: Roots = {
  query: { user: queryUser, users: queryUsers },
  mutation: { createPost },
  globalAugmentations: [
    createAugment(
      User,
      Rpc.make("posts", { payload: { first: Schema.Int }, success: Schema.Array(Post) }),
      Effect.fn(function*(self, { first }) {
        log(`  User.posts(first=${first})  source=${self.id}`);
        return posts.filter((p) => p.authorId === self.id).slice(0, first);
      }),
    ),
    createAugment(
      Post,
      Rpc.make("author", { success: User }),
      Effect.fn(function*(self) {
        const authorId = postRow(self.id).authorId;
        log(`  Post.author  source=${self.id} -> looks up ${authorId}`);
        return users.find((u) => u.id === authorId)!;
      }),
    ),
  ],
};

export const presetQueries: ReadonlyArray<{ label: string; query: string }> = [
  {
    label: "user + nested posts (per-field resolution, nested arg `first`)",
    query: `{ user(id: "u1") { name posts(first: 2) { title } } }`,
  },
  {
    label: "deep: users -> posts -> author (augmentations, no suspend — classes are nominal)",
    query: `{ users { name posts(first: 1) { title author { name } } } }`,
  },
  {
    label: "mutation: createPost then select fields off the payload",
    query: `mutation { createPost(authorId: "u2", title: "Fresh Post") { id title author { name } } }`,
  },
  {
    label: "plain fields only (no resolvers fire)",
    query: `{ user(id: "u2") { id name } }`,
  },
];
