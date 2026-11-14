import type { INestApplication, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import {
  ZodArray,
  ZodBoolean,
  ZodBranded,
  ZodCatch,
  ZodDate,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodEnum,
  ZodIntersection,
  ZodLiteral,
  ZodNativeEnum,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodReadonly,
  ZodRecord,
  ZodString,
  ZodTuple,
  ZodUnion,
  type ZodTypeAny,
} from 'zod';
import { AdminGuard, PERMISSION_KEY } from '../src/admin/admin.guard';
import { API_PREFIX, UNPREFIXED } from '../src/app.setup';
import { APPS_KEY, AuthGuard } from '../src/auth/auth.guard';
import { LIMIT_KEY } from '../src/common/rate-limit';
import { ZodBody } from '../src/common/zod-body';

type JsonSchema = Record<string, unknown>;

/** A request schema as JSON Schema: what the API accepts, for the routes' document. */
export function jsonSchema(s: ZodTypeAny): JsonSchema {
  const describe = (out: JsonSchema) => (s.description ? { ...out, description: s.description } : out);
  if (s instanceof ZodEffects) return jsonSchema(s.innerType());
  if (s instanceof ZodOptional) return jsonSchema(s.unwrap());
  if (s instanceof ZodNullable) return { anyOf: [jsonSchema(s.unwrap()), { type: 'null' }] };
  if (s instanceof ZodDefault) return { ...jsonSchema(s.removeDefault()), default: s._def.defaultValue() };
  if (s instanceof ZodCatch) return jsonSchema(s.removeCatch());
  if (s instanceof ZodBranded) return jsonSchema(s.unwrap());
  if (s instanceof ZodReadonly) return jsonSchema(s._def.innerType);
  if (s instanceof ZodPipeline) return jsonSchema(s._def.in);
  if (s instanceof ZodString) {
    const out: JsonSchema = { type: 'string' };
    for (const check of s._def.checks) {
      if (check.kind === 'min') out.minLength = check.value;
      else if (check.kind === 'max') out.maxLength = check.value;
      else if (check.kind === 'length') out.minLength = out.maxLength = check.value;
      else if (check.kind === 'regex') out.pattern = check.regex.source;
      else if (check.kind === 'uuid' || check.kind === 'email' || check.kind === 'url') {
        out.format = check.kind === 'url' ? 'uri' : check.kind;
      } else if (check.kind === 'datetime') out.format = 'date-time';
    }
    return describe(out);
  }
  if (s instanceof ZodNumber) {
    const out: JsonSchema = { type: s.isInt ? 'integer' : 'number' };
    for (const check of s._def.checks) {
      if (check.kind === 'min') out[check.inclusive ? 'minimum' : 'exclusiveMinimum'] = check.value;
      else if (check.kind === 'max') out[check.inclusive ? 'maximum' : 'exclusiveMaximum'] = check.value;
    }
    return describe(out);
  }
  if (s instanceof ZodBoolean) return describe({ type: 'boolean' });
  if (s instanceof ZodDate) return describe({ type: 'string', format: 'date-time' });
  if (s instanceof ZodLiteral) return describe({ const: s.value });
  if (s instanceof ZodEnum) return describe({ type: 'string', enum: [...s.options] });
  if (s instanceof ZodNativeEnum) return describe({ enum: Object.values(s.enum) });
  if (s instanceof ZodArray) {
    const out: JsonSchema = { type: 'array', items: jsonSchema(s.element) };
    if (s._def.minLength) out.minItems = s._def.minLength.value;
    if (s._def.maxLength) out.maxItems = s._def.maxLength.value;
    if (s._def.exactLength) out.minItems = out.maxItems = s._def.exactLength.value;
    return describe(out);
  }
  if (s instanceof ZodTuple) return describe({ type: 'array', prefixItems: s.items.map(jsonSchema) });
  if (s instanceof ZodRecord) return describe({ type: 'object', additionalProperties: jsonSchema(s.valueSchema) });
  if (s instanceof ZodObject) {
    const shape = s.shape as Record<string, ZodTypeAny>;
    const required = Object.keys(shape).filter((k) => !shape[k]!.isOptional());
    return describe({
      type: 'object',
      properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchema(v)])),
      ...(required.length ? { required } : {}),
      // Unknown fields are refused (common/zod-body.ts), unless the schema says otherwise.
      additionalProperties: s._def.unknownKeys === 'passthrough',
    });
  }
  if (s instanceof ZodDiscriminatedUnion) return describe({ oneOf: [...s.options.values()].map(jsonSchema) });
  if (s instanceof ZodUnion) return describe({ anyOf: (s.options as ZodTypeAny[]).map(jsonSchema) });
  if (s instanceof ZodIntersection) return describe({ allOf: [jsonSchema(s._def.left), jsonSchema(s._def.right)] });
  return describe({});
}

const METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.OPTIONS]: 'options',
  [RequestMethod.HEAD]: 'head',
};

const listOf = (value: unknown): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const clean = (path: string) => path.replace(/^\/+|\/+$/g, '');
const joined = (...parts: string[]) => parts.map(clean).filter(Boolean).join('/');
const schemaOf = (pipes: unknown[] | undefined) =>
  (pipes ?? []).find((p): p is ZodBody<unknown> => p instanceof ZodBody)?.schema as ZodTypeAny | undefined;

interface RouteArg {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

/**
 * Every HTTP route the running app serves, as an OpenAPI document (docs/security-plan.md, S8): its path, who
 * may call it, its rate-limit class, and the parameters and body it accepts. Read from the controllers
 * themselves, so a route can't be added without the committed document changing.
 */
export function openApiDocument(app: INestApplication) {
  const controllers = new Set<Type>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) if (wrapper.metatype) controllers.add(wrapper.metatype as Type);
  }
  const paths: Record<string, Record<string, unknown>> = {};
  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (!method || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;

      const guards = [
        ...((Reflect.getMetadata(GUARDS_METADATA, controller) as Type[] | undefined) ?? []),
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) as Type[] | undefined) ?? []),
      ];
      const meta = (key: string) => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
      const args = Object.entries(
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as Record<string, RouteArg> | undefined) ?? {},
      ).map(([key, arg]) => ({ type: Number(key.split(':')[0]), ...arg }));

      const bases = listOf(Reflect.getMetadata(PATH_METADATA, controller));
      for (const base of bases.length ? bases : ['']) {
        for (const sub of listOf(Reflect.getMetadata(PATH_METADATA, handler))) {
          const route = joined(base, sub);
          const full = `/${(UNPREFIXED as readonly string[]).includes(route) ? route : joined(API_PREFIX, route)}`;
          const path = full.replace(/:(\w+)/g, '{$1}');

          const parameters: unknown[] = [...full.matchAll(/:(\w+)/g)].map(([, param]) => {
            const arg = args.find((a) => a.type === RouteParamtypes.PARAM && a.data === param);
            const uuid = (arg?.pipes ?? []).some((p) => (p as object)?.constructor?.name === 'ParseUUIDPipe');
            return {
              name: param,
              in: 'path',
              required: true,
              schema: { type: 'string', ...(uuid ? { format: 'uuid' } : {}) },
            };
          });
          let requestBody: unknown;
          for (const arg of args) {
            const schema = schemaOf(arg.pipes);
            if (arg.type === RouteParamtypes.QUERY) {
              if (typeof arg.data === 'string') {
                parameters.push({
                  name: arg.data,
                  in: 'query',
                  schema: schema ? jsonSchema(schema) : { type: 'string' },
                });
              } else if (schema) {
                const object = jsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
                for (const [field, fieldSchema] of Object.entries(object.properties ?? {})) {
                  parameters.push({
                    name: field,
                    in: 'query',
                    ...(object.required?.includes(field) ? { required: true } : {}),
                    schema: fieldSchema,
                  });
                }
              }
            }
            if (arg.type === RouteParamtypes.BODY && schema) {
              requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(schema) } } };
            }
          }

          const security = guards.includes(AuthGuard)
            ? [{ app: [] }]
            : guards.includes(AdminGuard)
              ? [{ admin: [] }]
              : [];
          const others = guards.filter((g) => g !== AuthGuard && g !== AdminGuard).map((g) => g.name);
          const status =
            (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ?? (method === 'post' ? 201 : 200);
          (paths[path] ??= {})[method] = {
            operationId: `${controller.name}.${name}`,
            tags: [controller.name.replace(/Controller$/, '')],
            security,
            ...(parameters.length ? { parameters } : {}),
            ...(requestBody ? { requestBody } : {}),
            responses: { [String(status)]: { description: 'Done' }, default: { description: 'An error' } },
            'x-rate-limit': meta(LIMIT_KEY) ?? 'default',
            ...(meta(APPS_KEY) ? { 'x-apps': meta(APPS_KEY) } : {}),
            ...(meta(PERMISSION_KEY) ? { 'x-permission': meta(PERMISSION_KEY) } : {}),
            ...(others.length ? { 'x-guards': others } : {}),
          };
        }
      }
    }
  }
  const sorted = Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((p) => [p, Object.fromEntries(Object.entries(paths[p]!).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  return {
    openapi: '3.1.0',
    info: {
      title: 'Jiffo API',
      version: API_PREFIX,
      description:
        'Every HTTP route the API serves, generated from its controllers by `pnpm --filter @jiffo/api openapi`; a test fails when this file is out of date. ' +
        'A route with no `security` is open to anyone. `x-rate-limit` is the limit class it counts under (common/rate-limit.ts), ' +
        '`x-apps` the apps whose sign-in it takes, and `x-permission` what an admin role needs. Errors are `{ error: { code, message } }`. ' +
        'Routes behind `DevelopmentOnlyGuard` answer 404 in production. ' +
        'Live updates use a socket.io connection with the app access token (realtime/realtime.gateway.ts), not listed here.',
    },
    components: {
      securitySchemes: {
        app: {
          type: 'http',
          scheme: 'bearer',
          description: 'An access token for the customer or agent app, from sign-in.',
        },
        admin: {
          type: 'http',
          scheme: 'bearer',
          description: "An admin session token, sent by the admin panel's server.",
        },
      },
    },
    paths: sorted,
  };
}
