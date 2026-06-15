// PROTOTYPE — throwaway. Portable bit: schemas (Schema.Class) carry only shape; relationship
// fields are added as GLOBAL AUGMENTATIONS on the provider root via `createAugment(Type, rpc, impl)`.
// The deriver discovers shapes by crawling the root rpcs and layers augmentations on by identifier.
// Classes are nominal, so augment `success` schemas reference the bare class — no Schema.suspend,
// no inference cycle, and the schema bindings stay pure (inferred from the queries). See NOTES.md.

import { Effect, Schema, SchemaAST as AST } from "effect";
import { Rpc } from "effect/unstable/rpc";
import * as GQL from "graphql";

// A root field: the Rpc carries the schemas; `resolve` takes (args, source).
export interface FieldImpl<Src = any> {
  readonly rpc: {
    readonly _tag: string;
    readonly payloadSchema: Schema.Top;
    readonly successSchema: Schema.Top;
  };
  // R = never here so we can `runPromise` directly; the real lib runs on a Runtime providing R.
  readonly resolve: (args: any, source: Src) => Effect.Effect<any, any, never>;
}

// A global augmentation: attach one relationship field (the Rpc) to a target type, with an impl
// whose `self` is the target's decoded Type and whose remaining params come from the Rpc handler.
export interface Augment {
  readonly identifier: string;
  readonly fieldName: string;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly impl: (source: any, args: any) => Effect.Effect<any, any, never>;
}

export const createAugment = <S extends Schema.Top, R extends Rpc.Any>(
  schema: S,
  rpc: R,
  impl: (self: S["Type"], ...rest: Parameters<Rpc.ToHandlerFn<R>>) => ReturnType<Rpc.ToHandlerFn<R>>,
): Augment => {
  const identifier = AST.resolveIdentifier(schema.ast);
  if (!identifier) {
    throw new Error("createAugment: target schema has no identifier (use Schema.Class or withGqlIdentifier)");
  }
  const anyRpc = rpc as unknown as { _tag: string; payloadSchema: Schema.Top; successSchema: Schema.Top };
  return {
    identifier,
    fieldName: anyRpc._tag,
    payloadSchema: anyRpc.payloadSchema,
    successSchema: anyRpc.successSchema,
    impl: (source, args) => (impl as any)(source, args),
  };
};

export interface Roots {
  readonly query: Record<string, FieldImpl>;
  readonly mutation?: Record<string, FieldImpl>;
  // Relationship fields layered onto discovered types by identifier.
  readonly globalAugmentations?: ReadonlyArray<Augment>;
}

const nonNull = (t: GQL.GraphQLOutputType) => new GQL.GraphQLNonNull(t);
const withNull = (t: GQL.GraphQLOutputType, ast: AST.AST) => ast.context?.isOptional ? t : nonNull(t);

// A Schema.Class has a `Declaration` AST; its underlying struct is typeParameters[0].
const structOf = (ast: AST.AST): AST.Objects | undefined => {
  if (AST.isObjects(ast)) return ast;
  if (AST.isDeclaration(ast)) {
    const inner = ast.typeParameters[0];
    if (inner && AST.isObjects(inner)) return inner;
  }
  return undefined;
};

export function deriveSchema(roots: Roots): GQL.GraphQLSchema {
  const cache = new Map<string, GQL.GraphQLObjectType>();
  const materialized = new Set<string>();
  const idToAugments = new Map<string, Augment[]>();
  for (const aug of roots.globalAugmentations ?? []) {
    const list = idToAugments.get(aug.identifier) ?? [];
    list.push(aug);
    idToAugments.set(aug.identifier, list);
  }

  const inputType = (ast: AST.AST): GQL.GraphQLInputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    throw new Error(`prototype: unsupported input ast '${ast._tag}'`);
  };

  const outputType = (ast: AST.AST): GQL.GraphQLOutputType => {
    if (AST.isString(ast)) return GQL.GraphQLString;
    if (AST.isNumber(ast)) return GQL.GraphQLInt;
    if (AST.isBoolean(ast)) return GQL.GraphQLBoolean;
    if (AST.isArrays(ast)) return new GQL.GraphQLList(withNull(outputType(ast.rest[0]), ast.rest[0]));
    if (AST.isSuspend(ast)) return outputType(ast.thunk());
    const struct = structOf(ast);
    if (struct) return objectTypeFor(ast, struct);
    throw new Error(`prototype: unsupported output ast '${ast._tag}'`);
  };

  const fieldFromSchemas = (
    payloadSchema: Schema.Top,
    successSchema: Schema.Top,
    resolve: (source: any, fieldArgs: any) => Promise<any>,
  ): GQL.GraphQLFieldConfig<any, any> => {
    const argsStruct = structOf(payloadSchema.ast);
    const args: GQL.GraphQLFieldConfigArgumentMap = {};
    if (argsStruct) {
      for (const ps of argsStruct.propertySignatures) {
        const base = inputType(ps.type);
        args[String(ps.name)] = { type: ps.type.context?.isOptional ? base : new GQL.GraphQLNonNull(base) };
      }
    }
    return { type: withNull(outputType(successSchema.ast), successSchema.ast), args, resolve };
  };

  // `nameAst` carries the identifier (the Declaration/Objects); `struct` carries the fields.
  const objectTypeFor = (nameAst: AST.AST, struct: AST.Objects): GQL.GraphQLObjectType => {
    const name = AST.resolveIdentifier(nameAst);
    if (!name) throw new Error("prototype: reachable object schema has no `identifier` annotation");
    materialized.add(name);
    const hit = cache.get(name);
    if (hit) return hit;
    const augs = idToAugments.get(name) ?? [];
    const type = new GQL.GraphQLObjectType({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<any, any> = {};
        const plainNames = new Set<string>();
        for (const ps of struct.propertySignatures) {
          const fname = String(ps.name);
          fields[fname] = { type: withNull(outputType(ps.type), ps.type) };
          plainNames.add(fname);
        }
        for (const aug of augs) {
          if (aug.fieldName in fields) {
            const origin = plainNames.has(aug.fieldName) ? "the base schema" : "another augment";
            throw new Error(
              `prototype: augment on type '${name}' collides on field '${aug.fieldName}' (already defined by ${origin})`,
            );
          }
          fields[aug.fieldName] = fieldFromSchemas(
            aug.payloadSchema,
            aug.successSchema,
            (source, fieldArgs) => Effect.runPromise(aug.impl(source, fieldArgs)),
          );
        }
        return fields;
      },
    });
    cache.set(name, type);
    return type;
  };

  const rootType = (name: string, record: Record<string, FieldImpl>) =>
    new GQL.GraphQLObjectType({
      name,
      fields: () => {
        const fields: GQL.GraphQLFieldConfigMap<any, any> = {};
        for (const [fname, impl] of Object.entries(record)) {
          fields[fname] = fieldFromSchemas(
            impl.rpc.payloadSchema,
            impl.rpc.successSchema,
            (source, fieldArgs) => Effect.runPromise(impl.resolve(fieldArgs, source)),
          );
        }
        return fields;
      },
    });

  // Construction calls every reachable field thunk (collision checks fire here), and
  // materializes every reachable type — so afterwards we can flag augments that target
  // a type no query reaches.
  const schema = new GQL.GraphQLSchema({
    query: rootType("Query", roots.query),
    mutation: roots.mutation ? rootType("Mutation", roots.mutation) : undefined,
  });
  const missing = [...idToAugments.keys()].filter((id) => !materialized.has(id));
  if (missing.length > 0) {
    const known = [...materialized].sort().join(", ");
    throw new Error(
      `prototype: augment(s) target type(s) not present in the schema: ${missing.join(", ")}. Known types: ${known}`,
    );
  }
  return schema;
}
