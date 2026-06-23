/**
 * Schemas for the dev-server example. Extends the blog domain (User, Post)
 * used by the other examples with:
 *
 *  - DateTime custom scalar (via `graphql: { scalar: ... }` annotation)
 *  - PostStatus enum (Schema.Literals → GraphQLEnumType)
 *  - CreatePostInput (structured input — exercises the input/output type split)
 *  - Comment type with cross-augmentations on User AND Post
 *  - NonEmptyString validation on the create-post title (rejected at the wire by
 *    Schema.decodeUnknown before the resolver runs)
 */

import { Schema } from "effect";
import { GraphQLScalarType, Kind } from "graphql";

// ─────────────────────────────────────────────────────────────────────────────
// Custom DateTime scalar
// ─────────────────────────────────────────────────────────────────────────────

/** ISO-8601 date strings, validated structurally. */
export const DateTimeScalar = new GraphQLScalarType<string, string>({
  name: "DateTime",
  description: "ISO-8601 timestamp (e.g. \"2026-01-31T12:00:00.000Z\")",
  serialize: (value) => String(value),
  parseValue: (value) => {
    if (typeof value !== "string") throw new TypeError("DateTime must be a string");
    if (Number.isNaN(Date.parse(value))) throw new TypeError("DateTime must be ISO-8601");
    return value;
  },
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING) throw new TypeError("DateTime must be a string literal");
    if (Number.isNaN(Date.parse(ast.value))) throw new TypeError("DateTime must be ISO-8601");
    return ast.value;
  },
});

/** Annotate any `Schema.String` field as DateTime in the GraphQL output. */
export const DateTime = Schema.String.annotate({ graphql: { scalar: DateTimeScalar } });

// ─────────────────────────────────────────────────────────────────────────────
// PostStatus enum
// ─────────────────────────────────────────────────────────────────────────────

export const PostStatus = Schema.Literals(["Draft", "Published", "Archived"])
  .annotate({ identifier: "PostStatus" });
export type PostStatus = (typeof PostStatus)["Type"];

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  createdAt: DateTime,
}) {}

export class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
  status: PostStatus,
  createdAt: DateTime,
}) {}

export class Comment extends Schema.Class<Comment>("Comment")({
  id: Schema.String,
  body: Schema.String,
  authorId: Schema.String,
  postId: Schema.String,
  createdAt: DateTime,
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// Errors (typed; flow into result unions per ADR 0002)
// ─────────────────────────────────────────────────────────────────────────────

export class NotFound extends Schema.Class<NotFound>("NotFound")({
  _tag: Schema.Literal("NotFound"),
  message: Schema.String,
}) {}

export class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
  _tag: Schema.Literal("Forbidden"),
  reason: Schema.String,
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured input for createPost. The `title` is `NonEmptyString`, so the
 * library's `Schema.decodeUnknown(payloadSchema)` step rejects an empty title
 * BEFORE the resolver runs — surfaces as a top-level GraphQL error.
 *
 * The deriver emits this as a separate `input CreatePostInput { … }` GraphQL
 * type (per ADR/issue #2's input/output split).
 */
export class CreatePostInput
  extends Schema.Class<CreatePostInput>("CreatePostInput")({
    title: Schema.NonEmptyString,
    body: Schema.String,
    status: PostStatus,
  })
{}
