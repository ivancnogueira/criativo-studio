const VALID_GEMINI_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
]);

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "$id",
  "$defs",
  "definitions",
  "$ref",
  "patternProperties",
  "propertyNames",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  "unevaluatedItems",
  "examples",
  "contentMediaType",
  "contentEncoding",
  "readOnly",
  "writeOnly",
  "deprecated",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "const",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveScalarType(rawType: unknown): string | null {
  if (typeof rawType === "string") {
    const normalized = rawType.trim().toLowerCase();
    return VALID_GEMINI_TYPES.has(normalized) ? normalized : null;
  }
  if (Array.isArray(rawType)) {
    const candidates = rawType
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t !== "null" && VALID_GEMINI_TYPES.has(t));
    if (candidates.length === 0) return "string";
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.includes("string")) return "string";
    return candidates[0]!;
  }
  return null;
}

function pickUnionBranch(node: Record<string, unknown>): Record<string, unknown> | null {
  const candidates = Array.isArray(node.anyOf)
    ? node.anyOf
    : Array.isArray(node.oneOf)
      ? node.oneOf
      : null;
  if (!candidates || candidates.length === 0) return null;

  for (const branch of candidates) {
    if (!isPlainRecord(branch)) continue;
    if (branch.type === "null") continue;
    return branch;
  }
  return null;
}

function inferArrayFallbackItems(description: unknown): Record<string, unknown> {
  const desc = typeof description === "string" ? description.toLowerCase() : "";
  if (
    desc.includes("objeto") ||
    desc.includes("filtro") ||
    desc.includes("filter") ||
    desc.includes("campo") ||
    desc.includes("field") ||
    desc.includes("acao") ||
    desc.includes("action") ||
    desc.includes("op")
  ) {
    return { type: "object", properties: {} };
  }
  return { type: "string" };
}

function sanitizeSchemaNode(
  rawNode: unknown,
  isRoot: boolean,
  depth = 0
): Record<string, unknown> {
  if (depth > 24) {
    return isRoot ? { type: "object", properties: {} } : { type: "string" };
  }

  if (!isPlainRecord(rawNode)) {
    return isRoot ? { type: "object", properties: {} } : { type: "string" };
  }

  const wasCompletelyEmpty = Object.keys(rawNode).length === 0;

  let mergedSource: Record<string, unknown> = { ...rawNode };
  if (!mergedSource.type) {
    const branch = pickUnionBranch(mergedSource);
    if (branch) {
      mergedSource = {
        ...branch,
        ...(typeof mergedSource.description === "string" && !branch.description
          ? { description: mergedSource.description }
          : {}),
      };
    } else if (Array.isArray(mergedSource.allOf) && mergedSource.allOf.length > 0) {
      const mergedProps: Record<string, unknown> = {};
      const mergedRequired: string[] = [];
      let allOfDesc: string | undefined;
      for (const entry of mergedSource.allOf) {
        if (!isPlainRecord(entry)) continue;
        if (typeof entry.description === "string" && !allOfDesc) {
          allOfDesc = entry.description;
        }
        if (isPlainRecord(entry.properties)) {
          Object.assign(mergedProps, entry.properties);
        }
        if (Array.isArray(entry.required)) {
          for (const r of entry.required) {
            if (typeof r === "string" && !mergedRequired.includes(r)) {
              mergedRequired.push(r);
            }
          }
        }
      }
      if (Object.keys(mergedProps).length > 0) {
        mergedSource = {
          type: "object",
          properties: mergedProps,
          ...(mergedRequired.length > 0 ? { required: mergedRequired } : {}),
          ...(allOfDesc ? { description: allOfDesc } : {}),
          ...(typeof mergedSource.description === "string"
            ? { description: mergedSource.description }
            : {}),
        };
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mergedSource)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }

  // Converte const para enum compatível com OpenAPI 3.0 / Gemini
  if ("const" in mergedSource && mergedSource.const !== undefined && !Array.isArray(out.enum)) {
    const c = mergedSource.const;
    if (typeof c === "string") {
      out.type = "string";
      out.enum = [c];
    } else if (typeof c === "number") {
      out.type = out.type ?? "number";
    } else if (typeof c === "boolean") {
      out.type = out.type ?? "boolean";
    }
  }

  let resolvedType = resolveScalarType(mergedSource.type);
  if (!resolvedType) {
    if (isRoot) {
      resolvedType = "object";
    } else if (isPlainRecord(mergedSource.properties)) {
      resolvedType = "object";
    } else if ("items" in mergedSource && mergedSource.items !== undefined) {
      resolvedType = "array";
    } else if (Array.isArray(mergedSource.enum) && mergedSource.enum.length > 0) {
      resolvedType = "string";
    } else {
      resolvedType = "string";
      if (wasCompletelyEmpty && typeof out.description !== "string") {
        out.description = "Valor escalar serializado";
      }
    }
  }
  out.type = resolvedType;

  // No Gemini, `enum` precisa ser array de strings
  if (Array.isArray(out.enum)) {
    if (out.enum.length === 0) {
      delete out.enum;
    } else {
      out.enum = out.enum.map((item) => String(item));
      if (resolvedType !== "string") {
        out.type = "string";
        resolvedType = "string";
      }
    }
  }

  if (resolvedType === "object" || resolvedType === "array") {
    delete out.default;
  }

  if (resolvedType === "array") {
    delete out.properties;
    delete out.required;
    const rawItems = mergedSource.items;
    if (!isPlainRecord(rawItems) || Object.keys(rawItems).length === 0) {
      out.items = inferArrayFallbackItems(mergedSource.description);
    } else {
      out.items = sanitizeSchemaNode(rawItems, false, depth + 1);
    }
  } else if (resolvedType === "object") {
    delete out.items;
    const rawProps = isPlainRecord(mergedSource.properties) ? mergedSource.properties : {};
    const sanitizedProps: Record<string, Record<string, unknown>> = {};
    for (const [propName, propSchema] of Object.entries(rawProps)) {
      sanitizedProps[propName] = sanitizeSchemaNode(propSchema, false, depth + 1);
    }
    out.properties = sanitizedProps;

    if (Array.isArray(mergedSource.required)) {
      const validRequired = mergedSource.required.filter(
        (key): key is string => typeof key === "string" && key in sanitizedProps
      );
      if (validRequired.length > 0) {
        out.required = validRequired;
      } else {
        delete out.required;
      }
    } else {
      delete out.required;
    }
  } else {
    delete out.properties;
    delete out.required;
    delete out.items;
  }

  return out;
}

/**
 * Sanitiza recursivamente um JSON Schema de ferramenta para o subconjunto OpenAPI 3.0
 * aceito pela API Gemini / Vertex / Google Antigravity (`functionDeclarations[].parameters`).
 */
export function sanitizeJsonSchemaForGemini(rawSchema: unknown): Record<string, unknown> {
  return sanitizeSchemaNode(rawSchema, true, 0);
}

/**
 * Audita recursivamente um schema já sanitizado (ou bruto) e retorna violações conhecidas
 * que provocam HTTP 400 INVALID_ARGUMENT na API Gemini.
 */
export function validateGeminiToolSchema(rawSchema: unknown, path = "$"): string[] {
  const errors: string[] = [];

  if (!isPlainRecord(rawSchema)) {
    errors.push(`schema não-objeto em ${path}`);
    return errors;
  }

  for (const forbidden of [
    "$schema",
    "additionalProperties",
    "$id",
    "$defs",
    "definitions",
    "anyOf",
    "oneOf",
    "allOf",
    "const",
  ]) {
    if (forbidden in rawSchema) {
      errors.push(`chave não suportada '${forbidden}' em ${path}`);
    }
  }

  if (Array.isArray(rawSchema.type)) {
    errors.push(`type array não escalar em ${path}`);
  } else if (typeof rawSchema.type !== "string" || !VALID_GEMINI_TYPES.has(rawSchema.type)) {
    errors.push(`type ausente ou inválido '${String(rawSchema.type)}' em ${path}`);
  }

  if (rawSchema.type === "array") {
    if (!isPlainRecord(rawSchema.items)) {
      errors.push(`array sem items em ${path}`);
    } else {
      errors.push(...validateGeminiToolSchema(rawSchema.items, `${path}.items`));
    }
  }

  if (rawSchema.type === "object" && isPlainRecord(rawSchema.properties)) {
    for (const [key, propSchema] of Object.entries(rawSchema.properties)) {
      errors.push(...validateGeminiToolSchema(propSchema, `${path}.properties.${key}`));
    }
  }

  return errors;
}
