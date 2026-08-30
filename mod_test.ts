import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { SiteConfig } from "@steno/steno";
import navPlugin from "./mod.ts";

async function write(root: string, relPath: string, content: string) {
  const full = join(root, relPath);
  await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(full, content);
}

function siteConfig(contentDir: string, overrides: Partial<SiteConfig> = {}): SiteConfig {
  return { title: "Test site", description: "", author: "", contentDir, ...overrides };
}

Deno.test("nav: builds the exact tree from the issue's example", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "index.md", "---\ntitle: Home\n---\n");
    await write(root, "blog/index.md", "---\ntitle: Blog\n---\n");
    await write(root, "now.md", "---\ntitle: Now\n---\n");
    await write(root, "projects/index.md", "---\ntitle: Projects\n---\n");
    await write(root, "projects/ametrine.md", "---\ntitle: Ametrine\n---\n");
    await write(root, "plans.md", "---\nexclude_from_nav: true\n---\n");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);

    const titles = config.navigation?.map((n) => n.title).sort();
    assertEquals(titles, ["Blog", "Home", "Now", "Projects"]);

    const projects = config.navigation?.find((n) => n.title === "Projects");
    assertEquals(projects?.url, "/projects/");
    assertEquals(projects?.children?.map((c) => c.title), ["Ametrine"]);
    assertEquals(projects?.children?.[0].url, "/projects/ametrine/");

    // plans.md carries exclude_from_nav: true and must not appear anywhere
    assertEquals(JSON.stringify(config.navigation).includes("Plans"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: camelCase excludeFromNav also excludes", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "secret.md", "---\ntitle: Secret\nexcludeFromNav: true\n---\n");
    await write(root, "public.md", "---\ntitle: Public\n---\n");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation?.map((n) => n.title), ["Public"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: draft pages are excluded", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "wip.md", "---\ntitle: WIP\ndraft: true\n---\n");
    await write(root, "done.md", "---\ntitle: Done\n---\n");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation?.map((n) => n.title), ["Done"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: missing title falls back to a humanized filename", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "getting-started.md", "no frontmatter at all");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation?.[0].title, "Getting Started");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: navWeight sorts before alphabetical fallback", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "b.md", "---\ntitle: B\n---\n");
    await write(root, "a.md", "---\ntitle: A\nnavWeight: 1\n---\n");
    await write(root, "c.md", "---\ntitle: C\nnav_weight: 0\n---\n");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation?.map((n) => n.title), ["C", "A", "B"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: leaves an already-set config.navigation alone by default", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "page.md", "---\ntitle: Page\n---\n");

    const manual = [{ title: "Manual" }];
    const config = siteConfig(root, { navigation: manual });
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation, manual);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: force overwrites an already-set config.navigation", async () => {
  const root = await Deno.makeTempDir();
  try {
    await write(root, "page.md", "---\ntitle: Page\n---\n");

    const config = siteConfig(root, { navigation: [{ title: "Manual" }] });
    await navPlugin({ force: true }).beforeBuild?.(config);
    assertEquals(config.navigation?.map((n) => n.title), ["Page"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("nav: empty folder with no index page is omitted", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "empty"), { recursive: true });
    await write(root, "page.md", "---\ntitle: Page\n---\n");

    const config = siteConfig(root);
    await navPlugin().beforeBuild?.(config);
    assertEquals(config.navigation?.map((n) => n.title), ["Page"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
