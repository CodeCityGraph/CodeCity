/**
 * Semantic Search Module
 * Provides semantic keyword matching for common architectural patterns like "auth logic", "database layer", etc.
 */

export interface SemanticCategory {
  keywords: string[];
  patterns: RegExp[];
  description: string;
}

// Define semantic categories for common architectural patterns
export const SEMANTIC_CATEGORIES: Record<string, SemanticCategory> = {
  "auth-logic": {
    keywords: ["auth", "login", "password", "token", "jwt", "oauth", "permission", "role", "access", "session", "credential"],
    patterns: [/auth|login|password|token|jwt|oauth|permission|role|access|session|credential/i],
    description: "Authentication and authorization logic"
  },
  "database-layer": {
    keywords: ["db", "database", "sql", "query", "orm", "model", "schema", "migration", "entity", "repository", "data", "store"],
    patterns: [/db|database|sql|query|orm|model|schema|migration|entity|repository|store|persist/i],
    description: "Database and persistence layer"
  },
  "api-endpoints": {
    keywords: ["api", "endpoint", "route", "handler", "controller", "request", "response", "http", "rest", "graphql"],
    patterns: [/api|endpoint|route|handler|controller|request|response|http|rest|graphql/i],
    description: "API endpoints and routing"
  },
  "ui-components": {
    keywords: ["ui", "component", "button", "form", "input", "modal", "dialog", "view", "template", "render"],
    patterns: [/ui|component|button|form|input|modal|dialog|view|template|render|widget/i],
    description: "UI components and views"
  },
  "utils-helpers": {
    keywords: ["util", "helper", "tool", "function", "service", "utility", "constants", "config"],
    patterns: [/util|helper|tool|function|service|utility|constants|config|common/i],
    description: "Utility functions and helpers"
  },
  "testing": {
    keywords: ["test", "spec", "mock", "stub", "fixture", "jest", "mocha", "unit", "integration"],
    patterns: [/test|spec|mock|stub|fixture|jest|mocha|unit|integration|\.test|\.spec/i],
    description: "Testing and test utilities"
  },
  "logging-monitoring": {
    keywords: ["log", "logger", "monitor", "metric", "trace", "debug", "error", "analytics", "telemetry"],
    patterns: [/log|logger|monitor|metric|trace|debug|error|analytics|telemetry|sentry|winston/i],
    description: "Logging and monitoring"
  },
  "configuration": {
    keywords: ["config", "env", "environment", "setting", "option", "variable", ".env"],
    patterns: [/config|env|environment|setting|option|\.env|property|parameter/i],
    description: "Configuration and environment setup"
  },
  "middleware": {
    keywords: ["middleware", "interceptor", "validator", "filter", "decorator", "plugin"],
    patterns: [/middleware|interceptor|validator|filter|decorator|plugin/i],
    description: "Middleware and interceptors"
  },
  "error-handling": {
    keywords: ["error", "exception", "catch", "throw", "handler", "boundary", "fallback"],
    patterns: [/error|exception|catch|throw|handler|boundary|fallback/i],
    description: "Error handling and recovery"
  }
};

export interface SemanticSearchResult {
  matches: string[];
  categories: string[];
  confidence: number;
}

/**
 * Normalize text for comparison
 */
export function normalizeSemanticText(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/").replace(/[-_]/g, " ");
}

/**
 * Check if a path matches semantic patterns
 */
export function matchesSemanticPattern(
  path: string,
  categories: string[] = Object.keys(SEMANTIC_CATEGORIES)
): SemanticSearchResult {
  const normalized = normalizeSemanticText(path);
  const matchedCategories: string[] = [];
  let totalMatches = 0;

  for (const categoryName of categories) {
    const category = SEMANTIC_CATEGORIES[categoryName];
    if (!category) continue;

    // Check if any pattern matches
    const patternMatch = category.patterns.some(pattern => pattern.test(normalized));
    
    // Check if any keyword matches
    const keywordMatch = category.keywords.some(keyword => 
      normalized.includes(keyword)
    );

    if (patternMatch || keywordMatch) {
      matchedCategories.push(categoryName);
      totalMatches++;
    }
  }

  // Confidence is based on how many categories matched
  const confidence = totalMatches / Math.max(1, categories.length);

  return {
    matches: matchedCategories,
    categories: matchedCategories,
    confidence
  };
}

/**
 * Parse semantic query to extract semantic terms
 */
export function parseSemanticQuery(query: string): {
  semanticTerms: string[];
  literalTerms: string[];
} {
  const normalized = normalizeSemanticText(query);
  const matchedCategories = new Set<string>();

  // Capture explicit category references like "auth-logic" / "auth logic" first.
  for (const categoryName of Object.keys(SEMANTIC_CATEGORIES)) {
    const normalizedCategory = normalizeSemanticText(categoryName);
    if (normalized.includes(normalizedCategory)) {
      matchedCategories.add(categoryName);
    }
  }

  const tokens = normalized.split(/[^a-z0-9]+/g).filter(Boolean);
  
  const semanticTerms: string[] = [];
  const literalTerms: string[] = [];

  for (const token of tokens) {
    // Check if token matches any semantic category keyword
    let isSemanticTerm = false;
    for (const [categoryName, category] of Object.entries(SEMANTIC_CATEGORIES)) {
      const categoryParts = normalizeSemanticText(categoryName).split(/\s+/g).filter(Boolean);
      if (
        category.keywords.some(kw => kw.includes(token) || token.includes(kw)) ||
        categoryParts.some(part => part === token)
      ) {
        semanticTerms.push(token);
        matchedCategories.add(categoryName);
        isSemanticTerm = true;
        break;
      }
    }
    if (!isSemanticTerm) {
      literalTerms.push(token);
    }
  }

  return {
    semanticTerms: [...new Set([...semanticTerms, ...matchedCategories])],
    literalTerms
  };
}

/**
 * Perform semantic search on a path
 * Returns true if the path semantically matches the query
 */
export function matchesSemanticQuery(path: string, query: string): boolean {
  if (!query) return true;

  const result = parseSemanticQuery(query);
  const normalizedPath = normalizeSemanticText(path);

  const literalMatches = result.literalTerms.every(term => normalizedPath.includes(term));
  
  // If no semantic terms, use literal-only matching.
  if (result.semanticTerms.length === 0) {
    return literalMatches;
  }

  // Check if any semantic term matches the path's semantic categories.
  const pathSemantics = matchesSemanticPattern(path);
  let semanticMatches = false;
  
  // For each semantic term in the query, check if path has matching categories
  for (const term of result.semanticTerms) {
    // Check if term is a key in SEMANTIC_CATEGORIES
    if (SEMANTIC_CATEGORIES[term]) {
      if (pathSemantics.categories.includes(term)) {
        semanticMatches = true;
        break;
      }
    } else {
      // Check if term matches any category's keywords
      for (const categoryName of Object.keys(SEMANTIC_CATEGORIES)) {
        const category = SEMANTIC_CATEGORIES[categoryName];
        const categoryKey = normalizeSemanticText(categoryName);
        if (
          categoryKey.includes(term) ||
          category.keywords.some(kw => kw.includes(term) || term.includes(kw))
        ) {
          if (pathSemantics.categories.includes(categoryName)) {
            semanticMatches = true;
            break;
          }
        }
      }
      if (semanticMatches) break;
    }
  }

  if (!semanticMatches) return false;

  // If literals are provided with semantic terms, require both.
  return literalMatches;
}

/**
 * Get suggestions for semantic search
 */
export function getSemanticSearchSuggestions(): string[] {
  return Object.keys(SEMANTIC_CATEGORIES).map(key => {
    const category = SEMANTIC_CATEGORIES[key];
    return `"${key}" - ${category.description}`;
  });
}
