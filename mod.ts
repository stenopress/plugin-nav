import { extractToml, extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { basename, extname, join, relative } from "@std/path";
import type { NavigationNode, SiteConfig, StenoPlugin } from "@steno/steno";

/** Options accepted by this plugin. */
export interface NavOptions {
  /** Content root to scan. Defaults to `config.contentDir` (`content/`). */
  contentDir?: string;
  /**
   * Frontmatter filename stem (without extension) treated as a folder's own
   * page -- its title/url become the folder's nav node instead of a synthetic
   * label. `false` disables index-file detection entirely.
   */
  indexFile?: string | false;
  /**
   * Frontmatter field that excludes a page from the nav when truthy. Both
   * this exact key and its snake_case form are checked, so `excludeFromNav`
   * and `exclude_from_nav` both work without extra config.
   */
  excludeField?: string;
  /** Frontmatter field used to sort siblings; ties (or missing values) fall back to title order. */
  weightField?: string;
  /** Overwrite an already-set `config.navigation` instead of leaving it alone. */
  force?: boolean;
}

interface PageMeta {
  title?: string;
  weight?: number;
  excluded: boolean;
  draft: boolean;
}

function toSnakeCase(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function humanize(stem: string): string {
  const spaced = stem.replace(/[-_]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase()) || stem;
}

function readFrontMatter(text: string): Record<string, unknown> {
  if (!hasFrontMatter(text)) return {};
  try {
    if (text.startsWith("+++")) return extractToml<Record<string, unknown>>(text).attrs;
    return extractYaml<Record<string, unknown>>(text).attrs;
  } catch {
    // A malformed frontmatter block shouldn't take down nav generation for
    // the whole site -- the page still builds, it just falls back to a
    // filename-derived title and default (non-excluded) nav treatment.
    return {};
  }
}

function readPageMeta(
  attrs: Record<string, unknown>,
  excludeField: string,
  weightField: string,
): PageMeta {
  const excludeKeys = new Set([excludeField, toSnakeCase(excludeField)]);
  const weightKeys = [weightField, toSnakeCase(weightField)];

  let excluded = false;
  for (const key of excludeKeys) {
    if (attrs[key] === true) excluded = true;
  }

  let weight: number | undefined;
  for (const key of weightKeys) {
    const value = attrs[key];
    if (typeof value === "number") weight = value;
  }

  return {
    title: typeof attrs.title === "string" ? attrs.title : undefined,
    weight,
    excluded,
    draft: attrs.draft === true,
  };
}

function toRoute(relativePath: string, isIndex: boolean): string {
  const withoutExt = relativePath.slice(0, -extname(relativePath).length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (isIndex) segments.pop();
  return "/" + segments.join("/") + (segments.length ? "/" : "");
}

interface WalkResult {
  node: NavigationNode;
  weight: number | undefined;
  title: string;
}

interface WalkOptions {
  excludeField: string;
  weightField: string;
  indexFile: string | false;
}

async function walk(dir: string, contentRoot: string, options: WalkOptions): Promise<WalkResult[]> {
  let dirEntries: Deno.DirEntry[] = [];
  try {
    dirEntries = [...Deno.readDirSync(dir)];
  } catch {
    return [];
  }

  const indexFilename = options.indexFile ? `${options.indexFile}.md` : undefined;
  const childDirs: string[] = [];
  const childFiles: Deno.DirEntry[] = [];

  for (const entry of dirEntries) {
    if (entry.name.startsWith(".")) continue; // skips `.steno/` and dotfiles
    if (entry.isDirectory) {
      childDirs.push(entry.name);
      continue;
    }
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    if (indexFilename && entry.name === indexFilename) continue; // handled per-parent, not as a sibling
    childFiles.push(entry);
  }

  const children: WalkResult[] = [];

  for (const fileEntry of childFiles) {
    const fullPath = join(dir, fileEntry.name);
    const text = await Deno.readTextFile(fullPath);
    const meta = readPageMeta(readFrontMatter(text), options.excludeField, options.weightField);
    if (meta.excluded || meta.draft) continue;

    const relPath = relative(contentRoot, fullPath);
    const stem = basename(fileEntry.name, extname(fileEntry.name));
    const title = meta.title ?? humanize(stem);
    children.push({
      node: { title, url: toRoute(relPath, false) },
      weight: meta.weight,
      title,
    });
  }

  for (const dirName of childDirs) {
    const subDir = join(dir, dirName);
    const subEntries = await walk(subDir, contentRoot, options);

    let subIndexMeta: PageMeta | undefined;
    let subIndexUrl: string | undefined;
    if (indexFilename) {
      const indexPath = join(subDir, indexFilename);
      try {
        const text = await Deno.readTextFile(indexPath);
        subIndexMeta = readPageMeta(
          readFrontMatter(text),
          options.excludeField,
          options.weightField,
        );
        subIndexUrl = toRoute(relative(contentRoot, indexPath), true);
      } catch {
        // no index file for this folder -- falls through to a synthetic label below
      }
    }

    if (subIndexMeta?.excluded || subIndexMeta?.draft) continue;
    if (subEntries.length === 0 && !subIndexMeta) continue; // empty folder, nothing to show

    const title = subIndexMeta?.title ?? humanize(dirName);
    const node: NavigationNode = { title };
    if (subIndexUrl) node.url = subIndexUrl;
    if (subEntries.length > 0)
      node.children = subEntries.sort(sortEntries).map((entry) => entry.node);

    children.push({ node, weight: subIndexMeta?.weight, title });
  }

  return children;
}

function sortEntries(a: WalkResult, b: WalkResult): number {
  if (a.weight !== undefined && b.weight !== undefined) return a.weight - b.weight;
  if (a.weight !== undefined) return -1;
  if (b.weight !== undefined) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * Creates the config-less navigation plugin.
 *
 * Builds `config.navigation` straight from the content folder structure --
 * no manually maintained nav list. See the README for the exact rules
 * (index-file detection, exclusion, ordering).
 */
export default function navPlugin(options: NavOptions = {}): StenoPlugin {
  const excludeField = options.excludeField ?? "excludeFromNav";
  const weightField = options.weightField ?? "navWeight";
  const indexFile = options.indexFile === undefined ? "index" : options.indexFile;

  return {
    name: "nav",

    async beforeBuild(config: SiteConfig) {
      if (config.navigation && config.navigation.length > 0 && !options.force) return;

      const contentRoot = options.contentDir ?? config.contentDir ?? "content";
      const results = await walk(contentRoot, contentRoot, {
        excludeField,
        weightField,
        indexFile,
      });

      // The root's own index file (content/index.md) has no parent directory
      // entry to attach it to -- walk() only ever sees index files nested one
      // level below the folder it's currently listing. Handle it once, here,
      // as the site's own "Home" entry, first in the list.
      if (indexFile) {
        const rootIndexPath = join(contentRoot, `${indexFile}.md`);
        try {
          const text = await Deno.readTextFile(rootIndexPath);
          const meta = readPageMeta(readFrontMatter(text), excludeField, weightField);
          if (!meta.excluded && !meta.draft) {
            results.unshift({
              node: { title: meta.title ?? "Home", url: "/" },
              weight: meta.weight,
              title: meta.title ?? "Home",
            });
          }
        } catch {
          // no root index file -- fine, nav just starts with the first real page
        }
      }

      config.navigation = results.sort(sortEntries).map((entry) => entry.node);
    },
  };
}
