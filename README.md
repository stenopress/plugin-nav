# @steno/plugin-nav

Config-less navigation plugin for [Steno](https://github.com/steno/steno) that builds
`config.navigation` straight from `content/`'s own folder structure -- no manually maintained nav
list to keep in sync as pages get added, renamed, or removed.

This is for the common case where a site's navigation is really just "every top-level page and
section, in some order" -- maintaining a parallel `navigation:` list in config means updating two
places every time a page moves. Inspired by
[this Zola discourse thread](https://zola.discourse.group/t/building-nav-without-defining-entries-in-the-config-file/2932)
on doing the same thing without a config-defined nav list.

## Installation

```yaml
# content/.steno/config.yml
plugins:
  - jsr:@steno/plugin-nav
```

No options are required -- every page already existing under `content/` is enough.

## Options

```yaml
plugins:
  - package: jsr:@steno/plugin-nav
    options:
      indexFile: index
      excludeField: excludeFromNav
      weightField: navWeight
```

| Option         | Type              | Default                          | Description                                                                                                                                          |
| -------------- | ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentDir`   | `string`          | `config.contentDir` (`content/`) | Root to scan.                                                                                                                                        |
| `indexFile`    | `string \| false` | `"index"`                        | Filename stem (no extension) treated as a folder's own page. `false` disables index-file detection -- every folder then gets an unlinked label node. |
| `excludeField` | `string`          | `"excludeFromNav"`               | Both this and its snake_case form are always checked, regardless of what's configured here.                                                          |
| `weightField`  | `string`          | `"navWeight"`                    | Same dual-form checking as `excludeField`.                                                                                                           |
| `force`        | `boolean`         | `false`                          | Overwrites an already-set `config.navigation` instead of leaving a manually configured one alone.                                                    |

## How it works

The plugin hooks into Steno's `beforeBuild` stage, before Steno renders any page, and walks
`contentDir` to build a `NavigationNode[]` tree:

1. Every `.md` file becomes a leaf node -- title from frontmatter `title`, falling back to a
   humanized filename (`getting-started.md` → "Getting Started") when absent, matching how Steno
   itself falls back a page's title to its first heading, then the site title (see
   [content.md](https://github.com/stenopress/steno/blob/main/docs/content.md)).
2. A folder with an `index.md` (or whatever `indexFile` names) uses that page's title/url as the
   folder's own nav node -- a link, not just a label. A folder with no index file still gets a node,
   humanized from the folder name, just with no `url` of its own -- an unlinked category label
   wrapping its children.
3. A page is skipped entirely when its frontmatter sets `exclude_from_nav: true` _or_
   `excludeFromNav: true` (both spellings checked), or `draft: true`, in both `steno dev` and
   `steno build` -- nav is a structural concern, not a preview concern.
4. Siblings are sorted by `navWeight`/`nav_weight` (numeric, ascending) when set; anything without a
   weight falls back to alphabetical-by-title and sorts after every weighted sibling.
5. `content/index.md` becomes a `{ title: "Home", url: "/" }` entry alongside its siblings -- set its
   own `title` in frontmatter to rename it.
6. A folder with no index file and no non-excluded, non-draft pages inside produces no node at all,
   rather than an empty dead-end category.
7. Writes the result to `config.navigation`, unless the site already set one itself and `force` isn't
   set -- this plugin never silently fights a site that configures `navigation` by hand.

### Example

Given:

```text
content/
├── index.md        title: Home
├── blog/
│   └── index.md    title: Blog
├── now.md          title: Now
├── projects/
│   ├── index.md    title: Projects
│   └── widget.md   title: Widget
└── plans.md        exclude_from_nav: true
```

Produces:

```text
Home  Blog  Now  Projects
             └── Widget
```

### Bundling in a theme

A theme wanting this bundled the same way as
[plugin-accent-color](../plugin-accent-color/README.md) (so a site using the theme gets it for free,
no `plugins:` entry needed) can do so from its own `mod.ts`:

```ts
import nav from "@steno/plugin-nav";

const theme: StenoTheme = {
  // ...
  plugins: [nav()],
};
```

### Layout usage

`config.navigation` matches Steno's existing `NavigationNode[]` shape
([types.ts](https://github.com/stenopress/steno/blob/main/src/types.ts)), already exposed to layouts
as `site.navigation` per the
[layout context](https://github.com/stenopress/steno/blob/main/docs/theme_development.md#layout-context)
-- no new context field needed, this plugin just populates one Steno core already reserves for
navigation.

```tau
<nav>
  {#each site.navigation as item}
    <a href="{item.url | url}">{item.title}</a>
    {#if item.children}
      {#each item.children as child}
        <a href="{child.url | url}">{child.title}</a>
      {/each}
    {/if}
  {/each}
</nav>
```

## Test

```sh
deno task test
```

## Learn more

- [Steno plugin development guide](https://github.com/stenopress/steno/blob/main/docs/plugins.md)
- [Zola discourse: building nav without config entries](https://zola.discourse.group/t/building-nav-without-defining-entries-in-the-config-file/2932) -- the linked inspiration

## License

MIT
