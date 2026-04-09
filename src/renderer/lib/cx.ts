type ClassInput = string | false | null | undefined

/** Join truthy class name values into a single space-separated string. */
export function cx(...inputs: ClassInput[]): string {
  return inputs.filter(Boolean).join(' ')
}
