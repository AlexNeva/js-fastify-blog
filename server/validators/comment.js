// @ts-check

import { createInsertSchema } from "drizzle-zod";
import { comments } from "../../db/schema/index.js";
import { formatErrors } from "./errors.js";

// Схема выводится из схемы таблицы: поля и их обязательность не дублируются
// руками. Сверху добавлен только запрет пустой строки.
const commentSchema = createInsertSchema(comments, {
  author: (schema) => schema.min(1),
  content: (schema) => schema.min(1),
}).pick({ author: true, content: true });

export const validateComment = (data) => {
  const result = commentSchema.safeParse(data ?? {});

  return result.success
    ? { data: result.data, errors: null }
    : { data: null, errors: formatErrors(result.error) };
};
