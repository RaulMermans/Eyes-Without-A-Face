declare module "*.schema.json" {
  const schema: Record<string, unknown>;
  export default schema;
}

declare module "*.json" {
  const value: Record<string, unknown>;
  export default value;
}
