export function hashPassword(input: string): string {
  return `h${input.length}`;
}
