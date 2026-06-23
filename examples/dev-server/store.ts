/**
 * In-memory state for the dev server. Stateless across hot reloads (per Q5):
 * every save resets to seed data. If you want state to survive saves while
 * iterating on resolvers, pin this module's exports to globalThis (~6 lines).
 */

import { User, Post, Comment } from "./domain.ts";

const ISO = (year: number, month: number, day: number): string =>
  new Date(Date.UTC(year, month - 1, day)).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Seed data
// ─────────────────────────────────────────────────────────────────────────────

export const USERS: User[] = [
  new User({ id: "u1", name: "Ada", createdAt: ISO(2024, 1, 15) }),
  new User({ id: "u2", name: "Linus", createdAt: ISO(2024, 2, 1) }),
  new User({ id: "u3", name: "Grace", createdAt: ISO(2024, 3, 20) }),
];

export const POSTS: Post[] = [
  new Post({
    id: "p1",
    title: "Effect in production",
    body: "After six months running Effect in production…",
    authorId: "u1",
    status: "Published",
    createdAt: ISO(2024, 4, 10),
  }),
  new Post({
    id: "p2",
    title: "Typesafe APIs",
    body: "Schema-driven contracts have changed how I write resolvers…",
    authorId: "u1",
    status: "Published",
    createdAt: ISO(2024, 5, 3),
  }),
  new Post({
    id: "p3",
    title: "Zero-cost schemas",
    body: "What if your runtime validation cost nothing in the happy path…",
    authorId: "u2",
    status: "Draft",
    createdAt: ISO(2024, 6, 12),
  }),
  new Post({
    id: "p4",
    title: "Compiling away the runtime",
    body: "Some old notes on a compilation strategy…",
    authorId: "u3",
    status: "Archived",
    createdAt: ISO(2023, 11, 4),
  }),
];

export const COMMENTS: Comment[] = [
  new Comment({
    id: "c1",
    body: "Loved this post!",
    authorId: "u2",
    postId: "p1",
    createdAt: ISO(2024, 4, 11),
  }),
  new Comment({
    id: "c2",
    body: "Have you tried the Layer pattern for this?",
    authorId: "u3",
    postId: "p1",
    createdAt: ISO(2024, 4, 12),
  }),
  new Comment({
    id: "c3",
    body: "Counter-point: Schema-driven means fewer ad-hoc tests.",
    authorId: "u3",
    postId: "p2",
    createdAt: ISO(2024, 5, 4),
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// Mutators
// ─────────────────────────────────────────────────────────────────────────────

let nextPostId = POSTS.length + 1;

export const createPost = (input: {
  readonly title: string;
  readonly body: string;
  readonly status: "Draft" | "Published" | "Archived";
  readonly authorId: string;
}): Post => {
  const post = new Post({
    id: `p${nextPostId++}`,
    title: input.title,
    body: input.body,
    authorId: input.authorId,
    status: input.status,
    createdAt: new Date().toISOString(),
  });
  POSTS.push(post);
  return post;
};
