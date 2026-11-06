import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function menu(page: Page) {
  const button = page.getByRole("button", { name: "Open navigation" });
  if (await button.isVisible()) await button.click();
}
async function guest(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(
    page.getByRole("heading", { name: "What’s on your mind today?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your message")).toBeEnabled();
}
async function send(page: Page, content = "I feel overwhelmed with work") {
  await page.getByLabel("Your message").fill(content);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
}
test("guest chat, rename, archive, restore, export, delete and logout", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await guest(page);
  await page.screenshot({
    path: `artifacts/${info.project.name}-chat-empty.png`,
    fullPage: true,
  });
  await send(page);
  await expect(page.locator(".message.assistant")).toContainText(
    "scripted demo",
  );
  await page.getByRole("button", { name: "Rename conversation" }).click();
  await page.getByLabel("Conversation title").fill("My work check-in");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.locator(".conversation-toolbar")).toContainText(
    "My work check-in",
  );
  await page.getByRole("button", { name: "Archive conversation" }).click();
  await expect(page.getByText("This conversation is archived.")).toBeVisible();
  await page.getByRole("button", { name: "Restore to continue" }).click();
  await expect(page.getByLabel("Your message")).toBeVisible();
  await page.screenshot({
    path: `artifacts/${info.project.name}-chat.png`,
    fullPage: true,
  });
  await menu(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export conversations" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/still-conversations.*json/);
  if (await page.getByRole("button", { name: "Close navigation" }).isVisible())
    await page
      .getByRole("button", { name: "Close navigation" })
      .click({ position: { x: 350, y: 50 } });
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    page.getByRole("heading", { name: "What’s on your mind today?" }),
  ).toBeVisible();
  await menu(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue as guest" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("registered account persists chats after reload and login; account deletion removes data", async ({
  page,
}, info) => {
  const email = `test-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("a sufficiently long password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Your message")).toBeEnabled();
  await send(page, "My saved reflection");
  await page.reload();
  await expect(page.getByLabel("Your message")).toBeEnabled();
  await menu(page);
  await page
    .getByRole("button", { name: "My saved reflection", exact: true })
    .click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await menu(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("a sufficiently long password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Your message")).toBeEnabled();
  await menu(page);
  await expect(
    page.getByRole("button", { name: "My saved reflection", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete account & data" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    page.getByRole("button", { name: "Continue as guest" }),
  ).toBeVisible();
});

test("failed reply restores draft and retry does not duplicate messages", async ({
  page,
}) => {
  await guest(page);
  await page.route("**/api/conversations/*/messages", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary reply failure. Try again." }),
      });
    } else await route.continue();
  });
  await page.getByLabel("Your message").fill("A thought to retry");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Temporary reply failure",
  );
  await expect(page.getByLabel("Your message")).toHaveValue(
    "A thought to retry",
  );
  await page.unroute("**/api/conversations/*/messages");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".message.user")).toHaveCount(1);
});

test("lost response after server commit is recovered without duplicate exchange", async ({
  page,
}) => {
  await guest(page);
  let first = true;
  await page.route("**/api/conversations/*/messages", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByLabel("Your message")
    .fill("A message with an interrupted response");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Your message")).toBeEnabled();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".message.user")).toHaveCount(1);
});

test("support resources, safe rendering, session expiry and responsive layout", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.screenshot({
    path: `artifacts/${info.project.name}-login.png`,
    fullPage: true,
  });
  await guest(page);
  await send(page, '<script>alert("test")</script>');
  await expect(page.locator(".message.user")).toContainText("<script>");
  await page.getByRole("link", { name: "Find support" }).click();
  await expect(
    page.getByRole("heading", { name: "If you need support right now" }),
  ).toBeVisible();
  expect(await page.locator(".resource-grid a").count()).toBe(3);
  await page.screenshot({
    path: `artifacts/${info.project.name}-resources.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.context().clearCookies();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue as guest" }),
  ).toBeVisible();
});

test("explicit crisis wording returns human support instead of ordinary demo response", async ({
  page,
}) => {
  await guest(page);
  await send(page, "I want to kill myself");
  await expect(page.locator(".message.assistant")).toContainText(
    "contact your local emergency services",
  );
  await expect(
    page.getByRole("link", { name: "Find human support" }),
  ).toBeVisible();
});
