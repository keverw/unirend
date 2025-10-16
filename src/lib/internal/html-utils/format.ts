import type { renderType } from "../../types";

/*
 * NOTE: This file uses @ts-expect-error on certain node type checks.
 * The underlying HTML parser returns node types like 'root' and 'directive',
 * which are not present in the outdated TypeScript types. These errors are
 * expected and safe to ignore, as the code works at runtime.
 */

// Define a lightweight type for directive nodes from the parser
type DirectiveElement = { type: "directive"; data: string };

// Development comment that should be preserved
const DEVELOPMENT_COMMENT =
  "React hydration relies on data attributes. Do not remove them.";

function formatNode(
  el: cheerio.Element,
  level = 0,
  isInRoot = false,
  containerID = "root",
): string {
  const indent = isInRoot ? "" : "  ".repeat(level);

  // @ts-expect-error: 'root' is a valid node type at runtime, but not in the types
  if (el.type === "root") {
    // @ts-expect-error: 'children' exists on root node at runtime
    return (el.children || [])
      .map((child: cheerio.Element) =>
        formatNode(child, level, false, containerID),
      )
      .filter(Boolean)
      .join("\n");
  }

  // @ts-expect-error: 'directive' is a valid node type at runtime, but not in the types
  if (el.type === "directive") {
    const dir = el as unknown as DirectiveElement;
    return `${indent}<${dir.data}>`;
  }

  // Comment nodes
  if (el.type === "comment") {
    return `${indent}<!--${el.data}-->`;
  }

  // Text nodes
  if (el.type === "text") {
    const text = el.data?.trim() ?? "";
    if (!text) {
      return "";
    }

    return `${indent}${text}`;
  }

  // Tag elements
  const tag = el;
  const tagName = tag.name;
  const attrs = Object.entries(tag.attribs || {})
    .map(([key, val]) => (val === "" ? key : `${key}="${val}"`))
    .join(" ");
  const openTag = attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`;

  // Special handling for container element to prevent whitespace nodes
  const isRoot =
    tagName === "div" &&
    "id" in tag.attribs &&
    tag.attribs["id"] === containerID;

  const selfClosingTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  if (tag.children && tag.children.length > 0) {
    // Different handling for root element - keep content on a single line for hydration
    if (isRoot) {
      let result = `${indent}${openTag}`;

      for (const child of tag.children) {
        const childStr = formatNode(child, 0, true, containerID);
        if (childStr) {
          result += childStr;
        }
      }

      result += `</${tagName}>`;
      return result;
    } else {
      // Standard handling. If we're inside the #root element (isInRoot), we want to keep
      // everything on a single line to avoid introducing whitespace nodes that would
      // break React hydration. Therefore, we skip inserting newlines in that case.

      const inline = isInRoot;
      let result = `${indent}${openTag}`;

      for (const child of tag.children) {
        const childStr = formatNode(
          child,
          inline ? 0 : level + 1,
          isInRoot,
          containerID,
        );
        if (childStr) {
          result += inline ? childStr : `\n${childStr}`;
        }
      }

      result += inline ? `</${tagName}>` : `\n${indent}</${tagName}>`;
      return result;
    }
  }

  // Self-closing tags
  if (selfClosingTags.has(tagName)) {
    return `${indent}<${tagName}${attrs ? ` ${attrs}` : ""}/>`;
  }

  // Empty standard tag
  return `${indent}${openTag}</${tagName}>`;
}

export function prettifyHtml(
  $: cheerio.Root | cheerio.CheerioAPI,
  containerID = "root",
): string {
  let html = "";

  for (const el of $.root().toArray()) {
    html += formatNode(el, 0, false, containerID) + "\n";
  }

  return html;
}

export type ProcessTemplateResult =
  | { success: true; html: string }
  | { success: false; error: string };

export async function processTemplate(
  html: string,
  mode: renderType,
  isDevelopment: boolean,
  containerID = "root",
): Promise<ProcessTemplateResult> {
  try {
    // Dynamic import to prevent bundling in client builds
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    // Remove title tags from head
    $("head title").remove();

    if (isDevelopment) {
      $("body").prepend(`<!-- ${DEVELOPMENT_COMMENT} -->\n`);
    }

    // Remove meta tags except apple-mobile-web-app-title
    $("meta[name]").each((_, el) => {
      const name = $(el).attr("name");
      if (name !== "apple-mobile-web-app-title") {
        $(el).remove();
      }
    });

    // Collect all script tags
    const scripts: string[] = [];
    $("script").each((_, scriptElement) => {
      scripts.push($.html(scriptElement));
    });

    // Remove scripts from their original locations
    $("script").remove();

    // Add placeholder for runtime injection of context scripts
    // This will be replaced per-request in injectContent() with any needed scripts
    // (e.g., __APP_REQUEST_CONTEXT__, __FRONTEND_APP_CONFIG__, etc.)
    scripts.unshift("<!--context-scripts-injection-point-->");

    // Track required markers during comment processing
    let hasHeadMarker = false;
    let hasOutletMarker = false;

    // Remove comments that don't start with ss- or the development comment
    // Also normalize ss- comments by trimming their content
    // AND validate that required markers are present
    $("*:not(script):not(style)")
      .contents()
      .each((index: number, node: cheerio.Element) => {
        if (node.type === "comment") {
          const commentData = node.data?.trim() || "";
          const shouldKeep =
            commentData.startsWith("ss-") ||
            commentData === DEVELOPMENT_COMMENT;

          if (shouldKeep) {
            // Check for required markers (after normalization)
            if (commentData === "ss-head") {
              hasHeadMarker = true;
            } else if (commentData === "ss-outlet") {
              hasOutletMarker = true;
            }

            // Normalize ss- comments by trimming their content
            if (commentData.startsWith("ss-") && node.data !== commentData) {
              node.data = commentData;
            }
          } else {
            $(node).remove();
          }
        }
      });

    // Validate required markers after comment processing
    if (!hasHeadMarker || !hasOutletMarker) {
      const missingMarkers: string[] = [];

      if (!hasHeadMarker) {
        missingMarkers.push("<!--ss-head-->");
      }

      if (!hasOutletMarker) {
        missingMarkers.push("<!--ss-outlet-->");
      }

      const contentDescription =
        mode === "ssg"
          ? "generated content will be injected"
          : "server-rendered content will be injected";

      return {
        success: false,
        error: `Missing required comment markers in HTML template: ${missingMarkers.join(", ")}. These markers indicate where ${contentDescription}.`,
      };
    }

    // Find the container element and append scripts AFTER it, not inside it
    const rootElement = $(`#${containerID}`);

    if (rootElement.length > 0) {
      // Append scripts after the root element
      rootElement.after(scripts.join("\n"));
    } else {
      // Fallback: If no #root element is found, append scripts to the end of body
      $("body").append(scripts.join("\n"));
    }

    return {
      success: true,
      html: prettifyHtml($, containerID),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process HTML template: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
