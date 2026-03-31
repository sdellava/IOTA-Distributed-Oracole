type JsonSchema = any;

function kindOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateEnum(path: string, value: unknown, allowed: unknown[]): void {
  if (!allowed.some((x) => Object.is(x, value))) {
    throw new Error(`Schema validation failed at ${path}: value ${JSON.stringify(value)} not in enum`);
  }
}

function validateNumberRange(path: string, value: number, schema: JsonSchema): void {
  if (Number.isFinite(schema?.minimum) && value < Number(schema.minimum)) {
    throw new Error(`Schema validation failed at ${path}: ${value} < minimum ${schema.minimum}`);
  }
  if (Number.isFinite(schema?.maximum) && value > Number(schema.maximum)) {
    throw new Error(`Schema validation failed at ${path}: ${value} > maximum ${schema.maximum}`);
  }
}

function validateValue(path: string, value: unknown, schema: JsonSchema): void {
  if (!schema || typeof schema !== "object") return;

  if (Array.isArray(schema.enum)) validateEnum(path, value, schema.enum);

  const type = String(schema.type ?? "").trim();
  if (!type) return;

  if (type === "object") {
    if (!isPlainObject(value)) {
      throw new Error(`Schema validation failed at ${path}: expected object, got ${kindOf(value)}`);
    }

    const properties = isPlainObject(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];

    for (const req of required) {
      if (!Object.prototype.hasOwnProperty.call(value, req)) {
        throw new Error(`Schema validation failed at ${path}: missing required property ${req}`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw new Error(`Schema validation failed at ${path}: unexpected property ${key}`);
        }
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      validateValue(`${path}.${key}`, (value as Record<string, unknown>)[key], childSchema);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`Schema validation failed at ${path}: expected array, got ${kindOf(value)}`);
    const itemSchema = schema.items;
    if (itemSchema) {
      for (let i = 0; i < value.length; i += 1) validateValue(`${path}[${i}]`, value[i], itemSchema);
    }
    return;
  }

  if (type === "string") {
    if (typeof value !== "string") throw new Error(`Schema validation failed at ${path}: expected string, got ${kindOf(value)}`);
    return;
  }

  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Schema validation failed at ${path}: expected boolean, got ${kindOf(value)}`);
    return;
  }

  if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`Schema validation failed at ${path}: expected integer, got ${kindOf(value)}`);
    }
    validateNumberRange(path, value, schema);
    return;
  }

  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Schema validation failed at ${path}: expected number, got ${kindOf(value)}`);
    }
    validateNumberRange(path, value, schema);
    return;
  }

  if (type === "null") {
    if (value !== null) throw new Error(`Schema validation failed at ${path}: expected null, got ${kindOf(value)}`);
  }
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema): void {
  validateValue("$", value, schema);
}
