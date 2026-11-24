// @ts-check

import { and, asc, eq } from "drizzle-orm";
import fastify from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { articles, comments } from "../db/schema/index.js";
import init from "../server/plugin.js";

describe("comments", () => {
  let app;

  const createArticle = async (data) => {
    await app.inject({
      method: "POST",
      url: "/articles",
      payload: { data },
    });

    const [article] = await app.db
      .select()
      .from(articles)
      .where(and(eq(articles.title, data.title), eq(articles.content, data.content)))
      .limit(1);

    return article;
  };

  const createComment = (articleId, data) =>
    app.inject({
      method: "POST",
      url: `/articles/${articleId}/comments`,
      payload: { comment: data },
    });

  const findComment = async ({ articleId, author, content }) => {
    const [comment] = await app.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.articleId, articleId),
          eq(comments.author, author),
          eq(comments.content, content),
        ),
      )
      .limit(1);

    return comment ?? null;
  };

  const listComments = (articleId) =>
    app.db
      .select()
      .from(comments)
      .where(eq(comments.articleId, articleId))
      .orderBy(asc(comments.createdAt), asc(comments.id));

  beforeAll(async () => {
    app = fastify({ exposeHeadRoutes: false, logger: false });
    await init(app);
  });

  afterAll(async () => {
    await app.close();
  });

  test("create comment - POST /articles/:id/comments", async () => {
    const article = await createArticle({
      title: "Comment target",
      content: "Comment target content",
    });
    const commentData = { author: "Alice", content: "First comment" };

    const response = await createComment(article.id, commentData);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`/articles/${article.id}#comments`);
    expect(await findComment({ articleId: article.id, ...commentData })).not.toBeNull();
  });

  test("comment is shown on the article page", async () => {
    const article = await createArticle({
      title: "Article with comment",
      content: "Article with comment content",
    });
    await createComment(article.id, { author: "Bob", content: "Visible comment text" });

    const response = await app.inject({
      method: "GET",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Bob");
    expect(response.body).toContain("Visible comment text");
  });

  test("invalid comment - 422 and no row", async () => {
    const article = await createArticle({
      title: "Article for invalid comment",
      content: "Article for invalid comment content",
    });

    const response = await createComment(article.id, { author: "", content: "" });

    expect(response.statusCode).toBe(422);
    expect(await listComments(article.id)).toHaveLength(0);
    // Форма отрисована заново с полями комментария.
    expect(response.body).toContain('id="comment_author"');
    expect(response.body).toContain('id="comment_content"');
  });

  test("comment for missing article - 404", async () => {
    const response = await createComment(999_999, { author: "Nobody", content: "Nowhere" });

    expect(response.statusCode).toBe(404);
  });

  test("delete comment - POST with _method=delete", async () => {
    const article = await createArticle({
      title: "Article for form deletion",
      content: "Article for form deletion content",
    });
    const commentData = { author: "Carol", content: "Comment to delete" };
    await createComment(article.id, commentData);
    const comment = await findComment({ articleId: article.id, ...commentData });

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/comments/${comment.id}`,
      payload: { _method: "delete" },
    });

    expect(response.statusCode).toBe(302);
    expect(await findComment({ articleId: article.id, ...commentData })).toBeNull();
  });

  test("delete comment - DELETE /articles/:articleId/comments/:id", async () => {
    const article = await createArticle({
      title: "Article for direct deletion",
      content: "Article for direct deletion content",
    });
    const commentData = { author: "Dave", content: "Comment to delete directly" };
    await createComment(article.id, commentData);
    const comment = await findComment({ articleId: article.id, ...commentData });

    const response = await app.inject({
      method: "DELETE",
      url: `/articles/${article.id}/comments/${comment.id}`,
    });

    expect(response.statusCode).toBe(302);
    expect(await findComment({ articleId: article.id, ...commentData })).toBeNull();
  });

  test("delete missing comment - 404", async () => {
    const article = await createArticle({
      title: "Article without comments",
      content: "Article without comments content",
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/articles/${article.id}/comments/999999`,
    });

    expect(response.statusCode).toBe(404);
  });

  test("deleting an article deletes its comments", async () => {
    const article = await createArticle({
      title: "Article to delete with comments",
      content: "Article to delete with comments content",
    });
    await createComment(article.id, { author: "Eve", content: "Doomed comment" });

    const response = await app.inject({
      method: "DELETE",
      url: `/articles/${article.id}`,
    });

    expect(response.statusCode).toBe(302);
    expect(await listComments(article.id)).toHaveLength(0);
  });

  test("comments are shown oldest first", async () => {
    const article = await createArticle({
      title: "Article with ordered comments",
      content: "Article with ordered comments content",
    });
    await createComment(article.id, { author: "OrderFirst", content: "First ordered comment" });
    await createComment(article.id, { author: "OrderSecond", content: "Second ordered comment" });

    const response = await app.inject({
      method: "GET",
      url: `/articles/${article.id}`,
    });

    expect(response.body.indexOf("OrderFirst")).toBeLessThan(response.body.indexOf("OrderSecond"));
  });
});
