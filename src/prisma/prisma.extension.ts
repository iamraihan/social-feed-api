import { Prisma } from '@prisma/client';

const statusCache = new Map<string, boolean>();

function hasStatusField(model: string): boolean {
  if (statusCache.has(model)) {
    return statusCache.get(model)!;
  }

  const fields = Prisma.dmmf.datamodel.models.find(
    (m) => m.name === model,
  )?.fields;
  const result = fields?.some((f) => f.name === 'status') ?? false;
  statusCache.set(model, result);
  return result;
}

function applySoftDeleteFilter(
  model: string,
  args: { where?: Record<string, unknown> },
) {
  if (hasStatusField(model) && !args.where?.status) {
    args.where = { ...args.where, status: { not: 'DELETED' } };
  }
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },

      async findFirst({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },

      async findUnique({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },

      async findUniqueOrThrow({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },

      async count({ model, args, query }) {
        applySoftDeleteFilter(model, args);
        return query(args);
      },
    },
  },
});
