import { ActionPanel, Detail, List, Action, Icon } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import yaml from "js-yaml";

// Types for navigation structure
type NavItem = string | { [key: string]: string | NavItem[] };
type NavStructure = { nav: NavItem[] };

// Flattened doc item for rendering
type DocItem = {
  title: string;
  path: string;
  isFolder: boolean;
  children?: DocItem[];
};

const NAV_URL = "https://raw.githubusercontent.com/cachix/devenv/main/docs/src/.nav.yml";
const DOCS_BASE_URL = "https://raw.githubusercontent.com/cachix/devenv/main/docs/src";
const WEBSITE_BASE_URL = "https://devenv.sh";

// Convert a path to a human-readable title
function pathToTitle(path: string): string {
  return path
    .replace(/\.md$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Parse nav items into DocItem structure
function parseNavItems(items: NavItem[], basePath = ""): DocItem[] {
  const result: DocItem[] = [];

  for (const item of items) {
    if (typeof item === "string") {
      // Simple file reference like "getting-started.md"
      const isFolder = !item.endsWith(".md");
      result.push({
        title: pathToTitle(item),
        path: basePath ? `${basePath}/${item}` : item,
        isFolder,
      });
    } else if (typeof item === "object") {
      // Object with title as key
      for (const [title, value] of Object.entries(item)) {
        if (typeof value === "string") {
          // { "Title": "path.md" }
          const isFolder = !value.endsWith(".md");
          result.push({
            title,
            path: basePath ? `${basePath}/${value}` : value,
            isFolder,
          });
        } else if (Array.isArray(value)) {
          // { "Section Title": [...children] }
          result.push({
            title,
            path: "",
            isFolder: true,
            children: parseNavItems(value, basePath),
          });
        }
      }
    }
  }

  return result;
}

// Extract the Guide section from nav structure
function extractGuideSection(nav: NavStructure): DocItem[] {
  for (const item of nav.nav) {
    if (typeof item === "object" && "Guide" in item) {
      const guideItems = item["Guide"];
      if (Array.isArray(guideItems)) {
        return parseNavItems(guideItems);
      }
    }
  }
  return [];
}

// Fix markdown content for Raycast rendering
function fixMarkdown(content: string): string {
  let result = content;

  // Fix admonitions: !!! type "title" -> blockquote
  // Pattern: !!! type "optional title"
  //          optional blank line
  //          indented content (including blank lines within)
  result = result.replace(
    /^!!! (\w+)(?: "([^"]*)")?\n\n?((?:(?:    .*|)\n)*)/gm,
    (_, type, title, body) => {
      const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1);
      const header = title ? `**${typeCapitalized}:** ${title}` : `**${typeCapitalized}**`;
      const bodyLines = body
        .split("\n")
        .map((line: string) => line.replace(/^    /, ""))
        .join("\n")
        .trim();

      const quotedBody = bodyLines
        .split("\n")
        .map((line: string) => (line.trim() === "" ? ">" : `> ${line}`))
        .join("\n");

      return `> ${header}\n${quotedBody}\n\n`;
    }
  );

  // Fix tabs: === "Tab Name" -> ### Tab Name
  result = result.replace(
    /^=== "([^"]+)"\n((?:    .*\n?)*)/gm,
    (_, tabName, body) => {
      const bodyLines = body
        .split("\n")
        .map((line: string) => line.replace(/^    /, ""))
        .join("\n")
        .trim();
      return `### ${tabName}\n\n${bodyLines}\n`;
    }
  );

  return result;
}

// Fetch and parse nav.yml
async function fetchNavYaml(): Promise<DocItem[]> {
  const response = await fetch(NAV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch nav.yml: ${response.statusText}`);
  }
  const text = await response.text();
  const parsed = yaml.load(text) as NavStructure;
  return extractGuideSection(parsed);
}

// Fetch markdown content for a doc
async function fetchMarkdown(path: string): Promise<string> {
  const url = `${DOCS_BASE_URL}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
  }
  const text = await response.text();
  return fixMarkdown(text);
}

// Detail view for markdown files
function DocsDetailView({ path, title }: { path: string; title: string }) {
  const { data, isLoading, revalidate } = useCachedPromise(
    (p: string) => fetchMarkdown(p),
    [path],
    { keepPreviousData: true }
  );

  const websiteUrl = `${WEBSITE_BASE_URL}/${path.replace(/\.md$/, "/").replace(/index\/$/, "")}`;

  return (
    <Detail
      markdown={data || ""}
      isLoading={isLoading}
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser url={websiteUrl} title="Open on devenv.sh" />
          <Action
            icon={Icon.ArrowClockwise}
            title="Refresh"
            onAction={() => revalidate()}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
        </ActionPanel>
      }
    />
  );
}

// List component for doc items (reusable for nested navigation)
function DocsList({ items, title, revalidate }: { items: DocItem[]; title?: string; revalidate?: () => void }) {
  return (
    <List navigationTitle={title}>
      {items.map((item, index) => {
        if (item.children && item.children.length > 0) {
          // Section with children
          return (
            <List.Section key={`section-${index}`} title={item.title}>
              {item.children.map((child, childIndex) => (
                <DocListItem key={`${index}-${childIndex}`} item={child} revalidate={revalidate} />
              ))}
            </List.Section>
          );
        }
        return <DocListItem key={index} item={item} revalidate={revalidate} />;
      })}
    </List>
  );
}

// Individual list item component
function DocListItem({ item, revalidate }: { item: DocItem; revalidate?: () => void }) {
  const icon = item.isFolder ? Icon.Folder : Icon.Document;

  if (item.isFolder && item.children) {
    // Folder with known children - push to nested list
    return (
      <List.Item
        title={item.title}
        icon={icon}
        actions={
          <ActionPanel>
            <Action.Push
              title="Open"
              target={<DocsList items={item.children} title={item.title} revalidate={revalidate} />}
            />
            {revalidate && (
              <Action
                icon={Icon.ArrowClockwise}
                title="Refresh Cache"
                onAction={revalidate}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
              />
            )}
          </ActionPanel>
        }
      />
    );
  }

  if (item.isFolder) {
    // Folder without children (would need to fetch folder contents)
    // For now, just show it as non-interactive
    return <List.Item title={item.title} icon={icon} />;
  }

  // Markdown file - push to detail view
  const websiteUrl = `${WEBSITE_BASE_URL}/${item.path.replace(/\.md$/, "/").replace(/index\/$/, "")}`;

  return (
    <List.Item
      title={item.title}
      icon={icon}
      actions={
        <ActionPanel>
          <Action.Push title="View" target={<DocsDetailView path={item.path} title={item.title} />} />
          <Action.OpenInBrowser url={websiteUrl} title="Open on devenv.sh" />
          {revalidate && (
            <Action
              icon={Icon.ArrowClockwise}
              title="Refresh Cache"
              onAction={revalidate}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const { data: items, isLoading, revalidate } = useCachedPromise(fetchNavYaml, [], {
    keepPreviousData: true,
  });

  if (isLoading && !items) {
    return <List isLoading={true} />;
  }

  return <DocsList items={items || []} title="DevEnv Docs" revalidate={revalidate} />;
}
