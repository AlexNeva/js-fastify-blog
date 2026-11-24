// @ts-check

import { and, asc, eq } from "drizzle-orm";
import i18next from "i18next";
import { articles, comments } from "../../db/schema/index.js";
import { validateArticle } from "../validators/article.js";
import { validateComment } from "../validators/comment.js";

export default (app) => {
  // id у колонок integer, то есть 32-битный. Без верхней границы число вроде
  // 9999999999 — всё ещё integer для JS, но уже вне диапазона Postgres, и
  // запрос падает с 500 вместо 404.
  const MAX_ID = 2_147_483_647;

  const parseId = (value) => {
    const id = Number(value);

    return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null;
  };

  const findArticle = async (id) => {
    const articleId = parseId(id);

    if (articleId === null) {
      return null;
    }

    const [article] = await app.db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    return article ?? null;
  };

  const listComments = (articleId) =>
    app.db
      .select()
      .from(comments)
      .where(eq(comments.articleId, articleId))
      .orderBy(asc(comments.createdAt), asc(comments.id));

  // Страница статьи с комментариями нужна в двух местах: при обычном показе и
  // при ошибке валидации формы комментария, когда страницу надо отрисовать
  // заново с введёнными значениями и текстами ошибок.
  const renderArticle = async (reply, article, { comment, errors } = {}) => {
    reply.render("articles/show", {
      article,
      comments: await listComments(article.id),
      comment: comment ?? { author: "", content: "" },
      errors: errors ?? null,
    });
  };

  const updateArticle = async (req, reply) => {
    const { id } = req.params;
    const article = await findArticle(id);

    if (!article) {
      return reply.callNotFound();
    }

    const { data, errors } = validateArticle(req.body.data);

    if (errors) {
      req.flash("error", i18next.t("views.article.edit.error"));
      reply.code(422);
      reply.render("articles/edit", { article: { ...article, ...req.body.data }, errors });
      return reply;
    }

    await app.db
      .update(articles)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(articles.id, article.id));

    req.flash("info", i18next.t("views.article.edit.success"));
    reply.redirect(app.reverse("articles"));
    return reply;
  };

  const destroyArticle = async (req, reply) => {
    const article = await findArticle(req.params.id);

    if (!article) {
      return reply.callNotFound();
    }

    try {
      await app.db.delete(articles).where(eq(articles.id, article.id));
      req.flash("info", i18next.t("views.article.delete.success"));
    } catch (e) {
      req.log.error(e);
      req.flash("error", i18next.t("views.article.delete.error"));
    }

    reply.redirect(app.reverse("articles"));
    return reply;
  };

  const createComment = async (req, reply) => {
    const article = await findArticle(req.params.id);

    if (!article) {
      return reply.callNotFound();
    }

    const { data, errors } = validateComment(req.body.comment);

    if (errors) {
      req.flash("error", i18next.t("views.comment.create.error"));
      reply.code(422);
      await renderArticle(reply, article, {
        comment: req.body.comment ?? {},
        errors,
      });
      return reply;
    }

    await app.db.insert(comments).values({ ...data, articleId: article.id });
    req.flash("info", i18next.t("views.comment.create.success"));
    // Возвращаемся к блоку комментариев, а не к началу длинной статьи.
    reply.redirect(`${app.reverse("article", { id: article.id })}#comments`);
    return reply;
  };

  const destroyComment = async (req, reply) => {
    const article = await findArticle(req.params.articleId);

    if (!article) {
      return reply.callNotFound();
    }

    const commentId = parseId(req.params.id);

    if (commentId === null) {
      return reply.callNotFound();
    }

    // articleId в условии не даёт удалить комментарий чужой статьи, подставив
    // в URL произвольный id.
    const [deleted] = await app.db
      .delete(comments)
      .where(and(eq(comments.id, commentId), eq(comments.articleId, article.id)))
      .returning({ id: comments.id });

    if (!deleted) {
      return reply.callNotFound();
    }

    req.flash("info", i18next.t("views.comment.delete.success"));
    reply.redirect(`${app.reverse("article", { id: article.id })}#comments`);
    return reply;
  };

  app
    .get("/articles", { name: "articles" }, async (req, reply) => {
      reply.render("articles/index", { articles: await app.db.select().from(articles) });
      return reply;
    })
    .get("/articles/new", { name: "newArticle" }, (req, reply) => {
      reply.render("articles/new", { article: { title: "", content: "" } });
    })
    .post("/articles", async (req, reply) => {
      const { data, errors } = validateArticle(req.body.data);

      if (errors) {
        req.flash("error", i18next.t("views.article.create.error"));
        reply.code(422);
        reply.render("articles/new", { article: req.body.data ?? {}, errors });
        return reply;
      }

      await app.db.insert(articles).values(data);
      req.flash("info", i18next.t("views.article.create.success"));
      reply.redirect(app.reverse("articles"));
      return reply;
    })
    .get("/articles/:id", { name: "article" }, async (req, reply) => {
      const article = await findArticle(req.params.id);

      if (!article) {
        return reply.callNotFound();
      }

      await renderArticle(reply, article);
      return reply;
    })
    .get("/articles/:id/edit", { name: "editArticle" }, async (req, reply) => {
      const article = await findArticle(req.params.id);

      if (!article) {
        return reply.callNotFound();
      }

      reply.render("articles/edit", { article });
      return reply;
    })
    // HTML-форма умеет только GET и POST, поэтому PATCH и DELETE приходят
    // POST-запросом со скрытым полем `_method`. Разбирает его плагин
    // @hexlet/fastify-method-override, подключённый в plugin.js.
    .patch("/articles/:id", updateArticle)
    .delete("/articles/:id", destroyArticle)
    .post("/articles/:id/comments", { name: "articleComments" }, createComment)
    .delete("/articles/:articleId/comments/:id", { name: "comment" }, destroyComment);
};
