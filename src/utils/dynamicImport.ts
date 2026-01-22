export async function dynamicImport<T = unknown>(moduleName: string): Promise<T> {
  const importer = new Function("m", "return import(m)") as (m: string) => Promise<T>;
  return await importer(moduleName);
}

